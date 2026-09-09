#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, ContractError, EXIT, gateResult, parseArgs, readJsonFile, sha256, validateReleaseManifest } from './lib/contracts.mjs';
import { composeBundleDigest, digestFile, directoryDigest } from './lib/artifacts.mjs';
import { canonicalStatePath, withDeployStateLock } from './lib/deploy-state-store.mjs';
import { acceptResourceEpoch, acquireResourceLocks, adoptPriorEpochPendingAction, completeResourceAction, inspectLockedResourceState, readCanonicalExecutorReceiptByDigest, readExecutorReceipt, readExecutorRecoveryReceiptByDigest, recoverResourceAction, releaseResourceLocks, supersedePriorEpochPendingAction, writeExecutorReceipt, writeExecutorRecoveryReceipt } from './lib/fenced-resource-store.mjs';
import { LEGACY_OLD_BINDING } from './lib/legacy-preprod.mjs';
import { ROLLBACK_MODE, rollbackModeForState } from './lib/state-machine.mjs';
import { verifyRegistrySupplyChainRuntime } from './lib/registry-runtime-gate.mjs';
import { TELEGRAM_PROXY_URL, verifyTelegramEgressReceipt } from './verify-telegram-egress.mjs';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ALLOWED_FIELDS = new Set([
  'action', 'execute', 'environment', 'project', 'approval-id', 'expected-generation', 'expected-fencing-epoch',
  'manifest-digest', 'operation-id', 'lease-id', 'holder-id', 'resource-id', 'action-id',
]);
const ACTIONS = Object.freeze({
  'preprod-baseline-ledger': { phases: ['STAGED'], primary: 'databaseRef', resources: ['databaseRef', 'dataNetwork'], kind: 'compose-baseline' },
  'preprod-expand-migrate': { phases: ['STAGED'], primary: 'databaseRef', resources: ['databaseRef', 'dataNetwork'], kind: 'compose-migrate' },
  'preprod-prepare-telegram-egress': { phases: ['EXPAND_MIGRATED', 'ROLLED_BACK'], primary: 'telegram', resources: ['telegram'], kind: 'compose-egress' },
  'preprod-stage': { phases: ['EXPAND_MIGRATED', 'ROLLED_BACK'], primary: 'edgeNetwork', resources: ['edgeNetwork'], kind: 'compose-stage' },
  'preprod-probe-candidate': { phases: ['CANDIDATE_STARTED'], primary: 'candidateProbe', resources: ['candidateProbe'], kind: 'release-probe' },
  'preprod-probe-active': { phases: ['CANDIDATE_READY'], primary: 'activeProbe', resources: ['activeProbe'], kind: 'release-probe', identity: 'active' },
  'preprod-probe-observation': { phases: ['OBSERVING'], primary: 'observationProbe', resources: ['observationProbe'], kind: 'release-probe', identity: 'active' },
  'preprod-probe-rollback': { phases: ['ROLLBACK_PENDING'], primary: 'rollbackProbe', resources: ['rollbackProbe'], kind: 'release-probe', identity: 'rollback' },
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
  if (args.action === 'preprod-rollback-ingress' && rollbackModeForState(state) !== ROLLBACK_MODE.POST_SWITCH_FULL) {
    throw new ContractError('ingress rollback is forbidden before the candidate ingress promotion', EXIT.ROLLBACK);
  }
  const releaseIdentity = releaseFor(state, spec);
  if (!releaseIdentity) throw new ContractError('action release identity is unavailable', EXIT.IDENTITY);
  if (!releaseIdentity || releaseIdentity.manifestDigest !== args['manifest-digest']) throw new ContractError('action release manifest identity mismatch', EXIT.IDENTITY);
  const resourceMap = { ...state.resources, telegram: `telegram:${state.project}`,
    candidateProbe: `probe:${state.project}:candidate`, activeProbe: `probe:${state.project}:active`,
    observationProbe: `probe:${state.project}:observation`, rollbackProbe: `probe:${state.project}:rollback` };
  if (args['resource-id'] !== resourceMap[spec.primary]) throw new ContractError('requested resource does not match canonical action resource', EXIT.IDENTITY);
  return { resourceIds: spec.resources.map((key) => resourceMap[key]), releaseIdentity };
}

async function trustedDirectory(path, label, runtime) {
  const canonical = await realpath(path).catch(() => { throw new ContractError(`${label} cannot be resolved`, EXIT.IDENTITY); });
  const metadata = await stat(canonical);
  if (canonical !== resolve(path) || !metadata.isDirectory() ||
      (!runtime.allowInsecureTestPaths && process.platform !== 'win32' && (metadata.uid !== 0 || (metadata.mode & 0o022) !== 0))) {
    throw new ContractError(`${label} must be a canonical root-owned non-writable directory`, EXIT.IDENTITY);
  }
  return canonical;
}

async function trustedReleasePaths(state, releaseIdentity, runtime) {
  const configuredRoot = runtime.releaseRoot || `/volume1/homes/realzyq/${state.project}/releases`;
  if (!isAbsolute(configuredRoot)) throw new ContractError('trusted release root must be absolute', EXIT.IDENTITY);
  const trustedAncestors = [];
  for (let current = resolve(configuredRoot); ; current = dirname(current)) {
    trustedAncestors.push(current);
    if (dirname(current) === current) break;
  }
  for (const ancestor of trustedAncestors.reverse()) await trustedDirectory(ancestor, 'trusted release parent directory', runtime);
  const root = await trustedDirectory(configuredRoot, 'trusted release root', runtime);
  const releaseDirectory = await trustedDirectory(join(root, releaseIdentity.releaseId), 'action release directory', runtime);
  const containment = relative(root, releaseDirectory);
  if (!containment || containment.startsWith('..') || isAbsolute(containment)) throw new ContractError('candidate release directory escapes trusted root', EXIT.IDENTITY);
  try {
    await stat(join(releaseDirectory, '.env'));
    throw new ContractError('release-local .env is forbidden because Compose would consume mutable implicit input', EXIT.IDENTITY);
  } catch (error) {
    if (error instanceof ContractError) throw error;
    if (error?.code !== 'ENOENT') throw new ContractError('release-local .env status cannot be verified', EXIT.IDENTITY);
  }
  let composeFile; let egressComposeFile = null;
  const exactLegacy = releaseIdentity.releaseId === LEGACY_OLD_BINDING.releaseId && releaseIdentity.gitSha === LEGACY_OLD_BINDING.gitSha &&
    releaseIdentity.manifestDigest === LEGACY_OLD_BINDING.manifestRawDigest;
  if (exactLegacy) {
    composeFile = await realpath(runtime.legacyComposeFile || fileURLToPath(new URL('./legacy-preprod-rollback.compose.yml', import.meta.url)))
      .catch(() => { throw new ContractError('fixed legacy rollback compose cannot be resolved', EXIT.IDENTITY); });
    const composeMetadata = await stat(composeFile);
    const composeDigest = await digestFile(composeFile);
    if (!composeMetadata.isFile() || (process.platform !== 'win32' && (composeMetadata.uid !== 0 || (composeMetadata.mode & 0o022) !== 0)) ||
        composeDigest !== LEGACY_OLD_BINDING.rollbackComposeDigest) {
      throw new ContractError('fixed legacy rollback compose identity is invalid', EXIT.IDENTITY);
    }
  } else {
    await trustedDirectory(join(releaseDirectory, 'ops'), 'release ops directory', runtime);
    await trustedDirectory(join(releaseDirectory, 'ops', 'compose'), 'release compose directory', runtime);
    composeFile = await realpath(join(releaseDirectory, 'ops', 'compose', 'compose.preprod.yml')).catch(() => { throw new ContractError('candidate compose file cannot be resolved', EXIT.IDENTITY); });
    egressComposeFile = await realpath(join(releaseDirectory, 'ops', 'compose', 'compose.preprod-telegram-egress.yml')).catch(() => { throw new ContractError('candidate Telegram egress Compose file cannot be resolved', EXIT.IDENTITY); });
    const composeContainment = relative(releaseDirectory, composeFile);
    if (!composeContainment || composeContainment.startsWith('..') || isAbsolute(composeContainment)) throw new ContractError('candidate compose file escapes immutable release directory', EXIT.IDENTITY);
    const egressContainment = relative(releaseDirectory, egressComposeFile);
    if (!egressContainment || egressContainment.startsWith('..') || isAbsolute(egressContainment)) throw new ContractError('candidate Telegram egress Compose file escapes immutable release directory', EXIT.IDENTITY);
  }
  const manifestFile = runtime.releaseManifest ? null : await realpath(join(releaseDirectory, 'release-manifest.json')).catch(() => { throw new ContractError('candidate release manifest cannot be resolved', EXIT.IDENTITY); });
  if (manifestFile) {
    const manifestContainment = relative(releaseDirectory, manifestFile);
    if (!manifestContainment || manifestContainment.startsWith('..') || isAbsolute(manifestContainment)) throw new ContractError('candidate release manifest escapes immutable release directory', EXIT.IDENTITY);
  }
  for (const [label, path] of [['compose file', composeFile], ...(egressComposeFile ? [['Telegram egress Compose file', egressComposeFile]] : []), ...(manifestFile ? [['release manifest', manifestFile]] : [])]) {
    const metadata = await stat(path);
    if (!metadata.isFile() || (process.platform !== 'win32' && (metadata.uid !== 0 || (metadata.mode & 0o022) !== 0))) {
      throw new ContractError(`${label} must be root-owned and immutable`, EXIT.IDENTITY);
    }
  }
  return { releaseDirectory, composeFile, egressComposeFile, manifestFile };
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

function composeNetworkKeys(service) {
  if (Array.isArray(service?.networks)) return [...service.networks].sort();
  if (service?.networks && typeof service.networks === 'object') return Object.keys(service.networks).sort();
  return [];
}

export function verifyTelegramComposeConfig(stdout) {
  let config;
  try { config = JSON.parse(stdout); } catch { throw new ContractError('rendered Compose config is not JSON', EXIT.IDENTITY); }
  const services = config?.services;
  if (!services || typeof services !== 'object' || Array.isArray(services)) throw new ContractError('rendered Compose services are missing', EXIT.IDENTITY);
  for (const slot of ['green', 'blue']) {
    const backend = services[`backend-${slot}`];
    if (JSON.stringify(composeNetworkKeys(backend)) !== JSON.stringify(['preprod-data', 'preprod-edge', 'preprod-telegram']) ||
        backend?.environment?.BOOKING_TELEGRAM_EGRESS_REQUIRED !== 'true' || backend?.environment?.TELEGRAM_PROXY_URL !== TELEGRAM_PROXY_URL ||
        !Object.hasOwn(backend?.depends_on || {}, 'telegram-egress')) {
      throw new ContractError(`rendered backend-${slot} lost a required base or Telegram network binding`, EXIT.IDENTITY);
    }
    const worker = services[`order-worker-${slot}`];
    const workerNetworks = composeNetworkKeys(worker);
    if (JSON.stringify(workerNetworks) !== JSON.stringify(['preprod-data', 'preprod-telegram']) ||
        worker?.environment?.BOOKING_TELEGRAM_EGRESS_REQUIRED !== 'true' || worker?.environment?.TELEGRAM_PROXY_URL !== TELEGRAM_PROXY_URL ||
        !Object.hasOwn(worker?.depends_on || {}, 'telegram-egress')) {
      throw new ContractError(`rendered order-worker-${slot} lost data or Telegram delivery binding`, EXIT.IDENTITY);
    }
  }
  for (const serviceName of ['telegram-bot-identity', 'telegram-webhook-set', 'telegram-webhook-readback']) {
    const service = services[serviceName];
    if (!composeNetworkKeys(service).includes('preprod-telegram') || service?.environment?.TELEGRAM_PROXY_URL !== TELEGRAM_PROXY_URL ||
        !Object.hasOwn(service?.depends_on || {}, 'telegram-egress')) {
      throw new ContractError(`rendered ${serviceName} lost Telegram egress binding`, EXIT.IDENTITY);
    }
  }
  const egress = services['telegram-egress'];
  const egressNetworks = composeNetworkKeys(egress);
  if (!egress || JSON.stringify(egressNetworks) !== JSON.stringify(['preprod-telegram', 'preprod-warp-uplink']) ||
      egress.read_only !== true || JSON.stringify(egress.cap_drop) !== JSON.stringify(['ALL']) ||
      !Array.isArray(egress.security_opt) || !egress.security_opt.includes('no-new-privileges:true') ||
      egress.privileged === true || egress.network_mode || Object.hasOwn(egress, 'ports')) {
    throw new ContractError('rendered Telegram egress service violates isolation contract', EXIT.IDENTITY);
  }
  if (config.networks?.['preprod-telegram']?.name !== 'booking-preprod-telegram' || config.networks?.['preprod-telegram']?.internal !== true ||
      config.networks?.['preprod-warp-uplink']?.name !== 'booking-preprod-warp-uplink') {
    throw new ContractError('rendered Telegram egress networks violate isolation contract', EXIT.IDENTITY);
  }
  return { backendNetworks: ['preprod-data', 'preprod-edge', 'preprod-telegram'], egressNetworks };
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
      inspected.labels?.['uk.happybooking.component'] !== component ||
      (component === 'gateway' && (inspected.labels?.['uk.happybooking.telegram-bot-username'] !== artifact.telegramBotUsername ||
        inspected.labels?.['uk.happybooking.telegram-bot-display-name'] !== artifact.telegramBotDisplayName))) {
    throw new ContractError(`${component} OCI release labels do not match candidate identity`, EXIT.IDENTITY);
  }
  return { component, imageId: inspected.id, digestMode: inspected.repoDigests.length > 0 ? 'repo-digest' : 'local-image-id',
    ...(component === 'gateway' ? { telegramBotUsername: artifact.telegramBotUsername, telegramBotDisplayName: artifact.telegramBotDisplayName } : {}) };
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

function verifyCandidateContainerRuntime(component, stdout, state, releaseIdentity, paths, candidatePort) {
  const lines = stdout.trim().split(/\r?\n/);
  if (lines.length !== 14) throw new ContractError(`${component} candidate runtime inspect readback is malformed`, EXIT.IDENTITY);
  let labels; let envList; let mounts; let networks; let readOnly; let capDrop; let capAdd; let securityOpt; let portBindings;
  let user; let privileged; let pidMode; let ipcMode; let devices;
  try { [labels, envList, mounts, networks, readOnly, capDrop, capAdd, securityOpt, portBindings,
    user, privileged, pidMode, ipcMode, devices] = lines.map((line) => JSON.parse(line)); }
  catch { throw new ContractError(`${component} candidate runtime inspect readback is malformed`, EXIT.IDENTITY); }
  const service = `${component}-${releaseIdentity.slot}`;
  if (labels?.['com.docker.compose.project'] !== state.project || labels?.['com.docker.compose.service'] !== service || readOnly !== true ||
      JSON.stringify(capDrop) !== JSON.stringify(['ALL']) || !Array.isArray(securityOpt) || !securityOpt.includes('no-new-privileges:true') ||
      user !== (component === 'backend' ? 'node' : '101') || privileged !== false || pidMode !== '' || ipcMode !== '' ||
      !Array.isArray(devices) || devices.length !== 0) {
    throw new ContractError(`${component} candidate runtime isolation identity mismatch`, EXIT.IDENTITY);
  }
  const networkNames = networks && typeof networks === 'object' && !Array.isArray(networks) ? Object.keys(networks).sort() : [];
  const expectedNetworks = component === 'backend' ? [state.resources.dataNetwork, state.resources.edgeNetwork, 'booking-preprod-telegram'].sort() : [state.resources.edgeNetwork];
  if (JSON.stringify(networkNames) !== JSON.stringify(expectedNetworks)) throw new ContractError(`${component} candidate network isolation mismatch`, EXIT.IDENTITY);
  const normalizedMounts = Array.isArray(mounts) ? mounts.map((item) => ({ type: item.Type, source: item.Source || '', destination: item.Destination, rw: item.RW })).sort((a, b) => a.destination.localeCompare(b.destination)) : [];
  const secretRoot = `/volume1/homes/realzyq/${state.project}/.g4/secrets`;
  const expectedMounts = component === 'backend' ? [
    { type: 'tmpfs', source: '', destination: '/app/logs', rw: true }, { type: 'tmpfs', source: '', destination: '/tmp', rw: true },
    { type: 'bind', source: `${secretRoot}/telegram-data-encryption-secret`, destination: '/run/secrets/telegram_data_encryption_secret', rw: false },
    { type: 'bind', source: `${secretRoot}/telegram-webhook-secret`, destination: '/run/secrets/telegram_webhook_secret', rw: false },
  ] : [
    { type: 'bind', source: join(paths.releaseDirectory, 'frontend', 'nginx.preprod.conf'), destination: '/etc/nginx/conf.d/default.conf', rw: false },
    { type: 'tmpfs', source: '', destination: '/tmp', rw: true }, { type: 'tmpfs', source: '', destination: '/var/cache/nginx', rw: true },
    { type: 'tmpfs', source: '', destination: '/var/run', rw: true },
  ];
  expectedMounts.sort((a, b) => a.destination.localeCompare(b.destination));
  if (JSON.stringify(normalizedMounts) !== JSON.stringify(expectedMounts)) throw new ContractError(`${component} candidate mount isolation mismatch`, EXIT.IDENTITY);
  const env = new Map();
  if (!Array.isArray(envList)) throw new ContractError(`${component} candidate environment readback is malformed`, EXIT.IDENTITY);
  for (const item of envList) {
    const index = typeof item === 'string' ? item.indexOf('=') : -1;
    if (index < 1 || env.has(item.slice(0, index))) throw new ContractError(`${component} candidate environment readback is malformed`, EXIT.IDENTITY);
    env.set(item.slice(0, index), item.slice(index + 1));
  }
  const expectedEnv = component === 'backend' ? {
    NODE_ENV: 'production', TYPEORM_SYNCHRONIZE: 'false', POSTGRES_HOST: 'postgres', POSTGRES_DB: 'booking_preprod', REDIS_HOST: 'redis',
    BOOKING_RELEASE_ID: releaseIdentity.releaseId, BOOKING_GIT_SHA: releaseIdentity.gitSha, BOOKING_MANIFEST_DIGEST: releaseIdentity.manifestDigest,
    BOOKING_SLOT: releaseIdentity.slot, BOOKING_RUNTIME_ROLE: 'standby', BOOKING_WORKERS_ENABLED: 'false', ORDER_OUTBOX_DISPATCH_ENABLED: 'false',
    TELEGRAM_ENABLE_WEBHOOK: 'true', TELEGRAM_POLLING_DELETE_WEBHOOK_ON_STARTUP: 'false',
    BOOKING_TELEGRAM_EGRESS_REQUIRED: 'true', TELEGRAM_PROXY_URL: 'socks5h://telegram-egress:1080',
  } : { BOOKING_BACKEND_UPSTREAM: `backend-${releaseIdentity.slot}:3001`, NGINX_ENVSUBST_TEMPLATE_DIR: '/tmp/empty-nginx-templates' };
  if (Object.entries(expectedEnv).some(([key, value]) => env.get(key) !== value)) throw new ContractError(`${component} candidate critical environment mismatch`, EXIT.IDENTITY);
  if (component === 'gateway') {
    if (JSON.stringify(capAdd) !== JSON.stringify(['NET_BIND_SERVICE']) || JSON.stringify(portBindings) !== JSON.stringify({ '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(candidatePort) }] })) {
      throw new ContractError('gateway candidate capability or loopback port binding mismatch', EXIT.IDENTITY);
    }
  } else if ((Array.isArray(capAdd) && capAdd.length) || (portBindings && Object.keys(portBindings).length)) {
    throw new ContractError('backend candidate must not expose host ports or added capabilities', EXIT.IDENTITY);
  }
  return { component, service, networks: networkNames, readOnlyRoot: true, mounts: expectedMounts.map((item) => item.destination),
    hostPort: component === 'gateway' ? `127.0.0.1:${candidatePort}` : null };
}

export function verifyTelegramEgressRuntime(stdout, state, releaseIdentity, manifest) {
  const lines = stdout.trim().split(/\r?\n/);
  if (lines.length !== 14) throw new ContractError('Telegram egress runtime inspect readback is malformed', EXIT.IDENTITY);
  let labels; let envList; let mounts; let networks; let readOnly; let capDrop; let capAdd; let securityOpt; let portBindings;
  let user; let privileged; let pidMode; let ipcMode; let devices;
  try { [labels, envList, mounts, networks, readOnly, capDrop, capAdd, securityOpt, portBindings,
    user, privileged, pidMode, ipcMode, devices] = lines.map((line) => JSON.parse(line)); }
  catch { throw new ContractError('Telegram egress runtime inspect readback is malformed', EXIT.IDENTITY); }
  const networkNames = networks && typeof networks === 'object' && !Array.isArray(networks) ? Object.keys(networks).sort() : [];
  if (labels?.['com.docker.compose.project'] !== state.project || labels?.['com.docker.compose.service'] !== 'telegram-egress' ||
      labels?.['org.opencontainers.image.revision'] !== releaseIdentity.gitSha || labels?.['uk.happybooking.release-id'] !== releaseIdentity.releaseId ||
      labels?.['uk.happybooking.component'] !== 'telegram-egress' ||
      labels?.['uk.happybooking.base-image'] !== `${manifest.artifacts.telegramEgress.baseImage}@${manifest.artifacts.telegramEgress.baseImageDigest}` ||
      labels?.['uk.happybooking.cloudflare-warp.version'] !== manifest.artifacts.telegramEgress.warpPackage.version ||
      labels?.['uk.happybooking.cloudflare-warp.deb-sha256'] !== manifest.artifacts.telegramEgress.warpPackage.sha256 ||
      JSON.stringify(networkNames) !== JSON.stringify(['booking-preprod-telegram', 'booking-preprod-warp-uplink']) || readOnly !== true ||
      JSON.stringify(capDrop) !== JSON.stringify(['ALL']) || (Array.isArray(capAdd) && capAdd.length > 0) ||
      !Array.isArray(securityOpt) || !securityOpt.includes('no-new-privileges:true') ||
      (portBindings && Object.keys(portBindings).length > 0) || user !== '0:0' || privileged !== false || pidMode !== '' || ipcMode !== '' ||
      !Array.isArray(devices) || devices.length !== 0) {
    throw new ContractError('Telegram egress runtime isolation or image identity mismatch', EXIT.IDENTITY);
  }
  const normalizedMounts = Array.isArray(mounts) ? mounts.map((item) => ({ type: item.Type, source: item.Source || '', destination: item.Destination, rw: item.RW })).sort((a, b) => a.destination.localeCompare(b.destination)) : [];
  const expectedMounts = [
    { type: 'tmpfs', source: '', destination: '/run', rw: true },
    { type: 'tmpfs', source: '', destination: '/tmp', rw: true },
    { type: 'volume', source: 'booking-preprod-telegram-warp-state', destination: '/var/lib/cloudflare-warp', rw: true },
    { type: 'tmpfs', source: '', destination: '/var/log/cloudflare-warp', rw: true },
  ].sort((a, b) => a.destination.localeCompare(b.destination));
  if (JSON.stringify(normalizedMounts) !== JSON.stringify(expectedMounts)) throw new ContractError('Telegram egress runtime mount identity mismatch', EXIT.IDENTITY);
  const env = new Map();
  if (!Array.isArray(envList)) throw new ContractError('Telegram egress runtime environment is malformed', EXIT.IDENTITY);
  for (const item of envList) {
    const index = typeof item === 'string' ? item.indexOf('=') : -1;
    if (index < 1 || env.has(item.slice(0, index))) throw new ContractError('Telegram egress runtime environment is malformed', EXIT.IDENTITY);
    env.set(item.slice(0, index), item.slice(index + 1));
  }
  const expectedEnv = { BOOKING_RELEASE_ID: releaseIdentity.releaseId, BOOKING_GIT_SHA: releaseIdentity.gitSha,
    BOOKING_MANIFEST_DIGEST: releaseIdentity.manifestDigest, BOOKING_TELEGRAM_EGRESS_DIGEST: manifest.artifacts.telegramEgress.digest };
  if (Object.entries(expectedEnv).some(([key, value]) => env.get(key) !== value) ||
      [...env.keys()].some((key) => ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'TELEGRAM_BOT_TOKEN'].includes(key))) {
    throw new ContractError('Telegram egress runtime environment identity mismatch', EXIT.IDENTITY);
  }
  return { service: 'telegram-egress', imageDigest: manifest.artifacts.telegramEgress.digest, networks: networkNames,
    user, readOnlyRoot: true, capabilityDrop: ['ALL'], publishedPorts: 0 };
}

async function loadReleaseManifest(paths, releaseIdentity, runtime, allowLegacyRawDigest = false) {
  const rawManifest = runtime.releaseManifest ? null : await readFile(paths.manifestFile, 'utf8');
  const manifest = validateReleaseManifest(runtime.releaseManifest || JSON.parse(rawManifest), allowLegacyRawDigest ? {
    expectedLegacyBinding: LEGACY_OLD_BINDING, legacyRawDigest: rawManifest === null ? null : sha256(rawManifest),
  } : {});
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

function sameReleaseIdentity(left, right) {
  return Boolean(left && right && left.slot === right.slot && left.releaseId === right.releaseId && left.gitSha === right.gitSha &&
    left.manifestDigest === right.manifestDigest);
}

function assertCandidateRollbackCompatibility(state, releaseIdentity, manifest) {
  const promotedCandidate = state.rollback && sameReleaseIdentity(releaseIdentity, state.active);
  const pendingCandidate = state.candidate && sameReleaseIdentity(releaseIdentity, state.candidate);
  if (!promotedCandidate && !pendingCandidate) return;
  const rollbackTarget = state.rollback || state.active;
  if (!rollbackTarget || manifest.contracts.rollbackCompatibleRelease !== rollbackTarget.releaseId) {
    throw new ContractError('candidate manifest is not bound to the canonical rollback target release', EXIT.ROLLBACK);
  }
  if (rollbackTarget.releaseId === LEGACY_OLD_BINDING.releaseId &&
      (rollbackTarget.gitSha !== LEGACY_OLD_BINDING.gitSha || rollbackTarget.manifestDigest !== LEGACY_OLD_BINDING.manifestRawDigest || rollbackTarget.slot !== 'green')) {
    throw new ContractError('candidate rollback target does not match the one-time fixed legacy identity', EXIT.ROLLBACK);
  }
}

async function inspectTrustedRuntimeEnvironment(state, runtime) {
  const fixedPath = `/volume1/homes/realzyq/${state.project}/.env`;
  if (runtime.runtimeEnvFile !== undefined) throw new ContractError('runtime environment path cannot be overridden', EXIT.IDENTITY);
  const fixturePath = runtime.releaseManifest && runtime.releaseRoot ? join(runtime.releaseRoot, '.runtime.env') : null;
  const configuredPath = fixturePath || fixedPath;
  if (!isAbsolute(configuredPath)) throw new ContractError('runtime environment file must use the fixed absolute path', EXIT.IDENTITY);
  const canonical = await realpath(configuredPath).catch(() => { throw new ContractError('fixed runtime environment file cannot be resolved', EXIT.IDENTITY); });
  if (canonical !== configuredPath || (!fixturePath && canonical !== fixedPath)) {
    throw new ContractError('runtime environment file must be the fixed canonical non-symlink path', EXIT.IDENTITY);
  }
  const metadata = await stat(canonical);
  if (!metadata.isFile() || (process.platform !== 'win32' && (metadata.uid !== 0 || (metadata.mode & 0o777) !== 0o600))) {
    throw new ContractError('runtime environment file must be a root-owned 0600 regular file', EXIT.IDENTITY);
  }
  const digest = await digestFile(canonical);
  if (digest !== state.runtimeEnvDigest) throw new ContractError('runtime environment digest drifted from the operation binding', EXIT.IDENTITY);
  return { path: canonical, digest };
}

async function inspectImmutableRouteContract(paths, manifest, runtime) {
  await trustedDirectory(join(paths.releaseDirectory, 'frontend'), 'release frontend directory', runtime);
  const expectedPath = join(paths.releaseDirectory, 'frontend', 'nginx.preprod.conf');
  const canonical = await realpath(expectedPath).catch(() => { throw new ContractError('preproduction route contract file cannot be resolved', EXIT.IDENTITY); });
  const containment = relative(paths.releaseDirectory, canonical);
  const metadata = await stat(canonical);
  if (canonical !== expectedPath || !containment || containment.startsWith('..') || isAbsolute(containment) || !metadata.isFile() ||
      (metadata.mode & 0o022) !== 0 || (process.platform !== 'win32' && metadata.uid !== 0)) {
    throw new ContractError('preproduction route contract must be an immutable root-owned file within the release', EXIT.IDENTITY);
  }
  const digest = await digestFile(canonical);
  if (digest !== manifest.artifacts.gateway.routeContractDigest) {
    throw new ContractError('preproduction route contract does not match the release manifest', EXIT.IDENTITY);
  }
  return { path: canonical, digest };
}

function bindTrustedEnvironment(baseEnvironment, state, releaseIdentity, manifest, runtimeEnvironment) {
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
    BOOKING_RUNTIME_ENV_FILE: runtimeEnvironment.path,
    BOOKING_PREPROD_DATA_ROOT: `/volume1/homes/realzyq/${state.project}-data`,
    BOOKING_BASELINE_OLD_RELEASE_ID: state.active.releaseId,
    BOOKING_BASELINE_OLD_GIT_SHA: state.active.gitSha,
    BOOKING_BASELINE_OLD_MANIFEST_DIGEST: state.active.manifestDigest,
  };
  if (manifest.artifacts.telegramEgress) {
    expected.BOOKING_TELEGRAM_EGRESS_IMAGE = manifest.artifacts.telegramEgress.image;
    expected.BOOKING_TELEGRAM_EGRESS_DIGEST = manifest.artifacts.telegramEgress.digest;
  }
  if (manifest.artifacts.gateway.telegramBotUsername) {
    expected.BOOKING_TELEGRAM_BOT_NAME = manifest.artifacts.gateway.telegramBotUsername;
    expected.BOOKING_TELEGRAM_BOT_DISPLAY_NAME = manifest.artifacts.gateway.telegramBotDisplayName;
    expected.BOOKING_TELEGRAM_EXPECTED_BOT_USERNAME = manifest.artifacts.gateway.telegramBotUsername;
  }
  for (const [key, value] of Object.entries(expected)) {
    if (base[key] !== undefined && base[key] !== value) throw new ContractError(`${key} conflicts with canonical release identity`, EXIT.IDENTITY);
  }
  const optionalIdentityKeys = ['BOOKING_TELEGRAM_EXPECTED_BOT_ID', 'BOOKING_TELEGRAM_WEBHOOK_URL',
    'BOOKING_MIGRATION_BACKUP_RECEIPT_DIGEST',
    'BOOKING_MIGRATION_BACKUP_RECEIPT_HOST_FILE', 'BOOKING_MIGRATION_APPROVED_PENDING_JSON',
    'BOOKING_BASELINE_OLD_CATALOG_DIGEST', 'BOOKING_BASELINE_OLD_FLOOR', 'BOOKING_BASELINE_APPROVED_HISTORY_JSON',
    'BOOKING_BASELINE_SCHEMA_DIFF_RECEIPT_DIGEST', 'BOOKING_BASELINE_SCHEMA_DIFF_RECEIPT_HOST_FILE',
    'BOOKING_BASELINE_BACKUP_RECEIPT_DIGEST', 'BOOKING_BASELINE_BACKUP_RECEIPT_HOST_FILE', 'BOOKING_GREEN_PORT', 'BOOKING_BLUE_PORT'];
  const environmentBinding = { ...expected, BOOKING_RUNTIME_ENV_DIGEST: runtimeEnvironment.digest };
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

async function assertLoopbackPortAvailable(port, runtime) {
  if (runtime.portAvailabilityChecker) {
    if (await runtime.portAvailabilityChecker(port) !== true) throw new ContractError(`candidate loopback port ${port} is already occupied`, EXIT.READINESS);
    return;
  }
  await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', () => reject(new ContractError(`candidate loopback port ${port} is already occupied`, EXIT.READINESS)));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close((error) => error ? reject(error) : resolvePromise()));
  });
}

function defaultCommandRunner(executable, argv, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, argv, { cwd: options.cwd, env: options.env, shell: false, windowsHide: true, stdio: [options.inputPath ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
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
    if (options.inputPath) createReadStream(options.inputPath).pipe(child.stdin);
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
  const manifest = await loadReleaseManifest(paths, releaseIdentity, runtime, ['rollback', 'active'].includes(spec.identity));
  assertCandidateRollbackCompatibility(state, releaseIdentity, manifest);
  const exactLegacyCompose = releaseIdentity.releaseId === LEGACY_OLD_BINDING.releaseId &&
    releaseIdentity.gitSha === LEGACY_OLD_BINDING.gitSha && releaseIdentity.manifestDigest === LEGACY_OLD_BINDING.manifestRawDigest;
  const actualComposeDigest = exactLegacyCompose
    ? await digestFile(paths.composeFile)
    : await composeBundleDigest(paths.composeFile, paths.egressComposeFile);
  if ((!exactLegacyCompose && manifest.artifacts.deployment?.composeDigest !== actualComposeDigest) ||
      (exactLegacyCompose && actualComposeDigest !== LEGACY_OLD_BINDING.rollbackComposeDigest)) {
    throw new ContractError('compose file does not match immutable release manifest', EXIT.IDENTITY);
  }
  const runtimeEnvironment = await inspectTrustedRuntimeEnvironment(state, runtime);
  const trustedEnvironment = bindTrustedEnvironment(runtime.env, state, releaseIdentity, manifest, runtimeEnvironment);
  const inspectRegistrySupplyChain = async () => {
    if (exactLegacyCompose) return { schema: 'booking.registry-runtime-gate-exemption/v1', legacy: true,
      environment: state.environment, project: state.project, operationId: state.operationId,
      fencingEpoch: state.fencingEpoch, releaseId: releaseIdentity.releaseId, gitSha: releaseIdentity.gitSha,
      manifestDigest: releaseIdentity.manifestDigest };
    if (runtime.registryReceiptVerifier) return runtime.registryReceiptVerifier({ state, releaseIdentity, manifest });
    if (runtime.releaseManifest && runtime.releaseRoot) return { schema: 'booking.registry-runtime-gate-fixture/v1', injectedFixture: true,
      environment: state.environment, project: state.project, operationId: state.operationId,
      fencingEpoch: state.fencingEpoch, releaseId: releaseIdentity.releaseId, gitSha: releaseIdentity.gitSha,
      manifestDigest: releaseIdentity.manifestDigest };
    return verifyRegistrySupplyChainRuntime({ state, releaseIdentity, manifest }, {
      ...runtime, cosignCommandRunner: runtime.cosignCommandRunner || defaultCommandRunner,
    });
  };
  const registrySupplyChain = await inspectRegistrySupplyChain();
  trustedEnvironment.environmentBinding.BOOKING_REGISTRY_SUPPLY_CHAIN_DIGEST = sha256(registrySupplyChain);
  const guardPlan = (plan) => ({ ...plan, registrySupplyChainBinding: registrySupplyChain,
    registrySupplyChainGate: async () => {
      const current = await inspectRegistrySupplyChain();
      if (canonicalJson(current) !== canonicalJson(registrySupplyChain)) {
        throw new ContractError('registry supply-chain gate drifted during the fenced action', EXIT.IDENTITY);
      }
      return current;
    } });
  const docker = runtime.dockerExecutable || await findExecutable(['/var/packages/ContainerManager/target/usr/bin/docker', '/usr/bin/docker']);
  const controlEnvFile = runtime.controlEnvFile || '/etc/happybooking/secrets/booking-preprod-control-plane.env';
  if (!isAbsolute(controlEnvFile)) throw new ContractError('trusted Compose env file must be absolute', EXIT.IDENTITY);
  if (process.platform !== 'win32') {
    const canonicalControlEnv = await realpath(controlEnvFile).catch(() => { throw new ContractError('trusted Compose env file cannot be resolved', EXIT.IDENTITY); });
    const controlMetadata = await stat(canonicalControlEnv);
    if (canonicalControlEnv !== controlEnvFile || !controlMetadata.isFile() || controlMetadata.uid !== 0 || (controlMetadata.mode & 0o077) !== 0) {
      throw new ContractError('trusted Compose env file must be a root-only canonical regular file', EXIT.IDENTITY);
    }
  }
  const composePrefix = ['compose', '--env-file', controlEnvFile, '--project-name', state.project, '--file', paths.composeFile,
    ...(!exactLegacyCompose ? ['--file', paths.egressComposeFile] : [])];
  const evidenceRoot = `/volume1/homes/realzyq/${state.project}/.g4`;
  const expectedEvidenceBinding = { environment: state.environment, project: state.project, operationId: state.operationId,
    approvalId: state.approvalId, generation: state.generation, fencingEpoch: state.fencingEpoch, leaseId: state.lease.leaseId, holderId: state.lease.holderId,
    currentManifestDigest: state.candidate?.manifestDigest || state.active.manifestDigest, phase: state.phase, runtimeEnvDigest: state.runtimeEnvDigest };
  const verifyEvidenceFile = async (path, expectedPath, expectedDigest, label, binding = expectedEvidenceBinding) => {
    const canonical = await realpath(path).catch(() => { throw new ContractError(`${label} is unavailable`, EXIT.DATABASE); });
    if (canonical !== expectedPath || canonical !== path) throw new ContractError(`${label} path is not bound to the current operation`, EXIT.IDENTITY);
    const metadata = await stat(canonical);
    if (!metadata.isFile() || metadata.size < 1 || (!runtime.allowNonRootEvidence && process.platform !== 'win32' && (metadata.uid !== 0 || (metadata.mode & 0o077) !== 0))) {
      throw new ContractError(`${label} must be a root-only regular file`, EXIT.DATABASE);
    }
    if (await digestFile(canonical) !== expectedDigest) throw new ContractError(`${label} digest mismatch`, EXIT.IDENTITY);
    let value; try { value = JSON.parse(await readFile(canonical, 'utf8')); } catch { throw new ContractError(`${label} is not valid JSON`, EXIT.IDENTITY); }
    const observedBinding = value.deploymentBinding;
    const expectedAtObservedGeneration = { ...binding, generation: observedBinding?.generation };
    if (!Number.isInteger(observedBinding?.generation) || observedBinding.generation > state.generation ||
        canonicalJson(observedBinding) !== canonicalJson(expectedAtObservedGeneration)) {
      throw new ContractError(`${label} deployment binding mismatch`, EXIT.IDENTITY);
    }
    return value;
  };
  const verifyBackupObject = (receiptKey, receiptPathKey, identityKind, additionalReceiptKey = null) => async ({ runner, env, timeoutMs, adoptionReceipt }) => {
    const evidenceBinding = adoptionReceipt ? {
      environment: adoptionReceipt.environment, project: adoptionReceipt.project, operationId: adoptionReceipt.operationId,
      approvalId: adoptionReceipt.approvalId, generation: adoptionReceipt.generation, fencingEpoch: adoptionReceipt.fencingEpoch,
      leaseId: adoptionReceipt.leaseId, holderId: adoptionReceipt.holderId,
      currentManifestDigest: state.candidate?.manifestDigest || state.active.manifestDigest,
      phase: state.phase, runtimeEnvDigest: adoptionReceipt.runtimeEnvDigest,
    } : expectedEvidenceBinding;
    if (runtime.backupArtifactVerifier) return runtime.backupArtifactVerifier({ receiptKey, receiptPathKey, identityKind,
      expectedEvidenceBinding: evidenceBinding, state, releaseIdentity, runner, env, timeoutMs, adoptionReceipt,
      requireSchemaDiffReceipt: additionalReceiptKey === true });
    const expectedReceiptPath = `${evidenceRoot}/receipts/${state.operationId}-${identityKind === 'old' ? 'old-backup' : 'candidate-backup'}.json`;
    const receipt = await verifyEvidenceFile(env[receiptPathKey], expectedReceiptPath, env[receiptKey], `${identityKind} backup receipt`, evidenceBinding);
    const expectedIdentity = identityKind === 'old' ? state.active : releaseIdentity;
    if (receipt.schema !== 'booking.database-backup-receipt/v1' || receipt.environment !== 'preproduction' || receipt.database !== 'booking_preprod' ||
        receipt.databaseUser !== 'booking_preprod' || receipt.releaseId !== expectedIdentity.releaseId || receipt.gitSha !== expectedIdentity.gitSha ||
        receipt.manifestDigest !== expectedIdentity.manifestDigest || !/^sha256:[0-9a-f]{64}$/.test(receipt.backupDigest || '')) {
      throw new ContractError(`${identityKind} backup receipt release identity mismatch`, EXIT.IDENTITY);
    }
    if (additionalReceiptKey) {
      const expectedSchemaPath = `${evidenceRoot}/receipts/${state.operationId}-old-zero-diff.json`;
      await verifyEvidenceFile(env.BOOKING_BASELINE_SCHEMA_DIFF_RECEIPT_HOST_FILE, expectedSchemaPath,
        env.BOOKING_BASELINE_SCHEMA_DIFF_RECEIPT_DIGEST, 'old schema diff receipt', evidenceBinding);
    }
    const backupPath = `${evidenceRoot}/backups/${state.operationId}.dump`;
    const canonicalBackup = await realpath(backupPath).catch(() => { throw new ContractError('backup object is unavailable', EXIT.DATABASE); });
    const backupMetadata = await stat(canonicalBackup);
    if (canonicalBackup !== backupPath || !backupMetadata.isFile() || backupMetadata.size < 1 ||
        (!runtime.allowNonRootEvidence && process.platform !== 'win32' && (backupMetadata.uid !== 0 || (backupMetadata.mode & 0o077) !== 0))) {
      throw new ContractError('backup object must be the current operation root-only regular file', EXIT.DATABASE);
    }
    const backupDigest = await digestFile(canonicalBackup);
    if (backupDigest !== receipt.backupDigest) throw new ContractError('backup object digest does not match its receipt', EXIT.IDENTITY);
    const list = await runner(docker, ['exec', '-i', 'booking-preprod-postgres-1', 'pg_restore', '--list'],
      { cwd: paths.releaseDirectory, env, timeoutMs, inputPath: canonicalBackup });
    assertResult(list, EXIT.DATABASE);
    if (!list.stdout.trim()) throw new ContractError('pg_restore --list returned no backup catalog', EXIT.DATABASE);
    return { receiptDigest: env[receiptKey], backupDigest, backupSize: backupMetadata.size, backupPath,
      pgRestoreListDigest: sha256(list.stdout), deploymentBinding: receipt.deploymentBinding };
  };
  const imageFormat = '{{json .Id}}|{{json .RepoDigests}}|{{json .RepoTags}}|{{json .Config.Labels}}';
  const artifacts = { backend: manifest.artifacts.backend, gateway: manifest.artifacts.gateway, telegramEgress: manifest.artifacts.telegramEgress,
    deployment: { composeDigest: actualComposeDigest } };
  const inspectImages = (components) => async ({ runner, env, timeoutMs }) => {
    const evidence = {};
    for (const component of components) {
      const artifactKey = component === 'telegram-egress' ? 'telegramEgress' : component;
      const artifact = artifacts[artifactKey];
      const legacy = ['rollback', 'active'].includes(spec.identity) && isExactLegacyBackend(component, artifact, releaseIdentity);
      const reference = legacy ? LEGACY_OLD_BINDING.uniqueTag : `${artifact.image}:${releaseIdentity.releaseId}`;
      const result = await runner(docker, ['image', 'inspect', '--format', imageFormat, reference], { cwd: paths.releaseDirectory, env, timeoutMs });
      assertResult(result, EXIT.IDENTITY);
      const inspected = parseSafeImageInspect(result.stdout, component);
      evidence[artifactKey] = legacy
        ? verifyLegacyDockerImageBinding(component, artifact, releaseIdentity, inspected)
        : verifyDockerImageBinding(component, artifact, releaseIdentity, inspected);
    }
    return evidence;
  };
  const runtimeInspectFormat = ['{{json .Config.Labels}}', '{{json .Config.Env}}', '{{json .Mounts}}', '{{json .NetworkSettings.Networks}}',
    '{{json .HostConfig.ReadonlyRootfs}}', '{{json .HostConfig.CapDrop}}', '{{json .HostConfig.CapAdd}}', '{{json .HostConfig.SecurityOpt}}',
    '{{json .HostConfig.PortBindings}}', '{{json .Config.User}}', '{{json .HostConfig.Privileged}}', '{{json .HostConfig.PidMode}}',
    '{{json .HostConfig.IpcMode}}', '{{json .HostConfig.Devices}}'].join('\n');
  const inspectReleaseRuntime = async ({ runner, env, timeoutMs }) => {
    if (exactLegacyCompose) return { legacy: true };
    if (runtime.candidateRuntimeVerifier) {
      return runtime.candidateRuntimeVerifier({ state, releaseIdentity, manifest, paths, runner, env, timeoutMs });
    }
    const greenPort = Number(env.BOOKING_GREEN_PORT);
    const bluePort = Number(env.BOOKING_BLUE_PORT);
    if (greenPort !== 18082 || bluePort !== 18083) {
      throw new ContractError('trusted preproduction slot ports must bind green=18082 and blue=18083', EXIT.IDENTITY);
    }
    const releasePort = releaseIdentity.slot === 'green' ? greenPort : bluePort;
    const imageEvidence = await inspectImages(['backend', 'gateway'])({ runner, env, timeoutMs });
    const runtimeBindings = {};
    for (const component of ['backend', 'gateway']) {
      const service = `${component}-${releaseIdentity.slot}`;
      const idResult = await runner(docker, [...composePrefix, 'ps', '-q', service], { cwd: paths.releaseDirectory, env, timeoutMs });
      assertResult(idResult, EXIT.IDENTITY);
      const containerId = idResult.stdout.trim();
      if (!/^[0-9a-f]{12,64}$/.test(containerId)) throw new ContractError(`${component} candidate container ID is invalid`, EXIT.IDENTITY);
      const imageResult = await runner(docker, ['container', 'inspect', '--format', '{{.Image}}', containerId], {
        cwd: paths.releaseDirectory, env, timeoutMs,
      });
      assertResult(imageResult, EXIT.IDENTITY);
      if (parseContainerImage(imageResult.stdout, component) !== imageEvidence[component].imageId) {
        throw new ContractError(`${component} running container does not use the manifest-bound image`, EXIT.IDENTITY);
      }
      const runtimeResult = await runner(docker, ['container', 'inspect', '--format', runtimeInspectFormat, containerId], {
        cwd: paths.releaseDirectory, env, timeoutMs,
      });
      assertResult(runtimeResult, EXIT.IDENTITY);
      runtimeBindings[component] = verifyCandidateContainerRuntime(
        component, runtimeResult.stdout, state, releaseIdentity, paths, releasePort,
      );
    }
    return { images: imageEvidence, runtimeBindings };
  };
  const inspectComposeConfig = async ({ runner, env, timeoutMs }) => {
    if (exactLegacyCompose) return { legacy: true };
    if (runtime.releaseManifest && runtime.releaseRoot && !runtime.enforceTelegramEgressFixture) return { injectedFixture: true };
    const rendered = await runner(docker, [...composePrefix, 'config', '--format', 'json'], { cwd: paths.releaseDirectory, env, timeoutMs });
    assertResult(rendered, EXIT.IDENTITY);
    return verifyTelegramComposeConfig(rendered.stdout);
  };
  const inspectTelegramEgress = async ({ runner, env, timeoutMs }) => {
    if (exactLegacyCompose) return { legacy: true };
    if (runtime.releaseManifest && runtime.releaseRoot && !runtime.enforceTelegramEgressFixture) return { injectedFixture: true };
    const compose = await inspectComposeConfig({ runner, env, timeoutMs });
    const imageEvidence = await inspectImages(['telegram-egress'])({ runner, env, timeoutMs });
    const idResult = await runner(docker, [...composePrefix, 'ps', '-q', 'telegram-egress'], { cwd: paths.releaseDirectory, env, timeoutMs });
    assertResult(idResult, EXIT.IDENTITY);
    const containerId = idResult.stdout.trim();
    if (!/^[0-9a-f]{12,64}$/.test(containerId)) throw new ContractError('Telegram egress container ID is invalid', EXIT.IDENTITY);
    const imageResult = await runner(docker, ['container', 'inspect', '--format', '{{.Image}}', containerId], { cwd: paths.releaseDirectory, env, timeoutMs });
    assertResult(imageResult, EXIT.IDENTITY);
    const containerImageId = parseContainerImage(imageResult.stdout, 'Telegram egress');
    if (containerImageId !== imageEvidence.telegramEgress.imageId) throw new ContractError('Telegram egress container image drifted from the manifest-bound image', EXIT.IDENTITY);
    const runtimeResult = await runner(docker, ['container', 'inspect', '--format', runtimeInspectFormat, containerId], { cwd: paths.releaseDirectory, env, timeoutMs });
    assertResult(runtimeResult, EXIT.IDENTITY);
    const runtimeBinding = verifyTelegramEgressRuntime(runtimeResult.stdout, state, releaseIdentity, manifest);
    const health = await runner(docker, [...composePrefix, 'ps', '--format', 'json', 'telegram-egress'], { cwd: paths.releaseDirectory, env, timeoutMs });
    assertResult(health, EXIT.READINESS);
    const serviceHealth = verifyComposeServices(health.stdout, ['telegram-egress']);
    const readback = await runner(docker, [...composePrefix, 'exec', '-T', 'telegram-egress', '/usr/local/bin/readback.sh',
      state.operationId, containerId, containerImageId], { cwd: paths.releaseDirectory, env, timeoutMs });
    assertResult(readback, EXIT.INGRESS);
    const receipt = parseLastJson(readback.stdout, 'Telegram egress did not emit a live JSON receipt', EXIT.INGRESS);
    const verifiedReceipt = verifyTelegramEgressReceipt(receipt, { operationId: state.operationId, releaseId: releaseIdentity.releaseId,
      manifestDigest: releaseIdentity.manifestDigest, imageDigest: manifest.artifacts.telegramEgress.digest,
      containerId, containerImageId, nowMs: (runtime.egressNow ? runtime.egressNow() : new Date()).getTime() });
    return { compose, image: imageEvidence.telegramEgress, runtime: runtimeBinding, serviceHealth, receipt: verifiedReceipt };
  };
  const combineArtifactChecks = (...checks) => async (context) => {
    const evidence = {};
    for (const [index, check] of checks.entries()) evidence[`check${index + 1}`] = await check(context);
    return evidence;
  };
  const inspectDataPlane = async ({ runner, env, timeoutMs }) => {
    const expectedRoot = `/volume1/homes/realzyq/${state.project}-data`;
    if (env.BOOKING_PREPROD_DATA_ROOT !== expectedRoot) throw new ContractError('preproduction data root conflicts with the canonical live data root', EXIT.DATABASE);
    const targets = [
      { container: 'booking-preprod-postgres-1', service: 'postgres', source: `${expectedRoot}/postgres`, destination: '/var/lib/postgresql/data' },
      { container: 'booking-preprod-redis-1', service: 'redis', source: `${expectedRoot}/redis`, destination: '/data' },
    ];
    const observed = [];
    for (const target of targets) {
      const result = await runner(docker, ['container', 'inspect', '--format', '{{json .Mounts}}|{{json .NetworkSettings.Networks}}|{{json .Config.Labels}}|{{json .State.Status}}', target.container],
        { cwd: paths.releaseDirectory, env, timeoutMs });
      assertResult(result, EXIT.DATABASE);
      const parts = result.stdout.trim().split('|');
      let mounts; let networks; let labels; let status;
      try {
        if (parts.length !== 4) throw new Error('shape');
        [mounts, networks, labels, status] = parts.map((part) => JSON.parse(part));
      }
      catch { throw new ContractError(`${target.container} data-plane inspect readback is malformed`, EXIT.DATABASE); }
      const mountMatches = Array.isArray(mounts) && mounts.length === 1 && mounts[0]?.Type === 'bind' && mounts[0]?.Source === target.source &&
        mounts[0]?.Destination === target.destination && mounts[0]?.RW === true;
      const networkNames = networks && typeof networks === 'object' && !Array.isArray(networks) ? Object.keys(networks) : [];
      if (!mountMatches || networkNames.length !== 1 || networkNames[0] !== state.resources.dataNetwork || status !== 'running' ||
          labels?.['com.docker.compose.project'] !== state.project || labels?.['com.docker.compose.service'] !== target.service) {
        throw new ContractError(`${target.container} does not match the canonical isolated data-plane identity`, EXIT.DATABASE);
      }
      observed.push({ container: target.container, composeProject: state.project, composeService: target.service,
        mountSource: target.source, mountDestination: target.destination, network: networkNames[0], status });
    }
    const database = await runner(docker, ['exec', 'booking-preprod-postgres-1', 'psql', '--no-password', '--tuples-only', '--no-align', '--quiet',
      '--username', 'booking_preprod', '--dbname', 'booking_preprod', '--command', "SELECT current_database() || '|' || current_user;"],
    { cwd: paths.releaseDirectory, env, timeoutMs });
    assertResult(database, EXIT.DATABASE);
    if (database.stdout.trim() !== 'booking_preprod|booking_preprod') throw new ContractError('preproduction database runtime identity mismatch', EXIT.DATABASE);
    return { root: expectedRoot, containers: observed, database: 'booking_preprod', databaseUser: 'booking_preprod' };
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
  if (spec.kind === 'compose-egress') {
    const preflightArtifacts = combineArtifactChecks(inspectComposeConfig, inspectImages(['telegram-egress']));
    return guardPlan({ executable: docker, argv: [...composePrefix, 'up', '--no-build', '--no-deps', '--wait', 'telegram-egress'], cwd: paths.releaseDirectory,
      env: trustedEnvironment.env, environmentBinding: trustedEnvironment.environmentBinding,
      artifactBinding: { telegramEgress: { image: artifacts.telegramEgress.image, digest: artifacts.telegramEgress.digest,
        sbomDigest: artifacts.telegramEgress.sbomDigest, provenanceDigest: artifacts.telegramEgress.provenanceDigest,
        baseImage: artifacts.telegramEgress.baseImage, baseImageDigest: artifacts.telegramEgress.baseImageDigest, warpPackage: artifacts.telegramEgress.warpPackage } },
      preflightArtifacts,
      readback: { executable: docker, argv: [...composePrefix, 'ps', '--format', 'json', 'telegram-egress'],
        verify: (value) => verifyComposeServices(value, ['telegram-egress']) },
      verifyArtifacts: inspectTelegramEgress, replayPreflightArtifacts: inspectTelegramEgress, replayVerifyArtifacts: inspectTelegramEgress });
  }
  if (spec.kind === 'singleton-transfer') {
    const sourceIdentity = singletonSourceIdentity(state, spec.identity === 'rollback');
    if (!sourceIdentity || sourceIdentity.slot === releaseIdentity.slot) throw new ContractError('singleton source and target identities are invalid', EXIT.SINGLETON);
    const sourcePaths = await trustedReleasePaths(state, sourceIdentity, { ...runtime, releaseManifest: undefined });
    const sourceManifest = await loadReleaseManifest(sourcePaths, sourceIdentity, { ...runtime, releaseManifest: runtime.sourceReleaseManifest }, spec.identity !== 'rollback');
    const helper = fileURLToPath(new URL('./manage-preprod-singletons.mjs', import.meta.url));
    const singletonAction = spec.identity === 'rollback' ? 'rollback' : 'transfer';
    const identityName = `${oneShotName}-telegram-identity`;
    const helperArgs = ['--action', singletonAction, '--project', state.project, '--compose-file', paths.composeFile,
      ...(!exactLegacyCompose ? ['--egress-compose-file', paths.egressComposeFile] : []),
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
    const verifyTelegramIdentity = (value) => {
      const parsed = parseLastJson(value, 'Telegram getMe preflight did not emit JSON identity evidence', EXIT.INGRESS);
      if (parsed?.schema !== 'booking.telegram-bot-identity/v1' || parsed.action !== 'getMe' ||
          !Number.isSafeInteger(parsed.botId) || parsed.botId <= 0 || parsed.botUsername !== manifest.artifacts.gateway.telegramBotUsername ||
          !Number.isFinite(Date.parse(parsed.observedAt))) {
        throw new ContractError('Telegram getMe preflight does not match manifest bot identity', EXIT.INGRESS);
      }
      return parsed;
    };
    const singletonArtifacts = exactLegacyCompose
      ? backendImagePreflight
      : combineArtifactChecks(backendImagePreflight, inspectReleaseRuntime, inspectTelegramEgress);
    return guardPlan({ executable: process.execPath, argv: [helper, ...helperArgs], cwd: paths.releaseDirectory,
      env: trustedEnvironment.env, environmentBinding: trustedEnvironment.environmentBinding,
      artifactBinding: { backend: { image: artifacts.backend.image, digest: artifacts.backend.digest }, singletonAction,
        sourceSlot: sourceIdentity.slot, targetSlot: releaseIdentity.slot,
        telegramIdentity: { botUsername: manifest.artifacts.gateway.telegramBotUsername, action: 'getMe' } },
      ...(singletonAction === 'transfer' ? { preflight: { executable: docker,
        argv: [...composePrefix, '--profile', 'telegram-bot-identity', 'run', '--rm', '--no-deps', '--name', identityName, 'telegram-bot-identity'],
        verify: verifyTelegramIdentity } } : {}),
      preflightArtifacts: singletonArtifacts, verifyExecution: verifySingleton,
      readback: { executable: process.execPath, argv: [helper, '--readback', 'true', ...helperArgs], verify: verifySingleton },
      replayVerifyArtifacts: singletonArtifacts, verifyArtifacts: singletonArtifacts });
  }
  if (spec.kind === 'release-probe') {
    const publicProbe = ['preprod-probe-observation', 'preprod-probe-rollback'].includes(args.action);
    let port = null;
    if (!publicProbe) {
      requireBoundEnvironment(trustedEnvironment, ['BOOKING_GREEN_PORT', 'BOOKING_BLUE_PORT']);
      const greenPort = Number(trustedEnvironment.env.BOOKING_GREEN_PORT);
      const bluePort = Number(trustedEnvironment.env.BOOKING_BLUE_PORT);
      if (greenPort !== 18082 || bluePort !== 18083) throw new ContractError('trusted preproduction slot ports must bind green=18082 and blue=18083', EXIT.IDENTITY);
      port = releaseIdentity.slot === 'green' ? greenPort : bluePort;
    }
    const verifyProbe = (value) => {
      let parsed; try { parsed = JSON.parse(value); } catch { throw new ContractError('release probe readback is not JSON', EXIT.READINESS); }
      if (parsed.status !== 'pass' || parsed.releaseId !== releaseIdentity.releaseId || parsed.gitSha !== releaseIdentity.gitSha ||
          parsed.manifestDigest !== releaseIdentity.manifestDigest || parsed.slot !== releaseIdentity.slot ||
          (publicProbe && parsed.origin !== 'https://booking-preprod.happybooking.uk') ||
          (publicProbe && !exactLegacyCompose && (parsed.configSchema !== manifest.contracts.configSchema ||
            parsed.migrationFloor !== manifest.contracts.migration.expandFloor ||
            parsed.migrationCatalogDigest !== manifest.contracts.migration.catalogDigest || parsed.telegramBotMode !== 'webhook' ||
            parsed.telegramWebhookEnabled !== true || parsed.telegramWebhookUrl !== 'https://booking-preprod.happybooking.uk/telegram/webhook'))) {
        throw new ContractError('release probe identity mismatch', EXIT.READINESS);
      }
      return parsed;
    };
    const probeArgs = [fileURLToPath(new URL(publicProbe ? './probe-fenced-public.mjs' : './probe-fenced-candidate.mjs', import.meta.url)),
      ...(publicProbe ? [] : ['--base-url', `http://127.0.0.1:${port}`]),
      '--release-id', releaseIdentity.releaseId, '--git-sha', releaseIdentity.gitSha, '--manifest-digest', releaseIdentity.manifestDigest, '--slot', releaseIdentity.slot,
      ...(publicProbe && !exactLegacyCompose ? ['--config-schema', manifest.contracts.configSchema,
        '--migration-floor', manifest.contracts.migration.expandFloor,
        '--migration-catalog-digest', manifest.contracts.migration.catalogDigest,
        '--telegram-bot-mode', 'webhook', '--telegram-webhook-enabled', 'true',
        '--telegram-webhook-url', 'https://booking-preprod.happybooking.uk/telegram/webhook'] : [])];
    const probeRuntimeArtifacts = exactLegacyCompose ? null : combineArtifactChecks(inspectReleaseRuntime, inspectTelegramEgress);
    return guardPlan({ executable: process.execPath, argv: probeArgs, cwd: paths.releaseDirectory,
      env: trustedEnvironment.env, environmentBinding: trustedEnvironment.environmentBinding,
      artifactBinding: { probe: { slot: releaseIdentity.slot, ...(publicProbe ? { origin: 'https://booking-preprod.happybooking.uk',
        ...(!exactLegacyCompose ? { configSchema: manifest.contracts.configSchema, migrationFloor: manifest.contracts.migration.expandFloor,
          migrationCatalogDigest: manifest.contracts.migration.catalogDigest, telegramBotMode: 'webhook', telegramWebhookEnabled: true,
          telegramWebhookUrl: 'https://booking-preprod.happybooking.uk/telegram/webhook' } : {}) } : { port }),
        releaseId: releaseIdentity.releaseId, gitSha: releaseIdentity.gitSha, manifestDigest: releaseIdentity.manifestDigest } },
      ...(probeRuntimeArtifacts ? { preflightArtifacts: probeRuntimeArtifacts, verifyArtifacts: probeRuntimeArtifacts,
        replayPreflightArtifacts: probeRuntimeArtifacts, replayVerifyArtifacts: probeRuntimeArtifacts } : {}),
      verifyExecution: verifyProbe, readback: { executable: process.execPath, argv: probeArgs, verify: verifyProbe }, readbackFromExecution: false });
  }
  if (spec.kind === 'compose-stage') {
    const services = [`backend-${state.candidate.slot}`, `gateway-${state.candidate.slot}`];
    const portName = state.candidate.slot === 'blue' ? 'BOOKING_BLUE_PORT' : 'BOOKING_GREEN_PORT';
    const activePortName = state.active.slot === 'blue' ? 'BOOKING_BLUE_PORT' : 'BOOKING_GREEN_PORT';
    requireBoundEnvironment(trustedEnvironment, ['BOOKING_GREEN_PORT', 'BOOKING_BLUE_PORT']);
    const actionEnvironment = trustedEnvironment.env;
    const candidatePort = Number(actionEnvironment[portName]);
    const activePort = Number(actionEnvironment[activePortName]);
    if (Number(actionEnvironment.BOOKING_GREEN_PORT) !== 18082 || Number(actionEnvironment.BOOKING_BLUE_PORT) !== 18083) {
      throw new ContractError('trusted preproduction slot ports must bind green=18082 and blue=18083', EXIT.IDENTITY);
    }
    if (!Number.isInteger(candidatePort) || candidatePort < 1 || candidatePort > 65535) throw new ContractError(`${portName} is invalid`, EXIT.IDENTITY);
    if (!Number.isInteger(activePort) || activePort < 1 || activePort > 65535 || activePort === candidatePort) {
      throw new ContractError('active and candidate loopback ports must be valid and distinct', EXIT.IDENTITY);
    }
    const inspectStageImages = inspectImages(['backend', 'gateway']);
    const runtimeInspectFormat = ['{{json .Config.Labels}}', '{{json .Config.Env}}', '{{json .Mounts}}', '{{json .NetworkSettings.Networks}}',
      '{{json .HostConfig.ReadonlyRootfs}}', '{{json .HostConfig.CapDrop}}', '{{json .HostConfig.CapAdd}}', '{{json .HostConfig.SecurityOpt}}',
      '{{json .HostConfig.PortBindings}}', '{{json .Config.User}}', '{{json .HostConfig.Privileged}}', '{{json .HostConfig.PidMode}}',
      '{{json .HostConfig.IpcMode}}', '{{json .HostConfig.Devices}}'].join('\n');
    const inspectStageArtifacts = async (context) => ({
      ...(await inspectStageImages(context)),
      routeContract: await inspectImmutableRouteContract(paths, manifest, runtime),
      telegramEgress: await inspectTelegramEgress(context),
    });
    const initialStagePreflight = async (context) => {
      if (state.phase !== 'ROLLED_BACK') await assertLoopbackPortAvailable(candidatePort, runtime);
      return inspectStageArtifacts(context);
    };
    return guardPlan({ executable: docker, argv: [...composePrefix, 'up', '--no-build', '--no-deps', '--wait', ...services], cwd: paths.releaseDirectory,
      env: trustedEnvironment.env, environmentBinding: trustedEnvironment.environmentBinding,
      artifactBinding: { backend: { image: artifacts.backend.image, digest: artifacts.backend.digest },
        gateway: { image: artifacts.gateway.image, digest: artifacts.gateway.digest, frontendAssetDigest: artifacts.gateway.frontendAssetDigest,
          routeContractDigest: artifacts.gateway.routeContractDigest, telegramBotUsername: artifacts.gateway.telegramBotUsername,
          telegramBotDisplayName: artifacts.gateway.telegramBotDisplayName } },
      preflight: { executable: docker, argv: [...composePrefix, 'config', '--services'], verify: (value) => {
        const available = new Set(value.trim().split(/\r?\n/).filter(Boolean));
        for (const service of services) if (!available.has(service)) throw new ContractError(`compose does not define inactive-slot candidate service ${service}`, EXIT.IDENTITY);
      } },
      preflightArtifacts: initialStagePreflight, replayPreflightArtifacts: inspectStageArtifacts,
      readback: { executable: process.execPath, argv: [fileURLToPath(new URL('./probe-fenced-candidate.mjs', import.meta.url)),
        '--base-url', `http://127.0.0.1:${candidatePort}`, '--release-id', state.candidate.releaseId, '--git-sha', state.candidate.gitSha,
        '--manifest-digest', state.candidate.manifestDigest, '--slot', state.candidate.slot], verify: (value) => {
        let parsed; try { parsed = JSON.parse(value); } catch { throw new ContractError('candidate readback is not JSON', EXIT.READINESS); }
        if (parsed.status !== 'pass' || parsed.releaseId !== state.candidate.releaseId || parsed.gitSha !== state.candidate.gitSha ||
            parsed.manifestDigest !== state.candidate.manifestDigest || parsed.slot !== state.candidate.slot) throw new ContractError('candidate runtime identity readback mismatch', EXIT.READINESS);
        return parsed;
      } },
      verifyArtifacts: async ({ runner, env, timeoutMs, statePath, preflightEvidence }) => {
        const imageEvidence = await inspectStageArtifacts({ runner, env, timeoutMs });
        for (const component of ['backend', 'gateway']) {
          if (imageEvidence[component].imageId !== preflightEvidence[component].imageId) throw new ContractError(`${component} release tag drifted during candidate start`, EXIT.IDENTITY);
        }
        const containerIds = {};
        const runtimeBindings = {};
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
          const runtimeResult = await runner(docker, ['container', 'inspect', '--format', runtimeInspectFormat, containerId],
            { cwd: paths.releaseDirectory, env, timeoutMs });
          assertResult(runtimeResult, EXIT.IDENTITY);
          runtimeBindings[component] = verifyCandidateContainerRuntime(component, runtimeResult.stdout, state, releaseIdentity, paths, candidatePort);
        }
        const temporaryRoot = join(dirname(statePath), 'executor', 'tmp');
        await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
        const frontendDirectory = await mkdtemp(join(temporaryRoot, 'gateway-h5-'));
        try {
          const copyResult = await runner(docker, ['cp', `${containerIds.gateway}:/usr/share/nginx/html/.`, frontendDirectory], { cwd: paths.releaseDirectory, env, timeoutMs });
          assertResult(copyResult, EXIT.IDENTITY);
          const observedFrontendDigest = await directoryDigest(frontendDirectory, 'running gateway H5 directory');
          if (observedFrontendDigest !== artifacts.gateway.frontendAssetDigest) throw new ContractError('running gateway H5 digest does not match release manifest', EXIT.IDENTITY);
          return { ...imageEvidence, runtimeBindings, frontendAssetDigest: observedFrontendDigest,
            routeContractDigest: imageEvidence.routeContract.digest };
        } finally { await rm(frontendDirectory, { recursive: true, force: true }); }
      } });
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
    const migrationBackupPreflight = verifyBackupObject('BOOKING_MIGRATION_BACKUP_RECEIPT_DIGEST', 'BOOKING_MIGRATION_BACKUP_RECEIPT_HOST_FILE', 'candidate');
    const migrationArtifacts = async (context) => ({ ...(await backendImagePreflight(context)), dataPlane: await inspectDataPlane(context),
      backup: await migrationBackupPreflight(context) });
    const verifyMigrationArtifacts = async (context) => ({ ...(await verifyOneShotArtifacts([oneShotName, readbackName])(context)),
      dataPlane: await inspectDataPlane(context), backup: await migrationBackupPreflight(context) });
    const replayVerifyMigrationArtifacts = async (context) => ({ ...(await verifyOneShotArtifacts([readbackName])(context)),
      dataPlane: await inspectDataPlane(context), backup: await migrationBackupPreflight(context) });
    return guardPlan({ executable: docker, argv: [...composePrefix, '--profile', 'migrate', 'run', '--no-deps', '--name', oneShotName, 'schema-migrate'], cwd: paths.releaseDirectory,
      env: trustedEnvironment.env, environmentBinding: trustedEnvironment.environmentBinding,
      artifactBinding: { backend: { image: artifacts.backend.image, digest: artifacts.backend.digest } },
      preflightArtifacts: migrationArtifacts, replayPreflightArtifacts: migrationArtifacts,
      verifyExecution: (value) => verifyMigrationReceipt(value, expectedMigration, 'apply'),
      readback: { executable: docker, argv: [...composePrefix, '--profile', 'migrate-readback', 'run', '--no-deps', '--name', readbackName, 'schema-migration-readback'],
        verify: (value) => verifyMigrationReceipt(value, expectedMigration, 'verify') },
      verifyArtifacts: verifyMigrationArtifacts, replayVerifyArtifacts: replayVerifyMigrationArtifacts });
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
    const baselineBackupPreflight = verifyBackupObject('BOOKING_BASELINE_BACKUP_RECEIPT_DIGEST', 'BOOKING_BASELINE_BACKUP_RECEIPT_HOST_FILE', 'old', true);
    const baselineArtifacts = async (context) => ({ ...(await backendImagePreflight(context)), dataPlane: await inspectDataPlane(context),
      backup: await baselineBackupPreflight(context) });
    const verifyBaselineArtifacts = async (context) => ({ ...(await verifyOneShotArtifacts([oneShotName, readbackName])(context)),
      dataPlane: await inspectDataPlane(context), backup: await baselineBackupPreflight(context) });
    const replayVerifyBaselineArtifacts = async (context) => ({ ...(await verifyOneShotArtifacts([readbackName])(context)),
      dataPlane: await inspectDataPlane(context), backup: await baselineBackupPreflight(context) });
    return guardPlan({ executable: docker, argv: [...composePrefix, '--profile', 'baseline-ledger', 'run', '--no-deps', '--name', oneShotName, 'schema-baseline-ledger'], cwd: paths.releaseDirectory,
      env: trustedEnvironment.env, environmentBinding: trustedEnvironment.environmentBinding,
      artifactBinding: { backend: { image: artifacts.backend.image, digest: artifacts.backend.digest }, baseline: expectedBaseline },
      preflightArtifacts: baselineArtifacts, replayPreflightArtifacts: baselineArtifacts,
      verifyExecution: (value) => verifyBaselineReceipt(value, expectedBaseline, 'apply'),
      readback: { executable: docker, argv: [...composePrefix, '--profile', 'baseline-readback', 'run', '--no-deps', '--name', readbackName, 'schema-baseline-readback'],
        verify: (value) => verifyBaselineReceipt(value, expectedBaseline, 'verify') },
      verifyArtifacts: verifyBaselineArtifacts, replayVerifyArtifacts: replayVerifyBaselineArtifacts });
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
    return guardPlan({ executable: docker, argv: [...composePrefix, '--profile', 'telegram-webhook-set', 'run', '--no-deps', '--name', oneShotName, 'telegram-webhook-set'], cwd: paths.releaseDirectory,
      env: trustedEnvironment.env, environmentBinding: trustedEnvironment.environmentBinding,
      artifactBinding: { backend: { image: artifacts.backend.image, digest: artifacts.backend.digest }, webhook: expectedWebhook,
        migrationLedger: { catalogDigest: expectedMigration.migrationCatalogDigest, floor: expectedMigration.migrationFloor,
          backupReceiptDigest: expectedMigration.backupReceiptDigest, ledgerHead: expectedMigration.ledgerHead } },
      preflight: { executable: docker, argv: [...composePrefix, '--profile', 'migrate-readback', 'run', '--no-deps', '--name', ledgerReadbackName, 'schema-migration-readback'],
        verify: (value) => verifyMigrationReceipt(value, expectedMigration, 'verify') },
      preflightArtifacts: combineArtifactChecks(backendImagePreflight, inspectTelegramEgress),
      verifyExecution: (value) => verifyWebhookReceipt(value, expectedWebhook, 'set'),
      readback: { executable: docker, argv: [...composePrefix, '--profile', 'telegram-webhook-readback', 'run', '--no-deps', '--name', readbackName, 'telegram-webhook-readback'],
        verify: (value) => verifyWebhookReceipt(value, expectedWebhook, 'verify') },
      verifyArtifacts: combineArtifactChecks(verifyOneShotArtifacts([ledgerReadbackName, oneShotName, readbackName]), inspectTelegramEgress),
      replayVerifyArtifacts: combineArtifactChecks(verifyOneShotArtifacts([ledgerReadbackName, readbackName]), inspectTelegramEgress) });
  }
  const helper = runtime.ingressExecutable || await findTrustedRootExecutable(['/usr/local/libexec/happybooking/switch-preprod-ingress']);
  const hostname = 'booking-preprod.happybooking.uk';
  const upstream = `gateway-${releaseIdentity.slot}:8080`;
  const rollbackIdentity = state.rollback;
  if (!rollbackIdentity || sameReleaseIdentity(rollbackIdentity, releaseIdentity) !== (args.action === 'preprod-rollback-ingress')) {
    throw new ContractError('ingress action target and immutable rollback cycle baseline are inconsistent', EXIT.INGRESS);
  }
  const sequence = args.action === 'preprod-rollback-ingress' ? 2 : (state.rollbackRehearsalCompleted ? 3 : 1);
  const actionKind = args.action;
  const rollbackUpstream = `gateway-${rollbackIdentity.slot}:8080`;
  const cycleBinding = { actionKind, actionId: args['action-id'], sequence, approvalId: state.approvalId,
    leaseId: state.lease.leaseId, holderId: state.lease.holderId, rollbackUpstream,
    rollbackReleaseId: rollbackIdentity.releaseId, rollbackManifestDigest: rollbackIdentity.manifestDigest };
  const mutationArgs = ['--execute', 'true', '--environment', state.environment, '--project', state.project, '--hostname', hostname,
    '--upstream', upstream, '--release', releaseIdentity.releaseId, '--manifest-digest', releaseIdentity.manifestDigest,
    '--operation-id', state.operationId, '--approval-id', state.approvalId, '--lease-id', state.lease.leaseId,
    '--holder-id', state.lease.holderId, '--action-kind', actionKind, '--action-id', args['action-id'], '--sequence', String(sequence),
    '--fencing-epoch', String(state.fencingEpoch), '--rollback-upstream', rollbackUpstream, '--rollback-release', rollbackIdentity.releaseId,
    '--rollback-manifest-digest', rollbackIdentity.manifestDigest];
  const ingressRuntimeArtifacts = exactLegacyCompose ? null : combineArtifactChecks(inspectReleaseRuntime, inspectTelegramEgress);
  return guardPlan({ executable: helper, argv: mutationArgs, cwd: paths.releaseDirectory,
    env: trustedEnvironment.env, environmentBinding: trustedEnvironment.environmentBinding,
    artifactBinding: { ingress: { hostname, upstream, releaseId: releaseIdentity.releaseId, manifestDigest: releaseIdentity.manifestDigest,
      operationId: state.operationId, fencingEpoch: state.fencingEpoch, ...cycleBinding } },
    ...(ingressRuntimeArtifacts ? { preflightArtifacts: ingressRuntimeArtifacts, verifyArtifacts: ingressRuntimeArtifacts,
      replayPreflightArtifacts: ingressRuntimeArtifacts, replayVerifyArtifacts: ingressRuntimeArtifacts } : {}),
    readback: { executable: helper, argv: ['--readback', '--project', state.project, '--hostname', hostname], verify: (value) => {
      let parsed; try { parsed = JSON.parse(value); } catch { throw new ContractError('ingress readback is not JSON', EXIT.INGRESS); }
      const expectedKeys = ['schema', 'project', 'hostname', 'upstream', 'releaseId', 'manifestDigest', 'operationId', 'approvalId', 'leaseId',
        'holderId', 'actionKind', 'actionId', 'sequence', 'fencingEpoch', 'rollbackUpstream', 'rollbackReleaseId', 'rollbackManifestDigest',
        'proofDigest', 'remoteVersion', 'remoteConfigDigest', 'guard', 'observedAt'];
      const guard = parsed?.guard;
      if (!parsed || Object.keys(parsed).sort().join(',') !== [...expectedKeys].sort().join(',') || parsed.schema !== 'booking.ingress-readback/v2' ||
          parsed.project !== state.project || parsed.hostname !== hostname || parsed.upstream !== upstream || parsed.releaseId !== releaseIdentity.releaseId ||
          parsed.manifestDigest !== releaseIdentity.manifestDigest || parsed.operationId !== state.operationId || parsed.fencingEpoch !== state.fencingEpoch ||
          parsed.approvalId !== cycleBinding.approvalId || parsed.leaseId !== cycleBinding.leaseId || parsed.holderId !== cycleBinding.holderId ||
          parsed.actionKind !== cycleBinding.actionKind || parsed.actionId !== cycleBinding.actionId || parsed.sequence !== cycleBinding.sequence ||
          parsed.rollbackUpstream !== cycleBinding.rollbackUpstream || parsed.rollbackReleaseId !== cycleBinding.rollbackReleaseId ||
          parsed.rollbackManifestDigest !== cycleBinding.rollbackManifestDigest || !DIGEST.test(parsed.proofDigest || '') ||
          !Number.isSafeInteger(parsed.remoteVersion) || parsed.remoteVersion < 0 || !DIGEST.test(parsed.remoteConfigDigest || '') ||
          !guard || Object.keys(guard).sort().join(',') !== ['mode', 'atomicRemoteCas', 'opportunisticIfMatch', 'exclusiveWriteRequired'].sort().join(',') ||
          guard.mode !== 'double-read-version-and-digest' || guard.atomicRemoteCas !== false || typeof guard.opportunisticIfMatch !== 'boolean' ||
          guard.exclusiveWriteRequired !== true ||
          !Number.isFinite(Date.parse(parsed.observedAt))) throw new ContractError('ingress readback identity mismatch', EXIT.INGRESS);
      return parsed;
    } } });
}

function commandIdentity(plan) {
  return sha256({ executable: plan.executable, argv: plan.argv, cwd: plan.cwd,
    preflight: plan.preflight ? { executable: plan.preflight.executable, argv: plan.preflight.argv } : null,
    readback: plan.readback ? { executable: plan.readback.executable, argv: plan.readback.argv } : null,
    readbackFromExecution: plan.readbackFromExecution === true, artifactBinding: plan.artifactBinding || null,
    environmentBinding: plan.environmentBinding || null,
    registrySupplyChainBinding: plan.registrySupplyChainBinding || null });
}

function replaceCliValue(argv, name, value) {
  const next = [...argv];
  const index = next.indexOf(name);
  if (index < 0 || index === next.length - 1) throw new ContractError(`ingress recovery command is missing ${name}`, EXIT.INGRESS);
  next[index + 1] = String(value);
  return next;
}

function priorPendingIngressPlan(state, args, releaseIdentity, resource, plan, resourceIds) {
  const pending = resource.pendingAction;
  if (!pending || pending.action !== args.action || pending.fencingEpoch !== resource.highestAcceptedFencingEpoch ||
      pending.fencingEpoch >= state.fencingEpoch || pending.actionId === args['action-id']) {
    throw new ContractError('prior pending ingress recovery identity is incomplete or inconsistent', EXIT.INGRESS);
  }
  let priorArgv = plan.argv;
  for (const [name, value] of [['--approval-id', pending.approvalId], ['--lease-id', pending.leaseId], ['--holder-id', pending.holderId],
    ['--action-id', pending.actionId], ['--fencing-epoch', pending.fencingEpoch]]) priorArgv = replaceCliValue(priorArgv, name, value);
  const priorRegistryBinding = plan.registrySupplyChainBinding
    ? { ...plan.registrySupplyChainBinding, fencingEpoch: pending.fencingEpoch }
    : null;
  const priorPlan = { ...plan, argv: priorArgv, artifactBinding: { ...plan.artifactBinding,
    ingress: { ...plan.artifactBinding.ingress, approvalId: pending.approvalId, leaseId: pending.leaseId,
      holderId: pending.holderId, actionId: pending.actionId, fencingEpoch: pending.fencingEpoch } },
    ...(priorRegistryBinding ? { registrySupplyChainBinding: priorRegistryBinding,
      environmentBinding: { ...plan.environmentBinding,
        BOOKING_REGISTRY_SUPPLY_CHAIN_DIGEST: sha256(priorRegistryBinding) } } : {}) };
  const priorRequest = { schema: 'booking.fenced-action-request/v1', environment: state.environment, project: state.project,
    action: args.action, actionId: pending.actionId, operationId: state.operationId, approvalId: pending.approvalId,
    generation: pending.generation, fencingEpoch: pending.fencingEpoch, leaseId: pending.leaseId, holderId: pending.holderId,
    manifestDigest: releaseIdentity.manifestDigest, releaseIdentity, resourceIds, runtimeEnvDigest: state.runtimeEnvDigest,
    commandDigest: commandIdentity(priorPlan) };
  if (priorRequest.commandDigest !== pending.commandDigest || sha256(priorRequest) !== pending.requestDigest) {
    throw new ContractError('prior pending ingress request digest does not match its immutable recovery identity', EXIT.INGRESS);
  }
  return { pending, priorPlan, recoveryArgv: [...priorArgv, '--recover-pending', 'true'] };
}

function verifyPriorPendingIngress(readback, state, args, releaseIdentity, resource, priorIdentity) {
  let observed;
  try { observed = JSON.parse(readback.stdout); } catch { throw new ContractError('prior pending ingress proof readback is not JSON', EXIT.INGRESS); }
  const pending = priorIdentity.pending;
  const rollback = state.rollback;
  const sequence = args.action === 'preprod-rollback-ingress' ? 2 : (state.rollbackRehearsalCompleted ? 3 : 1);
  if (!pending || args['action-id'] === pending.actionId || observed?.schema !== 'booking.ingress-readback/v2' ||
      observed.project !== state.project || observed.hostname !== 'booking-preprod.happybooking.uk' ||
      observed.upstream !== `gateway-${releaseIdentity.slot}:8080` || observed.releaseId !== releaseIdentity.releaseId ||
      observed.manifestDigest !== releaseIdentity.manifestDigest || observed.operationId !== state.operationId ||
      observed.fencingEpoch !== resource.highestAcceptedFencingEpoch || observed.actionKind !== args.action ||
      observed.actionId !== pending.actionId || observed.sequence !== sequence ||
      observed.rollbackUpstream !== `gateway-${rollback.slot}:8080` || observed.rollbackReleaseId !== rollback.releaseId ||
      observed.rollbackManifestDigest !== rollback.manifestDigest || observed.approvalId !== pending.approvalId ||
      observed.leaseId !== pending.leaseId || observed.holderId !== pending.holderId ||
      !DIGEST.test(observed.proofDigest || '') || !DIGEST.test(observed.remoteConfigDigest || '') ||
      !Number.isSafeInteger(observed.remoteVersion) || observed.guard?.mode !== 'double-read-version-and-digest' ||
      observed.guard?.atomicRemoteCas !== false || observed.guard?.exclusiveWriteRequired !== true) {
    throw new ContractError('prior pending ingress identity/action does not match the independently proven remote state', EXIT.INGRESS);
  }
  return observed;
}

const TAKEOVER_ADOPTABLE_ACTIONS = new Set([
  'preprod-stage', 'preprod-baseline-ledger', 'preprod-expand-migrate',
  'preprod-transfer-singletons', 'preprod-rollback-singletons',
]);

function receiptRequestBody(receipt) {
  return { schema: 'booking.fenced-action-request/v1', environment: receipt.environment, project: receipt.project,
    action: receipt.action, actionId: receipt.actionId, operationId: receipt.operationId, approvalId: receipt.approvalId,
    generation: receipt.generation, fencingEpoch: receipt.fencingEpoch, leaseId: receipt.leaseId, holderId: receipt.holderId,
    manifestDigest: receipt.manifestDigest, releaseIdentity: receipt.releaseIdentity, resourceIds: receipt.resourceIds,
    runtimeEnvDigest: receipt.runtimeEnvDigest, commandDigest: receipt.commandDigest };
}

async function takeoverAdoption(statePath, state, args, releaseIdentity, resourceIds, resourceStates) {
  if (!TAKEOVER_ADOPTABLE_ACTIONS.has(args.action) || state.fencingEpoch < 2) return null;
  const heads = [...new Set(resourceStates.map((resource) => resource.receiptChainHead).filter(Boolean))];
  const canonical = [];
  for (const head of heads) canonical.push({ head, ...(await readCanonicalExecutorReceiptByDigest(statePath, head)) });
  const matching = canonical.filter(({ receipt }) => receipt.action === args.action && receipt.operationId === state.operationId &&
    receipt.manifestDigest === releaseIdentity.manifestDigest);
  if (matching.length === 0) return null;
  if (heads.length !== 1 || matching.length !== 1 || resourceStates.some((resource) => resource.pendingAction !== null ||
      resource.receiptChainHead !== heads[0] || resource.operationId !== state.operationId ||
      resource.manifestDigest !== releaseIdentity.manifestDigest || resource.highestAcceptedFencingEpoch >= state.fencingEpoch)) {
    throw new ContractError('prior-fence action completion is inconsistent and cannot be adopted', EXIT.SINGLETON);
  }
  const { head, receipt, acceptedReceipt } = matching[0];
  const expectedResources = [...resourceIds].sort();
  const observedResources = [...(receipt.resourceIds || [])].sort();
  if (acceptedReceipt.receiptDigest !== head || receipt.schema !== 'booking.external-action-receipt/v1' || receipt.status !== 'pass' ||
      receipt.environment !== state.environment || receipt.project !== state.project || receipt.fencingEpoch >= state.fencingEpoch ||
      receipt.actionId === args['action-id'] || receipt.runtimeEnvDigest !== state.runtimeEnvDigest ||
      canonicalJson(receipt.releaseIdentity) !== canonicalJson(releaseIdentity) ||
      canonicalJson(observedResources) !== canonicalJson(expectedResources) || receipt.requestDigest !== sha256(receiptRequestBody(receipt))) {
    throw new ContractError('prior-fence action receipt does not match the canonical adoption identity', EXIT.SINGLETON);
  }
  return { receipt, acceptedReceipt };
}

function assertResult(result, exitCode) {
  if (!result || result.exitCode !== 0 || result.signal || result.overflow) throw new ContractError('external action failed or exceeded its bounded output', exitCode);
}

async function verifyCurrentExternalState(plan, context) {
  if (plan.registrySupplyChainGate) await plan.registrySupplyChainGate();
  if (!plan.readback) throw new ContractError('recorded action has no independent replay readback', EXIT.SINGLETON);
  let preflightVerification = null;
  if (plan.preflight) {
    const preflight = await context.runner(plan.preflight.executable, plan.preflight.argv, {
      cwd: plan.cwd, env: context.env, timeoutMs: context.timeoutMs,
    });
    assertResult(preflight, EXIT.IDENTITY);
    preflightVerification = plan.preflight.verify(preflight.stdout);
  }
  let preflightArtifactEvidence = null;
  const replayPreflightArtifacts = plan.replayPreflightArtifacts || plan.preflightArtifacts;
  if (replayPreflightArtifacts) preflightArtifactEvidence = await replayPreflightArtifacts(context);
  const readback = await context.runner(plan.readback.executable, plan.readback.argv, {
    cwd: plan.cwd, env: context.env, timeoutMs: context.timeoutMs,
  });
  assertResult(readback, EXIT.IDENTITY);
  const verification = { ...(preflightVerification ? { preflight: preflightVerification } : {}), runtime: plan.readback.verify(readback.stdout) };
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
    let rootedWebhookReplay = false;
    if (args.action === 'preprod-set-webhook' && state.phase === 'OBSERVING') {
      const rootedDigest = state.evidence.webhookReceiptDigest;
      if (!rootedDigest) throw new ContractError('OBSERVING has no rooted webhook action to replay', EXIT.INGRESS);
      const { receipt, acceptedReceipt } = await readCanonicalExecutorReceiptByDigest(statePath, rootedDigest);
      if (acceptedReceipt.receiptDigest !== rootedDigest || receipt.action !== args.action || receipt.actionId !== args['action-id'] ||
          receipt.operationId !== state.operationId || receipt.fencingEpoch !== state.fencingEpoch) {
        throw new ContractError('OBSERVING permits only exact replay of the rooted webhook action', EXIT.INGRESS);
      }
      rootedWebhookReplay = true;
    }
    const plan = await (runtime.planBuilder || buildPlan)(state, args, runtime);
    const requestBody = { schema: 'booking.fenced-action-request/v1', environment: state.environment, project: state.project,
      action: args.action, actionId: args['action-id'], operationId: state.operationId, approvalId: state.approvalId,
      generation: state.generation, fencingEpoch: state.fencingEpoch, leaseId: state.lease.leaseId, holderId: state.lease.holderId,
      manifestDigest: releaseIdentity.manifestDigest, releaseIdentity, resourceIds, runtimeEnvDigest: state.runtimeEnvDigest,
      commandDigest: commandIdentity(plan) };
    const requestDigest = sha256(requestBody);
    const priorReceipt = await readExecutorReceipt(statePath, state.fencingEpoch, args.action, args['action-id']);
    if (priorReceipt && ((!rootedWebhookReplay && priorReceipt.requestDigest !== requestDigest) || priorReceipt.status !== 'pass')) {
      throw new ContractError('existing action receipt does not match this request', EXIT.SINGLETON);
    }
    const locks = await acquireResourceLocks(statePath, resourceIds);
    try {
      const runner = runtime.commandRunner || defaultCommandRunner;
      if (plan.registrySupplyChainGate) await plan.registrySupplyChainGate();
      if (priorReceipt) {
        if (spec.kind.includes('ingress') && locks.length === 1) {
          const priorEpochResource = await inspectLockedResourceState(locks[0], {
            environment: state.environment, project: state.project, resourceId: locks[0].resourceId,
          });
          if (priorEpochResource.highestAcceptedFencingEpoch < state.fencingEpoch && priorEpochResource.pendingAction !== null) {
            const adoption = priorReceipt.verification?.adoption;
            if (priorEpochResource.operationId !== state.operationId || priorEpochResource.manifestDigest !== releaseIdentity.manifestDigest ||
                adoption?.priorFencingEpoch !== priorEpochResource.highestAcceptedFencingEpoch ||
                adoption?.priorRequestDigest !== priorEpochResource.pendingAction.requestDigest ||
                !['prior-pending-proven-applied-read-only', 'prior-pending-proven-not-applied-and-retried'].includes(adoption?.mode)) {
              throw new ContractError('prior-epoch ingress completion cannot recover the pending resource identity', EXIT.INGRESS);
            }
            if (adoption.mode === 'prior-pending-proven-applied-read-only') {
              const priorIdentity = priorPendingIngressPlan(state, args, releaseIdentity, priorEpochResource, plan, resourceIds);
              const priorReadback = await runner(plan.readback.executable, plan.readback.argv, {
                cwd: plan.cwd, env: plan.env || runtime.env || process.env,
                timeoutMs: Math.max(1, Date.parse(state.lease.expiresAt) - now().getTime() - 500),
              });
              assertResult(priorReadback, EXIT.INGRESS);
              verifyPriorPendingIngress(priorReadback, state, args, releaseIdentity, priorEpochResource, priorIdentity);
              const replayArtifacts = plan.replayVerifyArtifacts || plan.verifyArtifacts;
              if (replayArtifacts) {
                const replayPreflight = plan.replayPreflightArtifacts || plan.preflightArtifacts;
                const preflightEvidence = replayPreflight ? await replayPreflight({ runner,
                  env: plan.env || runtime.env || process.env,
                  timeoutMs: Math.max(1, Date.parse(state.lease.expiresAt) - now().getTime() - 500), statePath }) : null;
                await replayArtifacts({ runner, env: plan.env || runtime.env || process.env,
                  timeoutMs: Math.max(1, Date.parse(state.lease.expiresAt) - now().getTime() - 500), statePath,
                  preflightEvidence });
              }
            } else {
              await verifyCurrentExternalState(plan, { runner, env: plan.env || runtime.env || process.env,
                timeoutMs: Math.max(1, Date.parse(state.lease.expiresAt) - now().getTime() - 500), statePath });
            }
            if (!runtime.planBuilder) await inspectTrustedRuntimeEnvironment(state, runtime);
            if (plan.registrySupplyChainGate) await plan.registrySupplyChainGate();
            const recoveredAt = now();
            if (!(recoveredAt instanceof Date) || recoveredAt.getTime() >= Date.parse(state.lease.expiresAt)) {
              throw new ContractError('lease expired before ingress completion recovery', EXIT.SINGLETON);
            }
            await adoptPriorEpochPendingAction(locks[0], {
              fencingEpoch: priorEpochResource.highestAcceptedFencingEpoch,
              pendingAction: structuredClone(priorEpochResource.pendingAction),
              receiptChainHead: priorEpochResource.receiptChainHead,
            }, { environment: state.environment, project: state.project, resourceId: priorEpochResource.resourceId,
              fencingEpoch: state.fencingEpoch, operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest,
              now: recoveredAt.toISOString() }, priorReceipt.receiptDigest);
            return priorReceipt;
          }
        }
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
        if (!runtime.planBuilder) await inspectTrustedRuntimeEnvironment(state, runtime);
        if (plan.registrySupplyChainGate) await plan.registrySupplyChainGate();
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
      if (spec.kind.includes('ingress') && state.fencingEpoch >= 2) {
        const priorResource = await inspectLockedResourceState(locks[0], {
          environment: state.environment, project: state.project, resourceId: locks[0].resourceId,
        });
        if (priorResource.pendingAction !== null && priorResource.highestAcceptedFencingEpoch < state.fencingEpoch) {
          if (locks.length !== 1 || priorResource.operationId !== state.operationId || priorResource.manifestDigest !== releaseIdentity.manifestDigest) {
            throw new ContractError('prior pending ingress resource identity cannot be recovered', EXIT.INGRESS);
          }
          const runner = runtime.commandRunner || defaultCommandRunner;
          const timeoutMs = Math.max(1, Date.parse(state.lease.expiresAt) - now().getTime() - 500);
          const priorIdentity = priorPendingIngressPlan(state, args, releaseIdentity, priorResource, plan, resourceIds);
          let priorProof = null;
          let priorProofOutput = null;
          let notApplied = null;
          const priorReadback = await runner(plan.readback.executable, plan.readback.argv, {
            cwd: plan.cwd, env: plan.env || runtime.env || process.env, timeoutMs,
          });
          if (priorReadback?.exitCode === 0 && !priorReadback.signal && !priorReadback.overflow) {
            priorProof = verifyPriorPendingIngress(priorReadback, state, args, releaseIdentity, priorResource, priorIdentity);
            priorProofOutput = priorReadback.stdout;
          } else {
            if (plan.registrySupplyChainGate) await plan.registrySupplyChainGate();
            const recovered = await runner(plan.executable, priorIdentity.recoveryArgv, {
              cwd: plan.cwd, env: plan.env || runtime.env || process.env, timeoutMs,
            });
            assertResult(recovered, EXIT.INGRESS);
            let recoveryValue;
            try { recoveryValue = JSON.parse(recovered.stdout); }
            catch { throw new ContractError('prior pending ingress recovery is not JSON', EXIT.INGRESS); }
            if (recoveryValue?.schema === 'booking.ingress-readback/v2') {
              priorProof = verifyPriorPendingIngress(recovered, state, args, releaseIdentity, priorResource, priorIdentity);
              priorProofOutput = recovered.stdout;
            } else {
              const pending = priorIdentity.pending;
              const expectedSequence = args.action === 'preprod-rollback-ingress' ? 2 : (state.rollbackRehearsalCompleted ? 3 : 1);
              const expectedPreviousUpstream = expectedSequence === 2
                ? `gateway-${state.active.slot}:8080`
                : `gateway-${state.rollback.slot}:8080`;
              const expectedRecoveryKeys = ['schema', 'outcome', 'project', 'hostname', 'operationId', 'actionKind', 'actionId',
                'sequence', 'fencingEpoch', 'expectedPreviousUpstream', 'remoteVersion', 'remoteConfigDigest',
                'previousProofDigest', 'guard', 'observedAt'];
              const recoveryGuard = recoveryValue?.guard;
              if (!recoveryValue || Object.keys(recoveryValue).sort().join(',') !== expectedRecoveryKeys.sort().join(',') ||
                  recoveryValue.schema !== 'booking.ingress-pending-recovery/v1' || recoveryValue.outcome !== 'not-applied' ||
                  recoveryValue.project !== state.project || recoveryValue.hostname !== 'booking-preprod.happybooking.uk' ||
                  recoveryValue.operationId !== state.operationId || recoveryValue.actionKind !== args.action ||
                  recoveryValue.actionId !== pending.actionId || recoveryValue.sequence !== expectedSequence ||
                  recoveryValue.fencingEpoch !== pending.fencingEpoch || recoveryValue.expectedPreviousUpstream !== expectedPreviousUpstream ||
                  !DIGEST.test(recoveryValue.remoteConfigDigest || '') || !Number.isSafeInteger(recoveryValue.remoteVersion) ||
                  (recoveryValue.previousProofDigest !== null && !DIGEST.test(recoveryValue.previousProofDigest || '')) ||
                  !recoveryGuard || Object.keys(recoveryGuard).sort().join(',') !==
                    ['mode', 'atomicRemoteCas', 'opportunisticIfMatch', 'exclusiveWriteRequired'].sort().join(',') ||
                  recoveryGuard.mode !== 'double-read-version-and-digest' || recoveryGuard.atomicRemoteCas !== false ||
                  typeof recoveryGuard.opportunisticIfMatch !== 'boolean' || recoveryGuard.exclusiveWriteRequired !== true ||
                  !Number.isFinite(Date.parse(recoveryValue.observedAt))) {
                throw new ContractError('prior pending ingress not-applied proof is invalid', EXIT.INGRESS);
              }
              notApplied = recoveryValue;
            }
          }
          let preflightArtifactEvidence = null;
          if (plan.preflightArtifacts) preflightArtifactEvidence = await plan.preflightArtifacts({
            runner, env: plan.env || runtime.env || process.env, timeoutMs, statePath,
          });
          if (notApplied) {
            await supersedePriorEpochPendingAction(locks[0], {
              fencingEpoch: priorResource.highestAcceptedFencingEpoch,
              pendingAction: structuredClone(priorResource.pendingAction), receiptChainHead: priorResource.receiptChainHead,
            }, { environment: state.environment, project: state.project, resourceId: priorResource.resourceId,
              fencingEpoch: state.fencingEpoch, operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest,
              action: args.action, actionId: args['action-id'], requestDigest, approvalId: state.approvalId,
              leaseId: state.lease.leaseId, holderId: state.lease.holderId, generation: state.generation,
              commandDigest: requestBody.commandDigest, now: firstNow.toISOString() });
          }
          let execution = null;
          let executionVerification = null;
          let readback = null;
          let verification = priorProof;
          if (notApplied) {
            if (plan.registrySupplyChainGate) await plan.registrySupplyChainGate();
            execution = await runner(plan.executable, plan.argv, { cwd: plan.cwd, env: plan.env || runtime.env || process.env, timeoutMs });
            assertResult(execution, EXIT.INGRESS);
            executionVerification = plan.readback.verify(execution.stdout);
            readback = await runner(plan.readback.executable, plan.readback.argv, { cwd: plan.cwd, env: plan.env || runtime.env || process.env, timeoutMs });
            assertResult(readback, EXIT.INGRESS);
            verification = plan.readback.verify(readback.stdout);
          }
          const artifactVerifier = plan.verifyArtifacts;
          const artifactVerification = artifactVerifier ? await artifactVerifier({ runner,
            env: plan.env || runtime.env || process.env, timeoutMs, statePath, preflightEvidence: preflightArtifactEvidence }) : null;
          if (!runtime.planBuilder) await inspectTrustedRuntimeEnvironment(state, runtime);
          if (plan.registrySupplyChainGate) await plan.registrySupplyChainGate();
          const completedAt = now();
          if (!(completedAt instanceof Date) || completedAt.getTime() >= Date.parse(state.lease.expiresAt)) throw new ContractError('lease expired before pending ingress recovery completed', EXIT.SINGLETON);
          const receiptBody = { ...requestBody, schema: 'booking.external-action-receipt/v1', requestDigest,
            startedAt: firstNow.toISOString(), completedAt: completedAt.toISOString(), status: 'pass',
            executionOutputDigest: sha256(execution?.stdout || ''),
            readbackOutputDigest: sha256(readback?.stdout || priorProofOutput || ''),
            verification: { ...(executionVerification ? { execution: executionVerification } : {}), runtime: verification,
              ...(artifactVerification ? { artifacts: artifactVerification } : {}),
              adoption: { mode: notApplied ? 'prior-pending-proven-not-applied-and-retried' : 'prior-pending-proven-applied-read-only',
                priorProofDigest: priorProof?.proofDigest || notApplied.previousProofDigest,
                priorFencingEpoch: priorResource.highestAcceptedFencingEpoch,
                priorRequestDigest: priorResource.pendingAction.requestDigest } },
            resources: [{ resourceId: priorResource.resourceId, highestAcceptedFencingEpoch: state.fencingEpoch,
              previousReceiptDigest: priorResource.receiptChainHead }] };
          const receipt = { ...receiptBody, receiptDigest: sha256(receiptBody) };
          await writeExecutorReceipt(statePath, receipt);
          if (notApplied) {
            await completeResourceAction(locks[0], { environment: state.environment, project: state.project,
              resourceId: priorResource.resourceId, fencingEpoch: state.fencingEpoch, operationId: state.operationId,
              actionId: args['action-id'], requestDigest, now: completedAt.toISOString() }, receipt.receiptDigest);
          } else {
            await adoptPriorEpochPendingAction(locks[0], { fencingEpoch: priorResource.highestAcceptedFencingEpoch,
              pendingAction: structuredClone(priorResource.pendingAction),
              receiptChainHead: priorResource.receiptChainHead }, { environment: state.environment, project: state.project,
              resourceId: priorResource.resourceId, fencingEpoch: state.fencingEpoch, operationId: state.operationId,
              manifestDigest: releaseIdentity.manifestDigest, now: completedAt.toISOString() }, receipt.receiptDigest);
          }
          return receipt;
        }
      }
      const allowedPreviousManifestDigest = spec.identity === 'rollback' && state.phase === 'ROLLBACK_PENDING'
        ? (state.candidate || state.active)?.manifestDigest
        : (['preprod-stage', 'preprod-transfer-singletons', 'preprod-switch-ingress'].includes(args.action) && state.candidate &&
          state.active.manifestDigest !== state.candidate.manifestDigest ? state.active.manifestDigest : null);
      const resourceStatesBeforeAction = [];
      if (TAKEOVER_ADOPTABLE_ACTIONS.has(args.action) && state.fencingEpoch >= 2) {
        for (const lock of locks) resourceStatesBeforeAction.push(await inspectLockedResourceState(lock, {
          environment: state.environment, project: state.project, resourceId: lock.resourceId,
        }));
      }
      const adoption = resourceStatesBeforeAction.length
        ? await takeoverAdoption(statePath, state, args, releaseIdentity, resourceIds, resourceStatesBeforeAction)
        : null;
      if (adoption) {
        const accepted = [];
        for (const lock of locks) accepted.push(await acceptResourceEpoch(lock, {
          environment: state.environment, project: state.project, resourceId: lock.resourceId, fencingEpoch: state.fencingEpoch,
          operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest, allowedPreviousManifestDigest,
          action: args.action, actionId: args['action-id'], requestDigest, approvalId: state.approvalId,
          leaseId: state.lease.leaseId, holderId: state.lease.holderId, generation: state.generation,
          commandDigest: requestBody.commandDigest, now: firstNow.toISOString(),
        }));
        let replay;
        try {
          replay = await verifyCurrentExternalState(plan, { runner, env: plan.env || runtime.env || process.env,
            timeoutMs: Math.max(1, Date.parse(state.lease.expiresAt) - now().getTime() - 500), statePath,
            adoptionReceipt: adoption.receipt });
          if (!runtime.planBuilder) await inspectTrustedRuntimeEnvironment(state, runtime);
          if (plan.registrySupplyChainGate) await plan.registrySupplyChainGate();
        } catch (error) {
          const failedAt = now();
          const failureBody = { ...requestBody, schema: 'booking.external-action-receipt/v1', requestDigest,
            startedAt: firstNow.toISOString(), completedAt: failedAt instanceof Date && Number.isFinite(failedAt.getTime()) ? failedAt.toISOString() : firstNow.toISOString(),
            status: 'fail', executionOutputDigest: sha256(''), readbackOutputDigest: sha256(''),
            verification: { error: error instanceof ContractError ? error.message : 'takeover adoption readback failed' },
            resources: accepted.map((item) => ({ resourceId: item.resourceId, highestAcceptedFencingEpoch: item.highestAcceptedFencingEpoch,
              previousReceiptDigest: item.receiptChainHead })) };
          await writeExecutorReceipt(statePath, { ...failureBody, receiptDigest: sha256(failureBody) });
          throw error;
        }
        const completedAt = now();
        if (!(completedAt instanceof Date) || completedAt.getTime() >= Date.parse(state.lease.expiresAt)) {
          throw new ContractError('lease expired before takeover adoption readback completed', EXIT.SINGLETON);
        }
        const receiptBody = { ...requestBody, schema: 'booking.external-action-receipt/v1', requestDigest,
          startedAt: firstNow.toISOString(), completedAt: completedAt.toISOString(), status: 'pass', executionOutputDigest: sha256(''),
          readbackOutputDigest: replay.readbackOutputDigest,
          verification: { ...replay.verification, adoption: { priorReceiptDigest: adoption.acceptedReceipt.receiptDigest,
            priorFencingEpoch: adoption.receipt.fencingEpoch, mode: 'independent-readback' } },
          resources: accepted.map((item) => ({ resourceId: item.resourceId, highestAcceptedFencingEpoch: item.highestAcceptedFencingEpoch,
            previousReceiptDigest: item.receiptChainHead })) };
        const receipt = { ...receiptBody, receiptDigest: sha256(receiptBody) };
        await writeExecutorReceipt(statePath, receipt);
        for (const lock of locks) await completeResourceAction(lock, { environment: state.environment, project: state.project, resourceId: lock.resourceId,
          fencingEpoch: state.fencingEpoch, operationId: state.operationId, actionId: args['action-id'], requestDigest,
          now: completedAt.toISOString() }, receipt.receiptDigest);
        return receipt;
      }
      let preflightArtifactEvidence = null;
      let preflightVerification = null;
      if (plan.preflight) {
        const preflight = await runner(plan.preflight.executable, plan.preflight.argv, { cwd: plan.cwd, env: plan.env || runtime.env || process.env,
          timeoutMs: Math.max(1, Date.parse(state.lease.expiresAt) - firstNow.getTime() - 1_000) });
        assertResult(preflight, EXIT.IDENTITY);
        preflightVerification = plan.preflight.verify(preflight.stdout);
      }
      if (plan.preflightArtifacts) {
        preflightArtifactEvidence = await plan.preflightArtifacts({ runner, env: plan.env || runtime.env || process.env,
          timeoutMs: Math.max(1, Date.parse(state.lease.expiresAt) - firstNow.getTime() - 1_000) });
      }
      if (plan.registrySupplyChainGate) await plan.registrySupplyChainGate();
      const accepted = [];
      for (const lock of locks) accepted.push(await acceptResourceEpoch(lock, {
        environment: state.environment, project: state.project, resourceId: lock.resourceId, fencingEpoch: state.fencingEpoch,
        operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest, allowedPreviousManifestDigest,
        action: args.action, actionId: args['action-id'], requestDigest, approvalId: state.approvalId,
        leaseId: state.lease.leaseId, holderId: state.lease.holderId, generation: state.generation,
        commandDigest: requestBody.commandDigest, now: firstNow.toISOString(),
      }));
      let execution;
      let readback;
      let verification;
      let completedAt;
      try {
        const remaining = Date.parse(state.lease.expiresAt) - firstNow.getTime();
        if (remaining < 2_000) throw new ContractError('lease has insufficient remaining time for external action', EXIT.SINGLETON);
        if (plan.registrySupplyChainGate) await plan.registrySupplyChainGate();
        execution = await runner(plan.executable, plan.argv, { cwd: plan.cwd, env: plan.env || runtime.env || process.env, timeoutMs: remaining - 1_000 });
        assertResult(execution, spec.kind === 'compose-migrate' || spec.kind === 'compose-baseline' ? EXIT.DATABASE : spec.kind.includes('webhook') || spec.kind.includes('ingress') ? EXIT.INGRESS : EXIT.SWITCH);
        const executionVerification = plan.verifyExecution ? plan.verifyExecution(execution.stdout) : null;
        readback = execution;
        if (plan.readback) {
          readback = await runner(plan.readback.executable, plan.readback.argv, { cwd: plan.cwd, env: plan.env || runtime.env || process.env, timeoutMs: Math.max(1, Date.parse(state.lease.expiresAt) - now().getTime() - 500) });
          assertResult(readback, spec.kind === 'compose-migrate' ? EXIT.DATABASE : spec.kind.includes('ingress') ? EXIT.INGRESS : EXIT.READINESS);
        }
        verification = { ...(preflightVerification ? { preflight: preflightVerification } : {}),
          ...(executionVerification ? { execution: executionVerification } : {}), runtime: (plan.readback?.verify || plan.verify)(readback.stdout) };
        if (plan.verifyArtifacts) {
          verification.artifacts = await plan.verifyArtifacts({ runner, env: plan.env || runtime.env || process.env,
            timeoutMs: Math.max(1, Date.parse(state.lease.expiresAt) - now().getTime() - 500), statePath, preflightEvidence: preflightArtifactEvidence });
        }
        if (!runtime.planBuilder) await inspectTrustedRuntimeEnvironment(state, runtime);
        if (plan.registrySupplyChainGate) await plan.registrySupplyChainGate();
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
