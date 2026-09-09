#!/usr/bin/env node
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractError, EXIT, gateResult, parseArgs, readJsonFile, sha256, validateReleaseManifest } from './lib/contracts.mjs';
import { directoryDigest } from './lib/artifacts.mjs';
import { canonicalStatePath, withDeployStateLock } from './lib/deploy-state-store.mjs';
import { acceptResourceEpoch, acquireResourceLocks, completeResourceAction, inspectLockedResourceState, readExecutorReceipt, readExecutorRecoveryReceiptByDigest, recoverResourceAction, releaseResourceLocks, writeExecutorReceipt, writeExecutorRecoveryReceipt } from './lib/fenced-resource-store.mjs';
import { LEGACY_OLD_BINDING } from './lib/legacy-preprod.mjs';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ALLOWED_FIELDS = new Set([
  'action', 'execute', 'environment', 'project', 'approval-id', 'expected-generation', 'expected-fencing-epoch',
  'manifest-digest', 'operation-id', 'lease-id', 'holder-id', 'resource-id', 'action-id',
]);
const ACTIONS = Object.freeze({
  'preprod-baseline-ledger': { phases: ['STAGED'], primary: 'databaseRef', resources: ['databaseRef', 'dataNetwork'], kind: 'compose-baseline' },
  'preprod-expand-migrate': { phases: ['STAGED'], primary: 'databaseRef', resources: ['databaseRef', 'dataNetwork'], kind: 'compose-migrate' },
  'preprod-stage': { phases: ['STAGED', 'EXPAND_MIGRATED'], primary: 'edgeNetwork', resources: ['edgeNetwork'], kind: 'compose-stage' },
  'preprod-transfer-singletons': { phases: ['CANDIDATE_READY'], primary: 'edgeNetwork', resources: ['edgeNetwork', 'dataNetwork', 'databaseRef', 'telegram'], kind: 'singleton-transfer' },
  'preprod-set-webhook': { phases: ['SWITCHED', 'OBSERVING'], primary: 'telegram', resources: ['telegram', 'databaseRef', 'dataNetwork'], kind: 'compose-webhook', identity: 'active' },
  'preprod-switch-ingress': { phases: ['SINGLETON_TRANSFERRED'], primary: 'ingressRef', resources: ['ingressRef'], kind: 'ingress-helper' },
  'preprod-rollback-ingress': { phases: ['ROLLBACK_PENDING'], primary: 'ingressRef', resources: ['ingressRef'], kind: 'ingress-helper', identity: 'rollback' },
  'preprod-rollback-singletons': { phases: ['ROLLBACK_PENDING'], primary: 'edgeNetwork', resources: ['edgeNetwork', 'dataNetwork', 'databaseRef', 'telegram'], kind: 'singleton-transfer', identity: 'rollback' },
});

function releaseFor(state, spec) {
  if (spec.identity === 'active') return state.active;
  if (spec.identity === 'rollback') return state.rollback;
  return state.candidate;
}

function integer(value, name) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0) throw new ContractError(`--${name} must be a non-negative integer`);
  return result;
}

function required(args, names) {
  for (const name of names) if (!args[name]) throw new ContractError(`--${name} is required`);
}

function validateArgs(args) {
  for (const key of Object.keys(args)) if (!ALLOWED_FIELDS.has(key)) throw new ContractError(`unsupported argument: --${key}`);
  required(args, [...ALLOWED_FIELDS]);
  if (args.execute !== 'true') throw new ContractError('external action requires --execute true', EXIT.SWITCH);
  for (const key of ['approval-id', 'operation-id', 'lease-id', 'holder-id', 'action-id']) {
    if (!IDENTIFIER.test(args[key])) throw new ContractError(`--${key} is invalid`);
  }
  if (!ACTIONS[args.action]) throw new ContractError(`unsupported fenced action: ${args.action}`);
  if (args.environment !== 'preprod' || args.project !== 'booking-preprod' || !args.action.startsWith('preprod-')) {
    throw new ContractError('preprod executor cannot target production', EXIT.IDENTITY);
  }
}

function assertStateBinding(state, args, spec, nowMs) {
  if (state.environment !== args.environment || state.project !== args.project) throw new ContractError('canonical state identity mismatch', EXIT.IDENTITY);
  if (state.generation !== integer(args['expected-generation'], 'expected-generation')) throw new ContractError('deployment generation mismatch', EXIT.SWITCH);
  if (state.fencingEpoch !== integer(args['expected-fencing-epoch'], 'expected-fencing-epoch')) throw new ContractError('deployment fencing epoch mismatch', EXIT.SINGLETON);
  if (!spec.phases.includes(state.phase)) throw new ContractError(`action ${args.action} is not allowed from phase ${state.phase}`, EXIT.SWITCH);
  if (state.operationId !== args['operation-id'] || state.approvalId !== args['approval-id']) throw new ContractError('operation or approval identity mismatch', EXIT.SINGLETON);
  if (!state.lease || state.lease.leaseId !== args['lease-id'] || state.lease.holderId !== args['holder-id'] || state.lease.fencingEpoch !== state.fencingEpoch) {
    throw new ContractError('lease identity mismatch', EXIT.SINGLETON);
  }
  if (Date.parse(state.lease.expiresAt) <= nowMs) throw new ContractError('lease has expired', EXIT.SINGLETON);
  const releaseIdentity = releaseFor(state, spec);
  if (!releaseIdentity) throw new ContractError('action release identity is unavailable', EXIT.IDENTITY);
  if (!releaseIdentity || releaseIdentity.manifestDigest !== args['manifest-digest']) throw new ContractError('action release manifest identity mismatch', EXIT.IDENTITY);
  const resourceMap = { ...state.resources, telegram: `telegram:${state.project}` };
  if (args['resource-id'] !== resourceMap[spec.primary]) throw new ContractError('requested resource does not match canonical action resource', EXIT.IDENTITY);
  return { resourceIds: spec.resources.map((key) => resourceMap[key]), releaseIdentity };
}

async function trustedReleasePaths(state, releaseIdentity, runtime) {
  const configuredRoot = runtime.releaseRoot || `/volume1/homes/realzyq/${state.project}/releases`;
  if (!isAbsolute(configuredRoot)) throw new ContractError('trusted release root must be absolute', EXIT.IDENTITY);
  const root = await realpath(configuredRoot).catch(() => { throw new ContractError('trusted release root cannot be resolved', EXIT.IDENTITY); });
  const releaseDirectory = await realpath(join(root, releaseIdentity.releaseId)).catch(() => { throw new ContractError('action release directory cannot be resolved', EXIT.IDENTITY); });
  const containment = relative(root, releaseDirectory);
  if (!containment || containment.startsWith('..') || isAbsolute(containment)) throw new ContractError('candidate release directory escapes trusted root', EXIT.IDENTITY);
  const composeFile = await realpath(join(releaseDirectory, 'ops', 'compose', 'compose.preprod.yml')).catch(() => { throw new ContractError('candidate compose file cannot be resolved', EXIT.IDENTITY); });
  const composeContainment = relative(releaseDirectory, composeFile);
  if (!composeContainment || composeContainment.startsWith('..') || isAbsolute(composeContainment)) throw new ContractError('candidate compose file escapes immutable release directory', EXIT.IDENTITY);
  const manifestFile = runtime.releaseManifest ? null : await realpath(join(releaseDirectory, 'release-manifest.json')).catch(() => { throw new ContractError('candidate release manifest cannot be resolved', EXIT.IDENTITY); });
  if (manifestFile) {
    const manifestContainment = relative(releaseDirectory, manifestFile);
    if (!manifestContainment || manifestContainment.startsWith('..') || isAbsolute(manifestContainment)) throw new ContractError('candidate release manifest escapes immutable release directory', EXIT.IDENTITY);
  }
  return { releaseDirectory, composeFile, manifestFile };
}

async function findExecutable(candidates) {
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return candidate; } catch {}
  }
  throw new ContractError(`trusted executable is unavailable: ${candidates.join(', ')}`, EXIT.SWITCH);
}

async function findTrustedRootExecutable(candidates) {
  const path = await findExecutable(candidates);
  const canonical = await realpath(path);
  const metadata = await stat(canonical);
  if (!metadata.isFile() || (process.platform !== 'win32' && (metadata.uid !== 0 || (metadata.mode & 0o022) !== 0))) {
    throw new ContractError('ingress helper must be a root-owned regular file without group/other write access', EXIT.INGRESS);
  }
  return canonical;
}

function parseComposePs(stdout) {
  const text = stdout.trim();
  if (!text) throw new ContractError('compose readback returned no service identity', EXIT.READINESS);
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    try { return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }
    catch { throw new ContractError('compose readback is not JSON', EXIT.READINESS); }
  }
}

function verifyComposeServices(stdout, requiredServices) {
  const services = parseComposePs(stdout);
  for (const expected of requiredServices) {
    const item = services.find((entry) => entry.Service === expected || entry.service === expected);
    const state = String(item?.State || item?.state || '').toLowerCase();
    const health = String(item?.Health || item?.health || '').toLowerCase();
    if (!item || state !== 'running' || (health && health !== 'healthy')) throw new ContractError(`compose readback did not prove ${expected} running and healthy`, EXIT.READINESS);
  }
  return { serviceCount: services.length, requiredServices };
}

function parseLastJson(stdout, message, exitCode) {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  let value;
  try { value = JSON.parse(lines.at(-1) || ''); } catch { throw new ContractError(message, exitCode); }
  return value;
}

function verifyWebhookReceipt(stdout, expected, action) {
  const value = parseLastJson(stdout, 'Telegram webhook action did not emit a JSON readback receipt', EXIT.INGRESS);
  if (value?.schemaVersion !== 1 || value?.action !== action || value?.environment !== 'preproduction' ||
      value?.verification?.candidateReady !== true || value?.verification?.getMeIdentityMatched !== true ||
      (action === 'set' && value?.verification?.setWebhookAccepted !== true) ||
      (action === 'verify' && Object.hasOwn(value?.verification || {}, 'setWebhookAccepted')) ||
      value?.verification?.readBackUrlMatched !== true || value?.candidate?.releaseId !== expected.releaseId ||
      value?.candidate?.gitSha !== expected.gitSha || value?.candidate?.manifestDigest !== expected.manifestDigest ||
      value?.candidate?.configSchema !== expected.configSchema || value?.candidate?.migrationFloor !== expected.migrationFloor ||
      value?.candidate?.migrationCatalogDigest !== expected.migrationCatalogDigest ||
      String(value?.webhook?.url || '') !== expected.webhookUrl || !Number.isSafeInteger(value?.bot?.id) ||
      typeof value?.bot?.username !== 'string' || (expected.botId !== null && value.bot.id !== expected.botId) ||
      (expected.botUsername !== null && value.bot.username !== expected.botUsername) || !Number.isFinite(Date.parse(value?.completedAt))) {
    throw new ContractError('Telegram webhook readback receipt is incomplete', EXIT.INGRESS);
  }
  return { botId: value.bot?.id, botUsername: value.bot?.username, webhookUrl: value.webhook?.url };
}

export function verifyBaselineReceipt(stdout, expected = null, action = 'apply') {
  const value = parseLastJson(stdout, 'migration baseline did not emit a JSON readback receipt', EXIT.DATABASE);
  const schema = action === 'apply' ? 'booking.migration-baseline-receipt/v1' : 'booking.migration-baseline-readback/v1';
  if (value?.schema !== schema || value?.environment !== 'preproduction' ||
      value?.database !== 'booking_preprod' || !Number.isInteger(value?.historyCount) || value.historyCount < 1 ||
      (action === 'apply' && value?.verification?.atomic !== true) || value?.verification?.exactReadback !== true ||
      !/^sha256:[0-9a-f]{64}$/.test(value?.schemaDiffReceiptDigest || '') ||
      !/^sha256:[0-9a-f]{64}$/.test(value?.backupReceiptDigest || '') ||
      !/^sha256:[0-9a-f]{64}$/.test(value?.historyDigest || '') ||
      (action === 'apply' && !/^sha256:[0-9a-f]{64}$/.test(value?.backupDigest || '')) ||
      (expected && (value.releaseId !== expected.releaseId || value.gitSha !== expected.gitSha ||
        value.manifestDigest !== expected.manifestDigest || value.migrationCatalogDigest !== expected.migrationCatalogDigest ||
        value.migrationFloor !== expected.migrationFloor || value.schemaDiffReceiptDigest !== expected.schemaDiffReceiptDigest ||
        value.backupReceiptDigest !== expected.backupReceiptDigest || value.historyDigest !== expected.historyDigest))) {
    throw new ContractError('migration baseline readback receipt is incomplete', EXIT.DATABASE);
  }
  return { database: value.database, historyCount: value.historyCount, migrationFloor: value.migrationFloor,
    schemaDiffReceiptDigest: value.schemaDiffReceiptDigest, backupReceiptDigest: value.backupReceiptDigest,
    historyDigest: value.historyDigest, ...(value.backupDigest ? { backupDigest: value.backupDigest } : {}) };
}

function verifyMigrationReceipt(stdout, expected, action) {
  const value = parseLastJson(stdout, 'migration action did not emit a JSON receipt', EXIT.DATABASE);
  const schema = action === 'apply' ? 'booking.migration-apply-receipt/v1' : 'booking.migration-readback/v1';
  const common = value?.schema === schema && value?.environment === 'preproduction' && value?.database === 'booking_preprod' &&
    value?.releaseId === expected.releaseId && value?.gitSha === expected.gitSha && value?.manifestDigest === expected.manifestDigest &&
    value?.migrationCatalogDigest === expected.migrationCatalogDigest && value?.migrationFloor === expected.migrationFloor &&
    value?.backupReceiptDigest === expected.backupReceiptDigest;
  if (!common || (action === 'apply' && (JSON.stringify(value.approvedPending) !== JSON.stringify(expected.approvedPending) ||
      !Number.isFinite(Date.parse(value.completedAt)))) ||
      (action === 'verify' && (!Number.isInteger(value.migrationCount) || value.migrationCount < 1 || value.ledgerHead !== expected.ledgerHead ||
        !/^sha256:[0-9a-f]{64}$/.test(value.ledgerDigest || '') || !Number.isFinite(Date.parse(value.verifiedAt))))) {
    throw new ContractError('migration receipt identity or ledger binding is invalid', EXIT.DATABASE);
  }
  return action === 'apply' ? { approvedPending: value.approvedPending } :
    { migrationCount: value.migrationCount, ledgerHead: value.ledgerHead, ledgerDigest: value.ledgerDigest };
}

function parseSafeImageInspect(stdout, component) {
  const parts = stdout.trim().split('|');
  if (parts.length !== 4) throw new ContractError(`${component} image inspect readback is malformed`, EXIT.IDENTITY);
  try {
    return { id: JSON.parse(parts[0]), repoDigests: JSON.parse(parts[1]), repoTags: JSON.parse(parts[2]), labels: JSON.parse(parts[3]) };
  } catch { throw new ContractError(`${component} image inspect readback is not valid JSON`, EXIT.IDENTITY); }
}

export function verifyDockerImageBinding(component, artifact, identity, inspected) {
  if (!inspected || !/^sha256:[0-9a-f]{64}$/.test(inspected.id || '') || !Array.isArray(inspected.repoDigests) || !Array.isArray(inspected.repoTags)) {
    throw new ContractError(`${component} Docker image identity is incomplete`, EXIT.IDENTITY);
  }
  const taggedReference = `${artifact.image}:${identity.releaseId}`;
  if (!inspected.repoTags.includes(taggedReference)) throw new ContractError(`${component} release tag does not resolve to the inspected image`, EXIT.IDENTITY);
  if (inspected.repoDigests.length > 0) {
    if (!inspected.repoDigests.includes(`${artifact.image}@${artifact.digest}`)) throw new ContractError(`${component} RepoDigest does not match release manifest`, EXIT.IDENTITY);
  } else if (inspected.id !== artifact.digest) {
    throw new ContractError(`${component} local image ID does not match release manifest digest`, EXIT.IDENTITY);
  }
  if (inspected.labels?.['org.opencontainers.image.revision'] !== identity.gitSha ||
      inspected.labels?.['uk.happybooking.release-id'] !== identity.releaseId ||
      inspected.labels?.['uk.happybooking.component'] !== component) {
    throw new ContractError(`${component} OCI release labels do not match candidate identity`, EXIT.IDENTITY);
  }
  return { component, imageId: inspected.id, digestMode: inspected.repoDigests.length > 0 ? 'repo-digest' : 'local-image-id' };
}

function isExactLegacyBackend(component, artifact, identity) {
  return component === 'backend' && identity.releaseId === LEGACY_OLD_BINDING.releaseId && identity.gitSha === LEGACY_OLD_BINDING.gitSha &&
    identity.manifestDigest === LEGACY_OLD_BINDING.manifestRawDigest && artifact.image === LEGACY_OLD_BINDING.manifestRepository &&
    artifact.digest === LEGACY_OLD_BINDING.imageId;
}

export function verifyLegacyDockerImageBinding(component, artifact, identity, inspected) {
  if (!isExactLegacyBackend(component, artifact, identity) || inspected?.id !== LEGACY_OLD_BINDING.imageId ||
      !Array.isArray(inspected.repoDigests) || inspected.repoDigests.length !== 0 || !Array.isArray(inspected.repoTags) ||
      inspected.repoTags.length !== 1 || inspected.repoTags[0] !== LEGACY_OLD_BINDING.uniqueTag || inspected.labels !== null) {
    throw new ContractError('legacy backend image does not match the one-time fixed rollback binding', EXIT.IDENTITY);
  }
  return { component, imageId: inspected.id, digestMode: 'legacy-local-image-id', legacy: true };
}

function parseContainerImage(stdout, component) {
  const value = stdout.trim();
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw new ContractError(`${component} container image readback is invalid`, EXIT.IDENTITY);
  return value;
}

async function loadReleaseManifest(paths, releaseIdentity, runtime, allowLegacyRawDigest = false) {
  const rawManifest = runtime.releaseManifest ? null : await readFile(paths.manifestFile, 'utf8');
  const manifest = validateReleaseManifest(runtime.releaseManifest || JSON.parse(rawManifest));
  const canonicalDigest = sha256(manifest);
  const rawDigest = rawManifest === null ? null : sha256(rawManifest);
  const exactLegacyRaw = allowLegacyRawDigest && rawDigest === LEGACY_OLD_BINDING.manifestRawDigest &&
    releaseIdentity.releaseId === LEGACY_OLD_BINDING.releaseId && releaseIdentity.gitSha === LEGACY_OLD_BINDING.gitSha &&
    releaseIdentity.manifestDigest === LEGACY_OLD_BINDING.manifestRawDigest &&
    manifest.artifacts.backend.image === LEGACY_OLD_BINDING.manifestRepository &&
    manifest.artifacts.backend.digest === LEGACY_OLD_BINDING.imageId;
  const digestMatches = canonicalDigest === releaseIdentity.manifestDigest || exactLegacyRaw;
  if (!digestMatches || manifest.releaseId !== releaseIdentity.releaseId || manifest.source.gitSha !== releaseIdentity.gitSha) {
    throw new ContractError('release manifest file does not match canonical candidate identity', EXIT.IDENTITY);
  }
  return manifest;
}

export function singletonSourceIdentity(state, isRollback) {
  // Before ingress switches, active still names the rollback target even though
  // SINGLETON_TRANSFERRED has moved the worker to candidate. After switching,
  // candidate is null and active is the failed promoted release.
  return isRollback ? (state.candidate || state.active) : state.active;
}

function bindTrustedEnvironment(baseEnvironment, state, releaseIdentity, manifest) {
  const base = baseEnvironment || process.env;
  const expected = {
    BOOKING_RELEASE_ID: releaseIdentity.releaseId,
    BOOKING_GIT_SHA: releaseIdentity.gitSha,
    BOOKING_MANIFEST_DIGEST: releaseIdentity.manifestDigest,
    BOOKING_BACKEND_IMAGE: manifest.artifacts.backend.image,
    BOOKING_GATEWAY_IMAGE: manifest.artifacts.gateway.image,
    BOOKING_CONFIG_SCHEMA_VERSION: manifest.contracts.configSchema,
    BOOKING_MIGRATION_FLOOR: manifest.contracts.migration.expandFloor,
    BOOKING_MIGRATION_CATALOG_DIGEST: manifest.contracts.migration.catalogDigest,
    BOOKING_RUNTIME_ENV_FILE: `/volume1/homes/realzyq/${state.project}/.env`,
    BOOKING_PREPROD_DATA_ROOT: `/volume1/homes/realzyq/${state.project}/data`,
    BOOKING_BASELINE_OLD_RELEASE_ID: state.active.releaseId,
    BOOKING_BASELINE_OLD_GIT_SHA: state.active.gitSha,
    BOOKING_BASELINE_OLD_MANIFEST_DIGEST: state.active.manifestDigest,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (base[key] !== undefined && base[key] !== value) throw new ContractError(`${key} conflicts with canonical release identity`, EXIT.IDENTITY);
  }
  const optionalIdentityKeys = ['BOOKING_TELEGRAM_EXPECTED_BOT_ID', 'BOOKING_TELEGRAM_EXPECTED_BOT_USERNAME', 'BOOKING_TELEGRAM_WEBHOOK_URL',
    'BOOKING_TELEGRAM_BOT_NAME', 'BOOKING_TELEGRAM_BOT_DISPLAY_NAME', 'BOOKING_MIGRATION_BACKUP_RECEIPT_DIGEST',
    'BOOKING_MIGRATION_BACKUP_RECEIPT_HOST_FILE', 'BOOKING_MIGRATION_APPROVED_PENDING_JSON',
    'BOOKING_BASELINE_OLD_CATALOG_DIGEST', 'BOOKING_BASELINE_OLD_FLOOR', 'BOOKING_BASELINE_APPROVED_HISTORY_JSON',
    'BOOKING_BASELINE_SCHEMA_DIFF_RECEIPT_DIGEST', 'BOOKING_BASELINE_SCHEMA_DIFF_RECEIPT_HOST_FILE',
    'BOOKING_BASELINE_BACKUP_RECEIPT_DIGEST', 'BOOKING_BASELINE_BACKUP_RECEIPT_HOST_FILE'];
  const environmentBinding = { ...expected };
  for (const key of optionalIdentityKeys) {
    if (typeof base[key] === 'string' && base[key]) environmentBinding[key === 'BOOKING_MIGRATION_APPROVED_PENDING_JSON' ? 'BOOKING_MIGRATION_APPROVED_PENDING_DIGEST' : key] =
      key === 'BOOKING_MIGRATION_APPROVED_PENDING_JSON' ? sha256(base[key]) : base[key];
  }
  return { env: { ...base, ...expected }, environmentBinding };
}

function requireBoundEnvironment(trustedEnvironment, names) {
  for (const key of names) {
    if (typeof trustedEnvironment.env[key] !== 'string' || !trustedEnvironment.env[key]) {
      throw new ContractError(`${key} is required for the fenced action`, EXIT.IDENTITY);
    }
  }
}

function defaultCommandRunner(executable, argv, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, argv, { cwd: options.cwd, env: options.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    const limit = 64 * 1024;
    const collect = (target) => (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) child.kill('SIGKILL');
      else target.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    const timer = setTimeout(() => child.kill('SIGTERM'), options.timeoutMs);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), overflow: bytes > limit });
    });
  });
}

async function buildPlan(state, args, runtime) {
  const spec = ACTIONS[args.action];
  const releaseIdentity = releaseFor(state, spec);
  if (!releaseIdentity) throw new ContractError('action release identity is unavailable', EXIT.IDENTITY);
  const paths = await trustedReleasePaths(state, releaseIdentity, runtime);
  // A pre-existing rollback target may carry the historical raw-file digest.
  // New candidates remain canonical-only; legacy acceptance is scoped to the
  // immutable state.rollback identity and exact release/Git/image checks.
  const manifest = await loadReleaseManifest(paths, releaseIdentity, runtime, spec.identity === 'rollback');
  const trustedEnvironment = bindTrustedEnvironment(runtime.env, state, releaseIdentity, manifest);
  const docker = runtime.dockerExecutable || await findExecutable(['/var/packages/ContainerManager/target/usr/bin/docker', '/usr/bin/docker']);
  const composePrefix = ['compose', '--project-name', state.project, '--file', paths.composeFile];
  const imageFormat = '{{json .Id}}|{{json .RepoDigests}}|{{json .RepoTags}}|{{json .Config.Labels}}';
  const artifacts = { backend: manifest.artifacts.backend, gateway: manifest.artifacts.gateway };
  const inspectImages = (components) => async ({ runner, env, timeoutMs }) => {
    const evidence = {};
    for (const component of components) {
      const legacy = spec.identity === 'rollback' && isExactLegacyBackend(component, artifacts[component], releaseIdentity);
      const reference = legacy ? LEGACY_OLD_BINDING.uniqueTag : `${artifacts[component].image}:${releaseIdentity.releaseId}`;
      const result = await runner(docker, ['image', 'inspect', '--format', imageFormat, reference], { cwd: paths.releaseDirectory, env, timeoutMs });
      assertResult(result, EXIT.IDENTITY);
      const inspected = parseSafeImageInspect(result.stdout, component);
      evidence[component] = legacy
        ? verifyLegacyDockerImageBinding(component, artifacts[component], releaseIdentity, inspected)
        : verifyDockerImageBinding(component, artifacts[component], releaseIdentity, inspected);
    }
    return evidence;
  };
  const backendImagePreflight = inspectImages(['backend']);
  const oneShotName = `booking-preprod-${sha256(`${args.action}:${args['action-id']}`).slice(7, 19)}`;
  const readbackName = `${oneShotName}-readback`;
  const ledgerReadbackName = `${oneShotName}-ledger`;
  const verifyOneShotArtifacts = (containers) => async ({ runner, env, timeoutMs, preflightEvidence }) => {
    const imageEvidence = await backendImagePreflight({ runner, env, timeoutMs });
    if (preflightEvidence?.backend && imageEvidence.backend.imageId !== preflightEvidence.backend.imageId) {
      throw new ContractError('backend release tag drifted during one-shot action', EXIT.IDENTITY);
    }
    for (const container of containers) {
      const result = await runner(docker, ['container', 'inspect', '--format', '{{.Image}}', container], { cwd: paths.releaseDirectory, env, timeoutMs });
      assertResult(result, EXIT.IDENTITY);
      if (parseContainerImage(result.stdout, 'backend') !== imageEvidence.backend.imageId) {
        throw new ContractError('one-shot container does not use the manifest-bound backend image', EXIT.IDENTITY);
      }
    }
    for (const container of containers) {
      const removed = await runner(docker, ['container', 'rm', container], { cwd: paths.releaseDirectory, env, timeoutMs });
      assertResult(removed, EXIT.IDENTITY);
    }
    return { backend: imageEvidence.backend, containers };
  };
  if (spec.kind === 'singleton-transfer') {
    const sourceIdentity = singletonSourceIdentity(state, spec.identity === 'rollback');
    if (!sourceIdentity || sourceIdentity.slot === releaseIdentity.slot) throw new ContractError('singleton source and target identities are invalid', EXIT.SINGLETON);
    const sourcePaths = await trustedReleasePaths(state, sourceIdentity, { ...runtime, releaseManifest: undefined });
    const sourceManifest = await loadReleaseManifest(sourcePaths, sourceIdentity, { ...runtime, releaseManifest: runtime.sourceReleaseManifest }, spec.identity !== 'rollback');
    const helper = fileURLToPath(new URL('./manage-preprod-singletons.mjs', import.meta.url));
    const singletonAction = spec.identity === 'rollback' ? 'rollback' : 'transfer';
    const helperArgs = ['--action', singletonAction, '--project', state.project, '--compose-file', paths.composeFile,
      '--target-slot', releaseIdentity.slot, '--source-slot', sourceIdentity.slot, '--release-id', releaseIdentity.releaseId,
      '--git-sha', releaseIdentity.gitSha, '--manifest-digest', releaseIdentity.manifestDigest,
      '--backend-image', artifacts.backend.image, '--backend-digest', artifacts.backend.digest,
      '--source-release-id', sourceIdentity.releaseId, '--source-git-sha', sourceIdentity.gitSha,
      '--source-manifest-digest', sourceIdentity.manifestDigest, '--source-backend-image', sourceManifest.artifacts.backend.image,
      '--source-backend-digest', sourceManifest.artifacts.backend.digest];
    const verifySingleton = (value) => {
      let parsed;
      try { parsed = JSON.parse(value.trim().split(/\r?\n/).filter(Boolean).at(-1) || ''); }
      catch { throw new ContractError('singleton transfer readback is not JSON', EXIT.SINGLETON); }
      if (parsed?.schema !== 'booking.singleton-transfer-readback/v1' || parsed.project !== state.project || parsed.action !== singletonAction ||
          parsed.releaseId !== releaseIdentity.releaseId || parsed.gitSha !== releaseIdentity.gitSha || parsed.manifestDigest !== releaseIdentity.manifestDigest ||
          parsed.targetSlot !== releaseIdentity.slot || parsed.sourceSlot !== sourceIdentity.slot || typeof parsed.legacySourceNoOutbox !== 'boolean' ||
          typeof parsed.legacyTargetNoOutbox !== 'boolean' || !Number.isFinite(Date.parse(parsed.observedAt)) ||
          (singletonAction === 'transfer' && (parsed.targetSupported !== true || parsed.targetService !== `order-worker-${releaseIdentity.slot}` ||
            parsed.workerImageId === null || parsed.workerHealth !== 'healthy')) ||
          (singletonAction === 'rollback' && parsed.targetSupported === false &&
            (parsed.targetService !== null || parsed.workerContainerId !== null || parsed.workerImageId !== null || parsed.workerHealth !== 'absent'))) {
        throw new ContractError('singleton transfer readback identity mismatch', EXIT.SINGLETON);
      }
      return parsed;
    };
    return { executable: process.execPath, argv: [helper, ...helperArgs], cwd: paths.releaseDirectory,
      env: trustedEnvironment.env, environmentBinding: trustedEnvironment.environmentBinding,
      artifactBinding: { backend: { image: artifacts.backend.image, digest: artifacts.backend.digest }, singletonAction,
        sourceSlot: sourceIdentity.slot, targetSlot: releaseIdentity.slot },
      preflightArtifacts: backendImagePreflight, verifyExecution: verifySingleton,
      readback: { executable: process.execPath, argv: [helper, '--readback', 'true', ...helperArgs], verify: verifySingleton },
      replayVerifyArtifacts: backendImagePreflight, verifyArtifacts: backendImagePreflight };
  }
  if (spec.kind === 'compose-stage') {
    const services = [`backend-${state.candidate.slot}`, `gateway-${state.candidate.slot}`];
    const portName = state.candidate.slot === 'blue' ? 'BOOKING_BLUE_PORT' : 'BOOKING_GREEN_PORT';
    const activePortName = state.active.slot === 'blue' ? 'BOOKING_BLUE_PORT' : 'BOOKING_GREEN_PORT';
    const actionEnvironment = trustedEnvironment.env;
    const candidatePort = Number(actionEnvironment[portName] || (state.candidate.slot === 'blue' ? 18082 : 18081));
    const activePort = Number(actionEnvironment[activePortName] || (state.active.slot === 'blue' ? 18082 : 18081));
    if (!Number.isInteger(candidatePort) || candidatePort < 1 || candidatePort > 65535) throw new ContractError(`${portName} is invalid`, EXIT.IDENTITY);
    if (!Number.isInteger(activePort) || activePort < 1 || activePort > 65535 || activePort === candidatePort) {
      throw new ContractError('active and candidate loopback ports must be valid and distinct', EXIT.IDENTITY);
    }
    const inspectStageImages = inspectImages(['backend', 'gateway']);
    return { executable: docker, argv: [...composePrefix, 'up', '--no-build', '--no-deps', '--wait', ...services], cwd: paths.releaseDirectory,
      env: trustedEnvironment.env, environmentBinding: trustedEnvironment.environmentBinding,
      artifactBinding: { backend: { image: artifacts.backend.image, digest: artifacts.backend.digest },
        gateway: { image: artifacts.gateway.image, digest: artifacts.gateway.digest, frontendAssetDigest: artifacts.gateway.frontendAssetDigest } },
      preflight: { executable: docker, argv: [...composePrefix, 'config', '--services'], verify: (value) => {
        const available = new Set(value.trim().split(/\r?\n/).filter(Boolean));
        for (const service of services) if (!available.has(service)) throw new ContractError(`compose does not define inactive-slot candidate service ${service}`, EXIT.IDENTITY);
      } },
      preflightArtifacts: inspectStageImages,
      readback: { executable: process.execPath, argv: [fileURLToPath(new URL('./probe-fenced-candidate.mjs', import.meta.url)),
        '--base-url', `http://127.0.0.1:${candidatePort}`, '--release-id', state.candidate.releaseId, '--git-sha', state.candidate.gitSha,
        '--manifest-digest', state.candidate.manifestDigest, '--slot', state.candidate.slot], verify: (value) => {
        let parsed; try { parsed = JSON.parse(value); } catch { throw new ContractError('candidate readback is not JSON', EXIT.READINESS); }
        if (parsed.status !== 'pass' || parsed.releaseId !== state.candidate.releaseId || parsed.gitSha !== state.candidate.gitSha ||
            parsed.manifestDigest !== state.candidate.manifestDigest || parsed.slot !== state.candidate.slot) throw new ContractError('candidate runtime identity readback mismatch', EXIT.READINESS);
        return parsed;
      } },
      verifyArtifacts: async ({ runner, env, timeoutMs, statePath, preflightEvidence }) => {
        const imageEvidence = await inspectStageImages({ runner, env, timeoutMs });
        for (const component of ['backend', 'gateway']) {
          if (imageEvidence[component].imageId !== preflightEvidence[component].imageId) throw new ContractError(`${component} release tag drifted during candidate start`, EXIT.IDENTITY);
        }
        const containerIds = {};
        for (const component of ['backend', 'gateway']) {
          const service = `${component}-${releaseIdentity.slot}`;
          const idResult = await runner(docker, [...composePrefix, 'ps', '-q', service], { cwd: paths.releaseDirectory, env, timeoutMs });
          assertResult(idResult, EXIT.IDENTITY);
          const containerId = idResult.stdout.trim();
          if (!/^[0-9a-f]{12,64}$/.test(containerId)) throw new ContractError(`${component} candidate container ID is invalid`, EXIT.IDENTITY);
          containerIds[component] = containerId;
          const containerResult = await runner(docker, ['container', 'inspect', '--format', '{{.Image}}', containerId], { cwd: paths.releaseDirectory, env, timeoutMs });
          assertResult(containerResult, EXIT.IDENTITY);
          if (parseContainerImage(containerResult.stdout, component) !== imageEvidence[component].imageId) {
            throw new ContractError(`${component} running container does not use the manifest-bound image`, EXIT.IDENTITY);
          }
        }
        const temporaryRoot = join(dirname(statePath), 'executor', 'tmp');
        await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
        const frontendDirectory = await mkdtemp(join(temporaryRoot, 'gateway-h5-'));
        try {
          const copyResult = await runner(docker, ['cp', `${containerIds.gateway}:/usr/share/nginx/html/.`, frontendDirectory], { cwd: paths.releaseDirectory, env, timeoutMs });
          assertResult(copyResult, EXIT.IDENTITY);
          const observedFrontendDigest = await directoryDigest(frontendDirectory, 'running gateway H5 directory');
          if (observedFrontendDigest !== artifacts.gateway.frontendAssetDigest) throw new ContractError('running gateway H5 digest does not match release manifest', EXIT.IDENTITY);
          return { ...imageEvidence, frontendAssetDigest: observedFrontendDigest };
        } finally { await rm(frontendDirectory, { recursive: true, force: true }); }
      } };
  }
  if (spec.kind === 'compose-migrate') {
    requireBoundEnvironment(trustedEnvironment, ['BOOKING_MIGRATION_BACKUP_RECEIPT_DIGEST', 'BOOKING_MIGRATION_BACKUP_RECEIPT_HOST_FILE', 'BOOKING_MIGRATION_APPROVED_PENDING_JSON']);
    let approvedPending;
    try { approvedPending = JSON.parse(trustedEnvironment.env.BOOKING_MIGRATION_APPROVED_PENDING_JSON); }
    catch { throw new ContractError('approved migration allowlist is not JSON', EXIT.IDENTITY); }
    if (!Array.isArray(approvedPending)) throw new ContractError('approved migration allowlist is invalid', EXIT.IDENTITY);
    const floorParts = manifest.contracts.migration.expandFloor.split('-');
    const expectedMigration = { releaseId: releaseIdentity.releaseId, gitSha: releaseIdentity.gitSha, manifestDigest: releaseIdentity.manifestDigest,
      migrationCatalogDigest: manifest.contracts.migration.catalogDigest, migrationFloor: manifest.contracts.migration.expandFloor,
      backupReceiptDigest: trustedEnvironment.env.BOOKING_MIGRATION_BACKUP_RECEIPT_DIGEST, approvedPending,
      ledgerHead: `${floorParts.slice(1).join('')}${floorParts[0]}` };
    return { executable: docker, argv: [...composePrefix, '--profile', 'migrate', 'run', '--name', oneShotName, 'schema-migrate'], cwd: paths.releaseDirectory,
      env: trustedEnvironment.env, environmentBinding: trustedEnvironment.environmentBinding,
      artifactBinding: { backend: { image: artifacts.backend.image, digest: artifacts.backend.digest } },
      preflightArtifacts: backendImagePreflight,
      verifyExecution: (value) => verifyMigrationReceipt(value, expectedMigration, 'apply'),
      readback: { executable: docker, argv: [...composePrefix, '--profile', 'migrate-readback', 'run', '--name', readbackName, 'schema-migration-readback'],
        verify: (value) => verifyMigrationReceipt(value, expectedMigration, 'verify') },
      verifyArtifacts: verifyOneShotArtifacts([oneShotName, readbackName]), replayVerifyArtifacts: verifyOneShotArtifacts([readbackName]) };
  }
  if (spec.kind === 'compose-baseline') {
    const baselineKeys = ['BOOKING_BASELINE_OLD_RELEASE_ID', 'BOOKING_BASELINE_OLD_GIT_SHA', 'BOOKING_BASELINE_OLD_MANIFEST_DIGEST',
      'BOOKING_BASELINE_OLD_CATALOG_DIGEST', 'BOOKING_BASELINE_OLD_FLOOR', 'BOOKING_BASELINE_APPROVED_HISTORY_JSON',
      'BOOKING_BASELINE_SCHEMA_DIFF_RECEIPT_DIGEST', 'BOOKING_BASELINE_SCHEMA_DIFF_RECEIPT_HOST_FILE',
      'BOOKING_BASELINE_BACKUP_RECEIPT_DIGEST', 'BOOKING_BASELINE_BACKUP_RECEIPT_HOST_FILE'];
    requireBoundEnvironment(trustedEnvironment, baselineKeys);
    let approvedHistory;
    try { approvedHistory = JSON.parse(trustedEnvironment.env.BOOKING_BASELINE_APPROVED_HISTORY_JSON); }
    catch { throw new ContractError('approved baseline history is not JSON', EXIT.IDENTITY); }
    if (!Array.isArray(approvedHistory) || approvedHistory.length < 1) throw new ContractError('approved baseline history is invalid', EXIT.IDENTITY);
    const expectedBaseline = { releaseId: trustedEnvironment.env.BOOKING_BASELINE_OLD_RELEASE_ID,
      gitSha: trustedEnvironment.env.BOOKING_BASELINE_OLD_GIT_SHA, manifestDigest: trustedEnvironment.env.BOOKING_BASELINE_OLD_MANIFEST_DIGEST,
      migrationCatalogDigest: trustedEnvironment.env.BOOKING_BASELINE_OLD_CATALOG_DIGEST,
      migrationFloor: trustedEnvironment.env.BOOKING_BASELINE_OLD_FLOOR,
      schemaDiffReceiptDigest: trustedEnvironment.env.BOOKING_BASELINE_SCHEMA_DIFF_RECEIPT_DIGEST,
      backupReceiptDigest: trustedEnvironment.env.BOOKING_BASELINE_BACKUP_RECEIPT_DIGEST,
      historyDigest: sha256(JSON.stringify(approvedHistory)) };
    return { executable: docker, argv: [...composePrefix, '--profile', 'baseline-ledger', 'run', '--name', oneShotName, 'schema-baseline-ledger'], cwd: paths.releaseDirectory,
      env: trustedEnvironment.env, environmentBinding: trustedEnvironment.environmentBinding,
      artifactBinding: { backend: { image: artifacts.backend.image, digest: artifacts.backend.digest }, baseline: expectedBaseline },
      preflightArtifacts: backendImagePreflight,
      verifyExecution: (value) => verifyBaselineReceipt(value, expectedBaseline, 'apply'),
      readback: { executable: docker, argv: [...composePrefix, '--profile', 'baseline-readback', 'run', '--name', readbackName, 'schema-baseline-readback'],
        verify: (value) => verifyBaselineReceipt(value, expectedBaseline, 'verify') },
      verifyArtifacts: verifyOneShotArtifacts([oneShotName, readbackName]), replayVerifyArtifacts: verifyOneShotArtifacts([readbackName]) };
  }
  if (spec.kind === 'compose-webhook') {
    requireBoundEnvironment(trustedEnvironment, ['BOOKING_TELEGRAM_WEBHOOK_URL', 'BOOKING_MIGRATION_BACKUP_RECEIPT_DIGEST',
      'BOOKING_MIGRATION_BACKUP_RECEIPT_HOST_FILE', 'BOOKING_MIGRATION_APPROVED_PENDING_JSON']);
    if (!trustedEnvironment.env.BOOKING_TELEGRAM_EXPECTED_BOT_ID && !trustedEnvironment.env.BOOKING_TELEGRAM_EXPECTED_BOT_USERNAME) {
      throw new ContractError('Telegram expected bot identity is required', EXIT.IDENTITY);
    }
    const expectedWebhook = { releaseId: releaseIdentity.releaseId, gitSha: releaseIdentity.gitSha, manifestDigest: releaseIdentity.manifestDigest,
      configSchema: manifest.contracts.configSchema, migrationFloor: manifest.contracts.migration.expandFloor,
      migrationCatalogDigest: manifest.contracts.migration.catalogDigest, webhookUrl: trustedEnvironment.env.BOOKING_TELEGRAM_WEBHOOK_URL,
      botId: trustedEnvironment.env.BOOKING_TELEGRAM_EXPECTED_BOT_ID ? Number(trustedEnvironment.env.BOOKING_TELEGRAM_EXPECTED_BOT_ID) : null,
      botUsername: trustedEnvironment.env.BOOKING_TELEGRAM_EXPECTED_BOT_USERNAME || null };
    const floorParts = manifest.contracts.migration.expandFloor.split('-');
    const expectedMigration = { releaseId: releaseIdentity.releaseId, gitSha: releaseIdentity.gitSha, manifestDigest: releaseIdentity.manifestDigest,
      migrationCatalogDigest: manifest.contracts.migration.catalogDigest, migrationFloor: manifest.contracts.migration.expandFloor,
      backupReceiptDigest: trustedEnvironment.env.BOOKING_MIGRATION_BACKUP_RECEIPT_DIGEST, approvedPending: [],
      ledgerHead: `${floorParts.slice(1).join('')}${floorParts[0]}` };
    return { executable: docker, argv: [...composePrefix, '--profile', 'telegram-webhook-set', 'run', '--no-deps', '--name', oneShotName, 'telegram-webhook-set'], cwd: paths.releaseDirectory,
      env: trustedEnvironment.env, environmentBinding: trustedEnvironment.environmentBinding,
      artifactBinding: { backend: { image: artifacts.backend.image, digest: artifacts.backend.digest }, webhook: expectedWebhook,
        migrationLedger: { catalogDigest: expectedMigration.migrationCatalogDigest, floor: expectedMigration.migrationFloor,
          backupReceiptDigest: expectedMigration.backupReceiptDigest, ledgerHead: expectedMigration.ledgerHead } },
      preflight: { executable: docker, argv: [...composePrefix, '--profile', 'migrate-readback', 'run', '--no-deps', '--name', ledgerReadbackName, 'schema-migration-readback'],
        verify: (value) => verifyMigrationReceipt(value, expectedMigration, 'verify') },
      preflightArtifacts: backendImagePreflight,
      verifyExecution: (value) => verifyWebhookReceipt(value, expectedWebhook, 'set'),
      readback: { executable: docker, argv: [...composePrefix, '--profile', 'telegram-webhook-readback', 'run', '--no-deps', '--name', readbackName, 'telegram-webhook-readback'],
        verify: (value) => verifyWebhookReceipt(value, expectedWebhook, 'verify') },
      verifyArtifacts: verifyOneShotArtifacts([ledgerReadbackName, oneShotName, readbackName]),
      replayVerifyArtifacts: verifyOneShotArtifacts([ledgerReadbackName, readbackName]) };
  }
  const helper = runtime.ingressExecutable || await findTrustedRootExecutable(['/usr/local/libexec/happybooking/switch-preprod-ingress']);
  const hostname = 'booking-preprod.happybooking.uk';
  const upstream = `gateway-${releaseIdentity.slot}:8080`;
  return { executable: helper, argv: ['--project', state.project, '--hostname', hostname, '--upstream', upstream,
      '--release', releaseIdentity.releaseId, '--manifest-digest', releaseIdentity.manifestDigest, '--operation-id', state.operationId,
      '--fencing-epoch', String(state.fencingEpoch)], cwd: paths.releaseDirectory,
    env: trustedEnvironment.env, environmentBinding: trustedEnvironment.environmentBinding,
    readback: { executable: helper, argv: ['--readback', '--project', state.project, '--hostname', hostname], verify: (value) => {
      let parsed; try { parsed = JSON.parse(value); } catch { throw new ContractError('ingress readback is not JSON', EXIT.INGRESS); }
      const expectedKeys = ['schema', 'project', 'hostname', 'upstream', 'releaseId', 'manifestDigest', 'operationId', 'fencingEpoch', 'observedAt'];
      if (!parsed || Object.keys(parsed).sort().join(',') !== [...expectedKeys].sort().join(',') || parsed.schema !== 'booking.ingress-readback/v1' ||
          parsed.project !== state.project || parsed.hostname !== hostname || parsed.upstream !== upstream || parsed.releaseId !== releaseIdentity.releaseId ||
          parsed.manifestDigest !== releaseIdentity.manifestDigest || parsed.operationId !== state.operationId || parsed.fencingEpoch !== state.fencingEpoch ||
          !Number.isFinite(Date.parse(parsed.observedAt))) throw new ContractError('ingress readback identity mismatch', EXIT.INGRESS);
      return parsed;
    } } };
}

function commandIdentity(plan) {
  return sha256({ executable: plan.executable, argv: plan.argv, cwd: plan.cwd,
    preflight: plan.preflight ? { executable: plan.preflight.executable, argv: plan.preflight.argv } : null,
    readback: plan.readback ? { executable: plan.readback.executable, argv: plan.readback.argv } : null,
    readbackFromExecution: plan.readbackFromExecution === true, artifactBinding: plan.artifactBinding || null,
    environmentBinding: plan.environmentBinding || null });
}

function assertResult(result, exitCode) {
  if (!result || result.exitCode !== 0 || result.signal || result.overflow) throw new ContractError('external action failed or exceeded its bounded output', exitCode);
}

async function verifyCurrentExternalState(plan, context) {
  if (!plan.readback) throw new ContractError('recorded action has no independent replay readback', EXIT.SINGLETON);
  if (plan.preflight) {
    const preflight = await context.runner(plan.preflight.executable, plan.preflight.argv, {
      cwd: plan.cwd, env: context.env, timeoutMs: context.timeoutMs,
    });
    assertResult(preflight, EXIT.IDENTITY);
    plan.preflight.verify(preflight.stdout);
  }
  let preflightArtifactEvidence = null;
  if (plan.preflightArtifacts) preflightArtifactEvidence = await plan.preflightArtifacts(context);
  const readback = await context.runner(plan.readback.executable, plan.readback.argv, {
    cwd: plan.cwd, env: context.env, timeoutMs: context.timeoutMs,
  });
  assertResult(readback, EXIT.IDENTITY);
  const verification = { runtime: plan.readback.verify(readback.stdout) };
  const artifactVerifier = plan.replayVerifyArtifacts || plan.verifyArtifacts;
  if (artifactVerifier) verification.artifacts = await artifactVerifier({ ...context, preflightEvidence: preflightArtifactEvidence });
  return { verification, readbackOutputDigest: sha256(readback.stdout) };
}

export async function runFencedAction(args, runtime = {}) {
  validateArgs(args);
  const spec = ACTIONS[args.action];
  const now = runtime.now || (() => new Date());
  const firstNow = now();
  if (!(firstNow instanceof Date) || !Number.isFinite(firstNow.getTime())) throw new ContractError('trusted runtime clock is invalid', EXIT.SWITCH);
  const statePath = await canonicalStatePath({ environment: args.environment, project: args.project, deployStateRoot: runtime.deployStateRoot });
  return withDeployStateLock(statePath, async (state) => {
    const { resourceIds, releaseIdentity } = assertStateBinding(state, args, spec, firstNow.getTime());
    const plan = await (runtime.planBuilder || buildPlan)(state, args, runtime);
    const requestBody = { schema: 'booking.fenced-action-request/v1', environment: state.environment, project: state.project,
      action: args.action, actionId: args['action-id'], operationId: state.operationId, approvalId: state.approvalId,
      generation: state.generation, fencingEpoch: state.fencingEpoch, leaseId: state.lease.leaseId, holderId: state.lease.holderId,
      manifestDigest: releaseIdentity.manifestDigest, releaseIdentity, resourceIds, commandDigest: commandIdentity(plan) };
    const requestDigest = sha256(requestBody);
    const priorReceipt = await readExecutorReceipt(statePath, state.fencingEpoch, args.action, args['action-id']);
    if (priorReceipt && (priorReceipt.requestDigest !== requestDigest || priorReceipt.status !== 'pass')) throw new ContractError('existing action receipt does not match this request', EXIT.SINGLETON);
    const locks = await acquireResourceLocks(statePath, resourceIds);
    try {
      const runner = runtime.commandRunner || defaultCommandRunner;
      if (priorReceipt) {
        const resourceStates = [];
        const acceptedPriorReceiptDigests = new Set([priorReceipt.receiptDigest]);
        for (const lock of locks) {
          const resourceState = await inspectLockedResourceState(lock, { environment: state.environment, project: state.project, resourceId: lock.resourceId });
          if (resourceState.highestAcceptedFencingEpoch !== state.fencingEpoch || resourceState.operationId !== state.operationId ||
              resourceState.manifestDigest !== releaseIdentity.manifestDigest) throw new ContractError(`resource ${lock.resourceId} does not match recorded action identity`, EXIT.SINGLETON);
          const pendingMatches = resourceState.pendingAction?.actionId === args['action-id'] && resourceState.pendingAction?.requestDigest === requestDigest;
          let completedMatches = resourceState.pendingAction === null && resourceState.receiptChainHead === priorReceipt.receiptDigest;
          if (!completedMatches && resourceState.pendingAction === null && resourceState.receiptChainHead) {
            const priorRecovery = await readExecutorRecoveryReceiptByDigest(statePath, resourceState.receiptChainHead);
            completedMatches = priorRecovery?.originalReceiptDigest === priorReceipt.receiptDigest && priorRecovery?.requestDigest === requestDigest &&
              priorRecovery?.action === args.action && priorRecovery?.actionId === args['action-id'] && priorRecovery?.operationId === state.operationId &&
              priorRecovery?.fencingEpoch === state.fencingEpoch && priorRecovery?.manifestDigest === releaseIdentity.manifestDigest;
            if (completedMatches) acceptedPriorReceiptDigests.add(resourceState.receiptChainHead);
          }
          if (!pendingMatches && !completedMatches) throw new ContractError(`resource ${lock.resourceId} cannot replay the recorded action`, EXIT.SINGLETON);
          resourceStates.push(resourceState);
        }
        const replay = await verifyCurrentExternalState(plan, { runner, env: plan.env || runtime.env || process.env,
          timeoutMs: Math.max(1, Date.parse(state.lease.expiresAt) - now().getTime() - 500), statePath });
        const recoveredAt = now();
        if (!(recoveredAt instanceof Date) || recoveredAt.getTime() >= Date.parse(state.lease.expiresAt)) throw new ContractError('lease expired before replay readback completed', EXIT.SINGLETON);
        if (resourceStates.some((item) => item.pendingAction !== null)) {
          const recoveryBody = { schema: 'booking.external-action-recovery/v1', environment: state.environment, project: state.project,
            action: args.action, actionId: args['action-id'], operationId: state.operationId, fencingEpoch: state.fencingEpoch,
            manifestDigest: releaseIdentity.manifestDigest, releaseIdentity, requestDigest, originalReceiptDigest: priorReceipt.receiptDigest,
            recoveredAt: recoveredAt.toISOString(), readbackOutputDigest: replay.readbackOutputDigest, verification: replay.verification,
            resources: resourceStates.map((item) => ({ resourceId: item.resourceId, previousReceiptDigest: item.receiptChainHead, wasPending: item.pendingAction !== null })) };
          const recoveryReceipt = { ...recoveryBody, receiptDigest: sha256(recoveryBody) };
          await writeExecutorRecoveryReceipt(statePath, recoveryReceipt);
          for (const lock of locks) await recoverResourceAction(lock, { environment: state.environment, project: state.project, resourceId: lock.resourceId,
            fencingEpoch: state.fencingEpoch, operationId: state.operationId, actionId: args['action-id'], requestDigest, now: recoveredAt.toISOString() },
          [...acceptedPriorReceiptDigests], recoveryReceipt.receiptDigest);
          return recoveryReceipt;
        }
        return priorReceipt;
      }
      let preflightArtifactEvidence = null;
      if (plan.preflight) {
        const preflight = await runner(plan.preflight.executable, plan.preflight.argv, { cwd: plan.cwd, env: plan.env || runtime.env || process.env,
          timeoutMs: Math.max(1, Date.parse(state.lease.expiresAt) - firstNow.getTime() - 1_000) });
        assertResult(preflight, EXIT.IDENTITY);
        plan.preflight.verify(preflight.stdout);
      }
      if (plan.preflightArtifacts) {
        preflightArtifactEvidence = await plan.preflightArtifacts({ runner, env: plan.env || runtime.env || process.env,
          timeoutMs: Math.max(1, Date.parse(state.lease.expiresAt) - firstNow.getTime() - 1_000) });
      }
      const accepted = [];
      const allowedPreviousManifestDigest = spec.identity === 'rollback' && state.phase === 'ROLLBACK_PENDING'
        ? (state.candidate || state.active)?.manifestDigest : null;
      for (const lock of locks) accepted.push(await acceptResourceEpoch(lock, {
        environment: state.environment, project: state.project, resourceId: lock.resourceId, fencingEpoch: state.fencingEpoch,
        operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest, allowedPreviousManifestDigest,
        actionId: args['action-id'], requestDigest, now: firstNow.toISOString(),
      }));
      let execution;
      let readback;
      let verification;
      let completedAt;
      try {
        const remaining = Date.parse(state.lease.expiresAt) - firstNow.getTime();
        if (remaining < 2_000) throw new ContractError('lease has insufficient remaining time for external action', EXIT.SINGLETON);
        execution = await runner(plan.executable, plan.argv, { cwd: plan.cwd, env: plan.env || runtime.env || process.env, timeoutMs: remaining - 1_000 });
        assertResult(execution, spec.kind === 'compose-migrate' || spec.kind === 'compose-baseline' ? EXIT.DATABASE : spec.kind.includes('webhook') || spec.kind.includes('ingress') ? EXIT.INGRESS : EXIT.SWITCH);
        const executionVerification = plan.verifyExecution ? plan.verifyExecution(execution.stdout) : null;
        readback = execution;
        if (plan.readback) {
          readback = await runner(plan.readback.executable, plan.readback.argv, { cwd: plan.cwd, env: plan.env || runtime.env || process.env, timeoutMs: Math.max(1, Date.parse(state.lease.expiresAt) - now().getTime() - 500) });
          assertResult(readback, spec.kind === 'compose-migrate' ? EXIT.DATABASE : spec.kind.includes('ingress') ? EXIT.INGRESS : EXIT.READINESS);
        }
        verification = { ...(executionVerification ? { execution: executionVerification } : {}), runtime: (plan.readback?.verify || plan.verify)(readback.stdout) };
        if (plan.verifyArtifacts) {
          verification.artifacts = await plan.verifyArtifacts({ runner, env: plan.env || runtime.env || process.env,
            timeoutMs: Math.max(1, Date.parse(state.lease.expiresAt) - now().getTime() - 500), statePath, preflightEvidence: preflightArtifactEvidence });
        }
        completedAt = now();
        if (!(completedAt instanceof Date) || completedAt.getTime() >= Date.parse(state.lease.expiresAt)) throw new ContractError('lease expired before external action readback completed', EXIT.SINGLETON);
      } catch (error) {
        const failedAt = now();
        const failureBody = { ...requestBody, schema: 'booking.external-action-receipt/v1', requestDigest, startedAt: firstNow.toISOString(),
          completedAt: failedAt instanceof Date && Number.isFinite(failedAt.getTime()) ? failedAt.toISOString() : firstNow.toISOString(), status: 'fail',
          executionOutputDigest: sha256(execution?.stdout || ''), readbackOutputDigest: sha256(readback?.stdout || ''),
          verification: { error: error instanceof ContractError ? error.message : 'external action failed' },
          resources: accepted.map((item) => ({ resourceId: item.resourceId, highestAcceptedFencingEpoch: item.highestAcceptedFencingEpoch, previousReceiptDigest: item.receiptChainHead })) };
        const failureReceipt = { ...failureBody, receiptDigest: sha256(failureBody) };
        await writeExecutorReceipt(statePath, failureReceipt);
        throw error;
      }
      const receiptBody = { ...requestBody, schema: 'booking.external-action-receipt/v1', requestDigest, startedAt: firstNow.toISOString(), completedAt: completedAt.toISOString(),
        status: 'pass', executionOutputDigest: sha256(execution.stdout), readbackOutputDigest: sha256(readback.stdout), verification,
        resources: accepted.map((item) => ({ resourceId: item.resourceId, highestAcceptedFencingEpoch: item.highestAcceptedFencingEpoch, previousReceiptDigest: item.receiptChainHead })) };
      const receipt = { ...receiptBody, receiptDigest: sha256(receiptBody) };
      await writeExecutorReceipt(statePath, receipt);
      for (const lock of locks) await completeResourceAction(lock, { environment: state.environment, project: state.project, resourceId: lock.resourceId,
        fencingEpoch: state.fencingEpoch, operationId: state.operationId, actionId: args['action-id'], requestDigest, now: completedAt.toISOString() }, receipt.receiptDigest);
      return receipt;
    } finally { await releaseResourceLocks(locks); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result;
  let exitCode = EXIT.PASS;
  try {
    const receipt = await runFencedAction(parseArgs(process.argv.slice(2)));
    result = gateResult({ gate: 'external-fenced-action', releaseId: receipt.releaseIdentity.releaseId, slot: receipt.releaseIdentity.slot,
      checks: [{ name: receipt.action, status: 'pass', code: 'FENCED_ACTION_VERIFIED', detail: `epoch=${receipt.fencingEpoch};receipt=${receipt.receiptDigest}` }] });
  } catch (error) {
    const failure = error instanceof ContractError ? error : new ContractError('unexpected fenced executor failure', EXIT.SWITCH);
    exitCode = failure.exitCode;
    result = gateResult({ gate: 'external-fenced-action', checks: [{ name: 'execution', status: 'fail', code: 'FENCED_ACTION_REJECTED', detail: failure.message }] });
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = exitCode;
}
