#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { canonicalJson, ContractError, EXIT, gateResult, parseArgs, readJsonFile, sha256, validateReleaseManifest } from './lib/contracts.mjs';
import { composeBundleDigest, digestFile, directoryDigest } from './lib/artifacts.mjs';
import { canonicalStatePath, withDeployStateLock } from './lib/deploy-state-store.mjs';
import { schemaForAction } from './lib/external-action-contract.mjs';
import { acceptResourceActionGroup, acceptResourceEpoch, acquireResourceLocks, adoptPriorEpochPendingAction, completeResourceAction,
  completeResourceActionGroup, finalizeRecoveredResourceActionGroup, inspectLockedResourceState,
  markResourceActionGroupExecuting, markResourceActionGroupMutating, markResourceActionGroupReceipt,
  readCanonicalExecutorReceiptByDigest, readCompletedExecutorReceiptByDigest, readExecutorReceipt, readExecutorRecoveryReceiptByDigest,
  readResourceActionGroup, reconcileResourceActionGroupReceipt,
  recoverResourceAction, releaseResourceLocks, resourceDirectory, resumeResourceActionGroupBeforeDispatch,
  supersedePriorEpochPendingAction, writeExecutorReceipt,
  writeExecutorRecoveryReceipt } from './lib/fenced-resource-store.mjs';
import { LEGACY_OLD_BINDING } from './lib/legacy-preprod.mjs';
import { ROLLBACK_MODE, rollbackModeForState } from './lib/state-machine.mjs';
import { verifyRegistrySupplyChainRuntime } from './lib/registry-runtime-gate.mjs';
import { TELEGRAM_PROXY_URL, verifyTelegramEgressReceipt } from './verify-telegram-egress.mjs';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const DOCKER_CONTAINER_ID = /^[0-9a-f]{64}$/;
const ALLOWED_FIELDS = new Set([
  'action', 'execute', 'environment', 'project', 'approval-id', 'expected-generation', 'expected-fencing-epoch',
  'manifest-digest', 'operation-id', 'lease-id', 'holder-id', 'resource-id', 'action-id',
]);
const ACTIONS = Object.freeze({
  'preprod-baseline-ledger': { phases: ['STAGED'], primary: 'databaseRef', resources: ['databaseRef', 'dataNetwork'], kind: 'compose-baseline' },
  'preprod-expand-migrate': { phases: ['STAGED'], primary: 'databaseRef', resources: ['databaseRef', 'dataNetwork'], kind: 'compose-migrate' },
  'preprod-prepare-telegram-egress': { phases: ['EXPAND_MIGRATED', 'ROLLED_BACK'], primary: 'telegram', resources: ['telegram'], kind: 'compose-egress' },
  'preprod-abort-telegram-egress': { phases: ['FAILED'], primary: 'telegram', resources: ['telegram'], kind: 'failed-egress-abort' },
  'preprod-attest-database-restore': { phases: ['FAILED'], primary: 'databaseRef', resources: ['databaseRef', 'dataNetwork'], kind: 'failed-database-attestation' },
  'preprod-restore-active-runtime': { phases: ['FAILED'], primary: 'edgeNetwork', resources: ['edgeNetwork', 'dataNetwork', 'databaseRef', 'telegram', 'ingressRef'], kind: 'failed-active-runtime-restore', identity: 'active' },
  'preprod-probe-recovered-active': { phases: ['FAILED'], primary: 'activeProbe', resources: ['activeProbe'], kind: 'release-probe', identity: 'active' },
  'preprod-stage': { phases: ['EXPAND_MIGRATED', 'ROLLED_BACK'], primary: 'edgeNetwork', resources: ['edgeNetwork', 'telegram'], kind: 'compose-stage' },
  'preprod-probe-candidate': { phases: ['CANDIDATE_STARTED'], primary: 'candidateProbe', resources: ['candidateProbe'], kind: 'release-probe' },
  'preprod-probe-active': { phases: ['CANDIDATE_READY'], primary: 'activeProbe', resources: ['activeProbe'], kind: 'release-probe', identity: 'active' },
  'preprod-probe-observation': { phases: ['OBSERVING'], primary: 'observationProbe', resources: ['observationProbe'], kind: 'release-probe', identity: 'active' },
  'preprod-probe-rollback': { phases: ['ROLLBACK_PENDING'], primary: 'rollbackProbe', resources: ['rollbackProbe'], kind: 'release-probe', identity: 'rollback' },
  'preprod-transfer-singletons': { phases: ['CANDIDATE_READY'], primary: 'edgeNetwork', resources: ['edgeNetwork', 'dataNetwork', 'databaseRef', 'telegram'], kind: 'singleton-transfer' },
  'preprod-set-webhook': { phases: ['SWITCHED', 'OBSERVING'], primary: 'telegram', resources: ['telegram', 'databaseRef', 'dataNetwork'], kind: 'compose-webhook', identity: 'active' },
  'preprod-switch-ingress': { phases: ['SINGLETON_TRANSFERRED'], primary: 'ingressRef', resources: ['ingressRef', 'edgeNetwork'], kind: 'ingress-helper' },
  'preprod-rollback-ingress': { phases: ['ROLLBACK_PENDING'], primary: 'ingressRef', resources: ['ingressRef', 'edgeNetwork'], kind: 'ingress-helper', identity: 'rollback' },
  'preprod-rollback-singletons': { phases: ['ROLLBACK_PENDING'], primary: 'edgeNetwork', resources: ['edgeNetwork', 'dataNetwork', 'databaseRef', 'telegram'], kind: 'singleton-transfer', identity: 'rollback' },
});

const RETRYABLE_READ_ONLY_PROBES = new Set([
  'preprod-probe-candidate',
  'preprod-probe-active',
  'preprod-probe-observation',
  'preprod-probe-rollback',
  'preprod-probe-recovered-active',
]);

export function parseRootOwnedForensicManifest(value) {
  if (typeof value !== 'string' || !value.trim()) throw new ContractError('failed database restore forensic manifest is empty', EXIT.IDENTITY);
  const entries = new Map();
  for (const line of value.trim().split(/\r?\n/)) {
    const match = /^([^|/]+)\|([0-7]{3,4})\|root\|root\|(\d+)\|([0-9a-f]{64})\s+(.+)$/.exec(line);
    if (!match || entries.has(match[1]) || match[1] !== match[5].split('/').at(-1)) {
      throw new ContractError('failed database restore forensic manifest entry is invalid', EXIT.IDENTITY);
    }
    entries.set(match[1], { mode: Number.parseInt(match[2], 8), uid: 0, gid: 0,
      size: Number(match[3]), digest: `sha256:${match[4]}` });
  }
  return entries;
}

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
  const configuredRoot = runtime.releaseRoot || `/volume1/happybooking/${state.project}/releases`;
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

function verifyReceiptReaderComposeService(services, serviceName, expectedMountTargets) {
  const service = services[serviceName];
  const networks = composeNetworkKeys(service);
  const mounts = Array.isArray(service?.volumes) ? service.volumes : [];
  const mountTargets = mounts.map((mount) => typeof mount === 'string' ? '' : mount?.target).sort();
  const allMountsReadOnly = mounts.every((mount) => typeof mount !== 'string' && mount?.type === 'bind' && mount?.read_only === true);
  if (!service || String(service.user) !== '0:0' || service.read_only !== true ||
      JSON.stringify(service.cap_drop) !== JSON.stringify(['ALL']) ||
      !Array.isArray(service.security_opt) || !service.security_opt.includes('no-new-privileges:true') ||
      service.privileged === true || service.network_mode || Object.hasOwn(service, 'ports') ||
      JSON.stringify(networks) !== JSON.stringify(['preprod-data']) || !allMountsReadOnly ||
      JSON.stringify(mountTargets) !== JSON.stringify([...expectedMountTargets].sort())) {
    throw new ContractError(`rendered ${serviceName} violates the root-only receipt-reader isolation contract`, EXIT.IDENTITY);
  }
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
  verifyReceiptReaderComposeService(services, 'schema-baseline-ledger', [
    '/run/booking-evidence/backup-receipt.json',
    '/run/booking-evidence/schema-diff-receipt.json',
  ]);
  verifyReceiptReaderComposeService(services, 'schema-migrate', ['/run/booking-evidence/backup-receipt.json']);
  verifyReceiptReaderComposeService(services, 'schema-migration-readback', ['/run/booking-evidence/backup-receipt.json']);
  for (const serviceName of ['schema-baseline-readback', 'telegram-bot-identity', 'telegram-webhook-set', 'telegram-webhook-readback']) {
    if (String(services[serviceName]?.user || '') === '0:0') {
      throw new ContractError(`rendered ${serviceName} exceeded the receipt-reader root allowlist`, EXIT.IDENTITY);
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

function hasExactObjectKeys(value, keys) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort()));
}

function verifyWebhookReceipt(stdout, expected, action) {
  const value = parseLastJson(stdout, 'Telegram webhook action did not emit a JSON readback receipt', EXIT.INGRESS);
  const deliveryError = value?.webhook?.deliveryError;
  const validErrorSnapshot = (snapshot) => hasExactObjectKeys(snapshot, ['date', 'message']) &&
    (snapshot.date === null || (Number.isSafeInteger(snapshot.date) && snapshot.date >= 0)) &&
    (snapshot.message === null || (typeof snapshot.message === 'string' && snapshot.message.length <= 4096));
  const webhookKeys = ['url', 'pendingUpdateCount', 'allowedUpdates', 'deliveryError'];
  if (Object.hasOwn(value?.webhook || {}, 'maxConnections')) webhookKeys.push('maxConnections');
  const verificationKeys = ['candidateReady', 'getMeIdentityMatched', 'readBackUrlMatched', 'allowedUpdatesMatched', 'noNewDeliveryError'];
  if (action === 'set') verificationKeys.push('setWebhookAccepted');
  if (!hasExactObjectKeys(value, ['schemaVersion', 'action', 'environment', 'completedAt', 'bot', 'candidate', 'webhook', 'verification']) ||
      !hasExactObjectKeys(value?.bot, ['id', 'username']) ||
      !hasExactObjectKeys(value?.candidate, ['releaseId', 'gitSha', 'manifestDigest', 'configSchema', 'migrationFloor', 'migrationCatalogDigest']) ||
      !hasExactObjectKeys(value?.webhook, webhookKeys) || !hasExactObjectKeys(value?.verification, verificationKeys) ||
      value?.schemaVersion !== 2 || value?.action !== action || value?.environment !== 'preproduction' ||
      value?.verification?.candidateReady !== true || value?.verification?.getMeIdentityMatched !== true ||
      (action === 'set' && value?.verification?.setWebhookAccepted !== true) ||
      (action === 'verify' && Object.hasOwn(value?.verification || {}, 'setWebhookAccepted')) ||
      value?.verification?.readBackUrlMatched !== true || value?.verification?.allowedUpdatesMatched !== true ||
      value?.verification?.noNewDeliveryError !== true || value?.candidate?.releaseId !== expected.releaseId ||
      value?.candidate?.gitSha !== expected.gitSha || value?.candidate?.manifestDigest !== expected.manifestDigest ||
      value?.candidate?.configSchema !== expected.configSchema || value?.candidate?.migrationFloor !== expected.migrationFloor ||
      value?.candidate?.migrationCatalogDigest !== expected.migrationCatalogDigest ||
      String(value?.webhook?.url || '') !== expected.webhookUrl || !Number.isSafeInteger(value?.bot?.id) ||
      !Number.isSafeInteger(value?.webhook?.pendingUpdateCount) || value.webhook.pendingUpdateCount < 0 ||
      (Object.hasOwn(value.webhook, 'maxConnections') &&
        (!Number.isSafeInteger(value.webhook.maxConnections) || value.webhook.maxConnections < 1 || value.webhook.maxConnections > 100)) ||
      canonicalJson(value?.webhook?.allowedUpdates) !== canonicalJson(['message', 'callback_query']) ||
      !hasExactObjectKeys(deliveryError, ['before', 'after', 'changedAfterSet']) || deliveryError.changedAfterSet !== false ||
      !validErrorSnapshot(deliveryError.before) || !validErrorSnapshot(deliveryError.after) ||
      typeof value?.bot?.username !== 'string' || (expected.botId !== null && value.bot.id !== expected.botId) ||
      (expected.botUsername !== null && value.bot.username !== expected.botUsername) || !Number.isFinite(Date.parse(value?.completedAt))) {
    throw new ContractError('Telegram webhook readback receipt is incomplete', EXIT.INGRESS);
  }
  return { botId: value.bot?.id, botUsername: value.bot?.username, webhookUrl: value.webhook?.url,
    allowedUpdates: value.webhook.allowedUpdates, deliveryError: value.webhook.deliveryError };
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

function exactStringMultiset(values, expected) {
  return Array.isArray(values) && canonicalJson([...values].sort()) === canonicalJson([...expected].sort());
}

function expectedLegacyNetworkAliases(component, expected) {
  const composeContainerName = `booking-preprod-${expected.service}-1`;
  const shortContainerId = expected.id.slice(0, 12);
  // Docker Compose emitted the gateway service alias twice in the frozen NAS
  // inventory. Treat aliases as an exact multiset: order is irrelevant, but
  // duplicate count is part of the one-time legacy identity contract.
  const businessAliases = component === 'gateway' ? [expected.service, expected.service] : [expected.service];
  return [composeContainerName, ...businessAliases, shortContainerId];
}

function environmentMap(values, component) {
  const result = new Map();
  if (!Array.isArray(values)) throw new ContractError(`${component} legacy environment is malformed`, EXIT.IDENTITY);
  for (const item of values) {
    const index = typeof item === 'string' ? item.indexOf('=') : -1;
    if (index < 1 || result.has(item.slice(0, index))) throw new ContractError(`${component} legacy environment is malformed`, EXIT.IDENTITY);
    result.set(item.slice(0, index), item.slice(index + 1));
  }
  return result;
}

export function verifyLegacyActiveRuntimeInspect(stdout, state, binding = LEGACY_ACTIVE_RUNTIME_BINDING, requireHealthy = true,
  allowStopped = false) {
  let values;
  try { values = JSON.parse(stdout); } catch { throw new ContractError('legacy active runtime inspect readback is not JSON', EXIT.IDENTITY); }
  if (!Array.isArray(values) || values.length !== 2) throw new ContractError('legacy active runtime inspect must contain exactly two fixed containers', EXIT.IDENTITY);
  const byId = new Map(values.map((value) => [value?.Id, value]));
  const result = {};
  for (const component of ['backend', 'gateway']) {
    const expected = binding[component];
    const value = byId.get(expected.id);
    const labels = value?.Config?.Labels;
    const host = value?.HostConfig;
    const networkNames = value?.NetworkSettings?.Networks && typeof value.NetworkSettings.Networks === 'object'
      ? Object.keys(value.NetworkSettings.Networks).sort() : [];
    const expectedNetworks = component === 'backend' ? [state.resources.dataNetwork, state.resources.edgeNetwork].sort() : [state.resources.edgeNetwork];
    const expectedUser = component === 'backend' ? '' : '101';
    const expectedCapAdd = component === 'backend' ? null : ['NET_BIND_SERVICE'];
    if (!value || value.Name !== `/booking-preprod-${expected.service}-1` || value.Image !== expected.imageId ||
        value.Config?.Image !== expected.image || labels?.['com.docker.compose.project'] !== state.project ||
        labels?.['com.docker.compose.service'] !== expected.service || labels?.['com.docker.compose.config-hash'] !== expected.configHash ||
        typeof value.State?.Running !== 'boolean' || (!allowStopped && value.State.Running !== true) ||
        (requireHealthy && (value.State.Running !== true || value.State?.Health?.Status !== 'healthy')) ||
        value.Config?.User !== expectedUser || host?.ReadonlyRootfs !== true || host?.Privileged !== false ||
        canonicalJson(host?.CapDrop) !== canonicalJson(['ALL']) || canonicalJson(host?.CapAdd ?? null) !== canonicalJson(expectedCapAdd) ||
        canonicalJson(host?.SecurityOpt) !== canonicalJson(['no-new-privileges:true']) || host?.PidMode !== '' || host?.IpcMode !== 'private' ||
        host?.Devices !== null || canonicalJson(networkNames) !== canonicalJson(expectedNetworks)) {
      throw new ContractError(`${component} fixed legacy container identity or isolation drifted`, EXIT.IDENTITY);
    }
    for (const network of expectedNetworks) {
      const expectedAliases = expectedLegacyNetworkAliases(component, expected);
      if (!exactStringMultiset(value.NetworkSettings.Networks[network]?.Aliases, expectedAliases)) {
        throw new ContractError(`${component} fixed legacy network alias drifted`, EXIT.IDENTITY);
      }
    }
    const mounts = (value.Mounts || []).map((mount) => ({ type: mount.Type, source: mount.Source || '', destination: mount.Destination,
      rw: mount.RW, propagation: mount.Propagation || '' })).sort((left, right) => left.destination.localeCompare(right.destination));
    if (component === 'backend') {
      const env = environmentMap(value.Config.Env, component);
      if (mounts.length !== 0 || canonicalJson(host.PortBindings || {}) !== canonicalJson({}) ||
          env.get('TELEGRAM_BOT_MODE') !== 'polling' || env.get('TELEGRAM_ENABLE_WEBHOOK') !== 'false') {
        throw new ContractError('backend fixed legacy mount, port, or Telegram delivery mode drifted', EXIT.IDENTITY);
      }
    } else {
      const expectedMounts = [
        { type: 'tmpfs', source: '', destination: '/tmp', rw: true, propagation: '' },
        { type: 'bind', source: binding.nginx.source, destination: binding.nginx.destination, rw: false, propagation: 'rprivate' },
        { type: 'tmpfs', source: '', destination: '/var/cache/nginx', rw: true, propagation: '' },
        { type: 'tmpfs', source: '', destination: '/var/run', rw: true, propagation: '' },
      ].sort((left, right) => left.destination.localeCompare(right.destination));
      const expectedPorts = { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '18082' }] };
      if (canonicalJson(mounts) !== canonicalJson(expectedMounts) || canonicalJson(host.PortBindings) !== canonicalJson(expectedPorts)) {
        throw new ContractError('gateway fixed legacy mounts or loopback binding drifted', EXIT.IDENTITY);
      }
    }
    result[component] = { containerId: expected.id, imageId: expected.imageId, configHash: expected.configHash,
      service: expected.service, networks: networkNames, running: value.State.Running, health: value.State?.Health?.Status || null };
  }
  return result;
}

export function verifyLegacyDockerStartOutput(value, binding = LEGACY_ACTIVE_RUNTIME_BINDING) {
  const observed = value.trim().split(/\r?\n/).filter(Boolean);
  const expected = [binding.backend, binding.gateway];
  if (observed.length !== expected.length || expected.some((container) => !observed.some((item) =>
    [container.id, container.id.slice(0, 12), `booking-preprod-${container.service}-1`].includes(item)))) {
    throw new ContractError('docker start did not report exactly the two fixed legacy containers', EXIT.IDENTITY);
  }
  return { startedExistingContainerIds: expected.map((container) => container.id) };
}

function parseSelectiveContainerInspect(value) {
  try {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) return JSON.parse(trimmed);
    return trimmed.split(/\r?\n/).map((line) => JSON.parse(line));
  } catch {
    throw new ContractError('fixed legacy supporting container readback is not JSON', EXIT.IDENTITY);
  }
}

export function verifyLegacyNetworkTopology(networkStdout, supportingContainersStdout, state, fixedContainers,
  binding = LEGACY_ACTIVE_RUNTIME_BINDING) {
  let networks;
  try {
    networks = JSON.parse(networkStdout);
  } catch {
    throw new ContractError('fixed legacy network topology readback is not JSON', EXIT.IDENTITY);
  }
  const supportingContainers = parseSelectiveContainerInspect(supportingContainersStdout);
  if (!Array.isArray(networks) || networks.length !== 2 || supportingContainers.length !== 3 ||
      typeof fixedContainers?.backend?.running !== 'boolean' || typeof fixedContainers?.gateway?.running !== 'boolean') {
    throw new ContractError('fixed legacy network topology readback has an invalid shape', EXIT.IDENTITY);
  }
  const byName = new Map(networks.map((network) => [network?.Name, network]));
  if (byName.size !== 2 || !byName.has(state.resources.edgeNetwork) || !byName.has(state.resources.dataNetwork)) {
    throw new ContractError('fixed legacy network identity drifted', EXIT.IDENTITY);
  }
  const expectedNames = {
    backend: `booking-preprod-${binding.backend.service}-1`,
    gateway: `booking-preprod-${binding.gateway.service}-1`,
    postgres: 'booking-preprod-postgres-1',
    redis: 'booking-preprod-redis-1',
    cloudflared: binding.cloudflared.name,
  };
  const expectedMembership = new Map([
    [state.resources.edgeNetwork, new Map()],
    [state.resources.dataNetwork, new Map()],
  ]);
  if (fixedContainers.backend.running) {
    expectedMembership.get(state.resources.edgeNetwork).set(binding.backend.id, expectedNames.backend);
    expectedMembership.get(state.resources.dataNetwork).set(binding.backend.id, expectedNames.backend);
  }
  if (fixedContainers.gateway.running) {
    expectedMembership.get(state.resources.edgeNetwork).set(binding.gateway.id, expectedNames.gateway);
  }
  const supportingIds = new Map();
  for (const { service, networkName } of [
    { service: 'postgres', networkName: state.resources.dataNetwork },
    { service: 'redis', networkName: state.resources.dataNetwork },
    { service: 'cloudflared', networkName: state.resources.edgeNetwork },
  ]) {
    const matches = Object.entries(byName.get(networkName)?.Containers || {})
      .filter(([, endpoint]) => endpoint?.Name === expectedNames[service]);
    if (matches.length !== 1 || !/^[0-9a-f]{64}$/.test(matches[0][0])) {
      throw new ContractError(`fixed legacy ${service} network endpoint identity drifted`, EXIT.IDENTITY);
    }
    supportingIds.set(service, matches[0][0]);
    expectedMembership.get(networkName).set(matches[0][0], expectedNames[service]);
  }
  for (const [networkName, expected] of expectedMembership) {
    const observed = byName.get(networkName)?.Containers;
    const entries = observed && typeof observed === 'object' && !Array.isArray(observed) ? Object.entries(observed) : [];
    if (entries.length !== expected.size || entries.some(([containerId, endpoint]) =>
      expected.get(containerId) !== endpoint?.Name)) {
      throw new ContractError(`fixed legacy ${networkName} endpoint membership drifted`, EXIT.IDENTITY);
    }
  }
  const byId = new Map(supportingContainers.map((container) => [container?.Id, container]));
  if (byId.size !== 3) throw new ContractError('fixed legacy supporting container identities are duplicated', EXIT.IDENTITY);
  for (const service of ['postgres', 'redis']) {
    const containerId = supportingIds.get(service);
    const container = byId.get(containerId);
    const containerNetworks = container?.Networks || container?.NetworkSettings?.Networks;
    const labels = container?.Labels || container?.Config?.Labels;
    const running = container?.Running ?? container?.State?.Running;
    const networkNames = containerNetworks && typeof containerNetworks === 'object' ? Object.keys(containerNetworks) : [];
    if (!container || container.Name !== `/${expectedNames[service]}` || running !== true ||
        labels?.['com.docker.compose.project'] !== state.project || labels?.['com.docker.compose.service'] !== service ||
        !exactStringMultiset(networkNames, [state.resources.dataNetwork]) ||
        !exactStringMultiset(containerNetworks[state.resources.dataNetwork]?.Aliases, [service])) {
      throw new ContractError(`fixed legacy ${service} network endpoint aliases or ownership drifted`, EXIT.IDENTITY);
    }
  }
  const cloudflaredId = supportingIds.get('cloudflared');
  const cloudflared = byId.get(cloudflaredId);
  const cloudflaredNetworks = cloudflared?.Networks || cloudflared?.NetworkSettings?.Networks;
  const cloudflaredNetworkNames = cloudflaredNetworks && typeof cloudflaredNetworks === 'object' ? Object.keys(cloudflaredNetworks) : [];
  const cloudflaredPorts = cloudflared?.PortBindings ?? cloudflared?.HostConfig?.PortBindings;
  const cloudflaredMounts = (cloudflared?.Mounts || []).map((mount) => ({ type: mount.Type, source: mount.Source || '',
    destination: mount.Destination, rw: mount.RW, propagation: mount.Propagation || '' }));
  const expectedCloudflaredCmd = binding.cloudflared.cmd || ['tunnel', '--no-autoupdate', '--token-file', '/run/secrets/tunnel-token', 'run'];
  const expectedCloudflaredMount = binding.cloudflared.tokenMount || { type: 'bind',
    source: '/etc/happybooking/secrets/cloudflare-preprod-tunnel-token', destination: '/run/secrets/tunnel-token', rw: false, propagation: 'rprivate' };
  if (!cloudflared || cloudflared.Name !== `/${binding.cloudflared.name}` || cloudflared.Image !== binding.cloudflared.imageId ||
      (cloudflared.ConfigImage ?? cloudflared.Config?.Image) !== binding.cloudflared.image ||
      (cloudflared.User ?? cloudflared.Config?.User) !== binding.cloudflared.user ||
      (cloudflared.Running ?? cloudflared.State?.Running) !== true ||
      (cloudflared.ReadonlyRootfs ?? cloudflared.HostConfig?.ReadonlyRootfs) !== true ||
      (cloudflared.Privileged ?? cloudflared.HostConfig?.Privileged) !== false ||
      canonicalJson(cloudflared.CapDrop ?? cloudflared.HostConfig?.CapDrop) !== canonicalJson(['ALL']) ||
      !exactStringMultiset(cloudflared.SecurityOpt ?? cloudflared.HostConfig?.SecurityOpt, ['no-new-privileges:true']) ||
      canonicalJson(cloudflared.Cmd ?? cloudflared.Config?.Cmd) !== canonicalJson(expectedCloudflaredCmd) ||
      canonicalJson(cloudflaredMounts) !== canonicalJson([expectedCloudflaredMount]) ||
      !exactStringMultiset(cloudflaredNetworkNames, [state.resources.edgeNetwork]) ||
      !exactStringMultiset(cloudflaredNetworks[state.resources.edgeNetwork]?.Aliases, [cloudflaredId.slice(0, 12)]) ||
      (cloudflaredPorts !== null && (typeof cloudflaredPorts !== 'object' || Object.keys(cloudflaredPorts).length !== 0))) {
    throw new ContractError('fixed legacy cloudflared identity, network, alias, or port binding drifted', EXIT.IDENTITY);
  }
  return {
    networks: [...expectedMembership].map(([network, members]) => ({ network,
      endpoints: [...members].map(([containerId, name]) => ({ containerId, name })) })),
    supportingContainerIds: Object.fromEntries(supportingIds),
  };
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
  const configHash = labels?.['com.docker.compose.config-hash'];
  if (labels?.['com.docker.compose.project'] !== state.project || labels?.['com.docker.compose.service'] !== service || !/^[0-9a-f]{64}$/.test(configHash || '') || readOnly !== true ||
      JSON.stringify(capDrop) !== JSON.stringify(['ALL']) || !Array.isArray(securityOpt) || !securityOpt.includes('no-new-privileges:true') ||
      user !== (component === 'backend' ? 'node' : '101') || privileged !== false || pidMode !== '' || ipcMode !== '' ||
      !Array.isArray(devices) || devices.length !== 0) {
    throw new ContractError(`${component} candidate runtime isolation identity mismatch`, EXIT.IDENTITY);
  }
  const networkNames = networks && typeof networks === 'object' && !Array.isArray(networks) ? Object.keys(networks).sort() : [];
  const expectedNetworks = component === 'backend' ? [state.resources.dataNetwork, state.resources.edgeNetwork, 'booking-preprod-telegram'].sort() : [state.resources.edgeNetwork];
  if (JSON.stringify(networkNames) !== JSON.stringify(expectedNetworks)) throw new ContractError(`${component} candidate network isolation mismatch`, EXIT.IDENTITY);
  const normalizedMounts = Array.isArray(mounts) ? mounts.map((item) => ({ type: item.Type, source: item.Source || '', destination: item.Destination, rw: item.RW })).sort((a, b) => a.destination.localeCompare(b.destination)) : [];
  const secretRoot = `/volume1/happybooking/${state.project}/.g4/secrets`;
  const expectedMounts = component === 'backend' ? [
    { type: 'tmpfs', source: '', destination: '/app/logs', rw: true }, { type: 'tmpfs', source: '', destination: '/tmp', rw: true },
    { type: 'bind', source: `${secretRoot}/telegram-data-encryption-secret`, destination: '/run/secrets/telegram_data_encryption_secret', rw: false },
    { type: 'bind', source: `${secretRoot}/telegram-webhook-secret`, destination: '/run/secrets/telegram_webhook_secret', rw: false },
  ] : [
    { type: 'tmpfs', source: '', destination: '/etc/nginx/conf.d', rw: true },
    { type: 'bind', source: join(paths.releaseDirectory, 'frontend', 'nginx.preprod.conf'), destination: '/etc/nginx/templates/default.conf.template', rw: false },
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
  } : { BOOKING_BACKEND_UPSTREAM: `backend-${releaseIdentity.slot}:3001`, NGINX_ENVSUBST_FILTER: 'BOOKING_BACKEND_UPSTREAM' };
  if (Object.entries(expectedEnv).some(([key, value]) => env.get(key) !== value)) throw new ContractError(`${component} candidate critical environment mismatch`, EXIT.IDENTITY);
  if (component === 'gateway') {
    if (JSON.stringify(capAdd) !== JSON.stringify(['NET_BIND_SERVICE']) || JSON.stringify(portBindings) !== JSON.stringify({ '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(candidatePort) }] })) {
      throw new ContractError('gateway candidate capability or loopback port binding mismatch', EXIT.IDENTITY);
    }
  } else if ((Array.isArray(capAdd) && capAdd.length) || (portBindings && Object.keys(portBindings).length)) {
    throw new ContractError('backend candidate must not expose host ports or added capabilities', EXIT.IDENTITY);
  }
  return { component, service, configHash, networks: networkNames, readOnlyRoot: true, mounts: expectedMounts.map((item) => item.destination),
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
  const fixedPath = `/volume1/happybooking/${state.project}/.env`;
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
    return verifyRegistrySupplyChainRuntime({ state, releaseIdentity, manifest }, runtime);
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
  const evidenceRoot = `/volume1/happybooking/${state.project}/.g4`;
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
    // `docker compose config` omits services whose profiles are inactive.
    // Admission must render every one-shot profile before it can prove the
    // baseline, migration, and webhook isolation contracts.
    const rendered = await runner(docker, [...composePrefix, '--profile', '*', 'config', '--format', 'json'], { cwd: paths.releaseDirectory, env, timeoutMs });
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
  const verifyOneShotArtifacts = (containers) => async ({ runner, env, timeoutMs, preflightEvidence, revalidateLease }) => {
    if (typeof revalidateLease !== 'function') {
      throw new ContractError('one-shot cleanup requires a live lease revalidator', EXIT.SINGLETON);
    }
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
      const leaseWindow = revalidateLease();
      const removed = await runner(docker, ['container', 'rm', container], {
        cwd: paths.releaseDirectory, env, timeoutMs: leaseWindow.timeoutMs,
      });
      assertResult(removed, EXIT.IDENTITY);
    }
    return { backend: imageEvidence.backend, containers };
  };
  if (spec.kind === 'failed-egress-abort') {
    const binding = runtime.failedRestoreBinding || FAILED_RESTORE_BINDING;
    if (state.operationId !== binding.operationId || releaseIdentity.manifestDigest !== binding.manifestDigest) {
      throw new ContractError('Telegram abort is not bound to this failed operation', EXIT.IDENTITY);
    }
    const { containerName, mutationArgv, readbackArgv } = telegramAbortDockerCommands(state.project);
    const verifyAbsent = (value) => {
      if (value.trim() !== '') throw new ContractError('failed Telegram egress container still exists', EXIT.SINGLETON);
      return { composeProject: state.project, composeService: 'telegram-egress', containerAbsent: true };
    };
    const verifyRemoved = (value) => {
      if (!DOCKER_CONTAINER_ID.test(value.trim())) throw new ContractError('Telegram egress abort did not return the removed container ID', EXIT.SINGLETON);
      return { removedContainerId: value.trim(), forcedRemoval: true };
    };
    const expectedConfigImage = `${manifest.artifacts.telegramEgress.image}@${manifest.artifacts.telegramEgress.digest}`;
    const verifyExactContainer = (value) => {
      let observed;
      try { observed = JSON.parse(value); } catch { throw new ContractError('Telegram egress abort inspect is malformed', EXIT.IDENTITY); }
      if (!DOCKER_CONTAINER_ID.test(observed?.Id || '') || observed?.Name !== `/${containerName}` ||
          !DIGEST.test(observed.Image || '') || observed.ConfigImage !== expectedConfigImage ||
          observed.Labels?.['com.docker.compose.project'] !== state.project ||
          observed.Labels?.['com.docker.compose.service'] !== 'telegram-egress') {
        throw new ContractError('Telegram egress abort target identity drifted', EXIT.IDENTITY);
      }
      return { containerName, containerId: observed.Id, imageId: observed.Image, configImage: observed.ConfigImage,
        composeProject: observed.Labels['com.docker.compose.project'], composeService: observed.Labels['com.docker.compose.service'] };
    };
    return guardPlan({ executable: docker, argv: mutationArgv, cwd: paths.releaseDirectory, env: trustedEnvironment.env,
      environmentBinding: trustedEnvironment.environmentBinding,
      artifactBinding: { recovery: { kind: 'telegram-egress-abort', operationId: state.operationId,
        priorAction: 'preprod-prepare-telegram-egress', priorActionId: binding.priorTelegramActionId,
        priorFencingEpoch: binding.priorTelegramFencingEpoch, priorFailureReceiptDigest: binding.priorTelegramFailureReceiptDigest } },
      preflight: { executable: docker, argv: ['container', 'inspect', '--format',
        '{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},"ConfigImage":{{json .Config.Image}},"Labels":{{json .Config.Labels}}}', containerName],
        verify: verifyExactContainer },
      verifyExecution: verifyRemoved,
      readback: { executable: docker, argv: readbackArgv, verify: verifyAbsent } });
  }
  if (spec.kind === 'failed-database-attestation') {
    const binding = runtime.failedRestoreBinding || FAILED_RESTORE_BINDING;
    if (state.operationId !== binding.operationId || releaseIdentity.manifestDigest !== binding.manifestDigest) {
      throw new ContractError('failed database recovery action is not bound to this failed operation', EXIT.IDENTITY);
    }
    if (!Number.isInteger(binding.forensicFencingEpoch) || state.fencingEpoch <= binding.forensicFencingEpoch) {
      throw new ContractError('failed database recovery requires a newer fencing epoch than the fixed restore evidence', EXIT.SINGLETON);
    }
    const attestForensicRestore = async ({ runner, env, timeoutMs, revalidateLease }) => {
      const directory = await realpath(binding.forensicDirectory).catch(() => {
        throw new ContractError('fixed failed database restore evidence is unavailable', EXIT.DATABASE);
      });
      const directoryMetadata = await stat(directory);
      if (directory !== binding.forensicDirectory || !directoryMetadata.isDirectory() ||
          (!runtime.allowNonRootEvidence && process.platform !== 'win32' && (directoryMetadata.uid !== 0 || (directoryMetadata.mode & 0o077) !== 0))) {
        throw new ContractError('fixed failed database restore evidence must be a canonical root-only directory', EXIT.IDENTITY);
      }
      const manifestPath = join(directory, 'forensic-manifest.txt');
      const manifestMetadata = await stat(manifestPath).catch(() => {
        throw new ContractError('failed database restore forensic manifest is unavailable', EXIT.DATABASE);
      });
      const expectedManifestDigest = binding.forensicManifestDigest;
      if (!manifestMetadata.isFile() || (!runtime.allowNonRootEvidence && process.platform !== 'win32' &&
          (manifestMetadata.uid !== 0 || (manifestMetadata.mode & 0o077) !== 0)) || await digestFile(manifestPath) !== expectedManifestDigest) {
        throw new ContractError('failed database restore forensic manifest identity mismatch', EXIT.IDENTITY);
      }
      const manifest = await readFile(manifestPath, 'utf8');
      const entries = parseRootOwnedForensicManifest(manifest);
      const observedNames = (await readdir(directory)).sort();
      const expectedNames = [...entries.keys(), 'forensic-manifest.txt'].sort();
      if (canonicalJson(observedNames) !== canonicalJson(expectedNames)) {
        throw new ContractError('failed database restore evidence directory contains unmanifested entries', EXIT.IDENTITY);
      }
      for (const name of ['restore-summary.txt', 'deploy-state.json', 'source-evidence-digests.txt',
        'live-after-table-digests.txt', 'live-after-sequence-values.txt', 'live-after-large-objects.sha256']) {
        if (!entries.has(name)) throw new ContractError(`failed database restore evidence omits ${name}`, EXIT.IDENTITY);
      }
      for (const [name, entry] of entries) {
        const path = join(directory, name);
        const canonical = await realpath(path).catch(() => { throw new ContractError(`failed database restore evidence ${name} is unavailable`, EXIT.DATABASE); });
        const metadata = await stat(canonical);
        if (canonical !== path || !metadata.isFile() || metadata.size !== entry.size || (metadata.mode & 0o777) !== entry.mode ||
            (!runtime.allowNonRootEvidence && process.platform !== 'win32' && (metadata.uid !== entry.uid || metadata.gid !== entry.gid || entry.uid !== 0 || (entry.mode & 0o077) !== 0)) ||
            await digestFile(canonical) !== entry.digest) {
          throw new ContractError(`failed database restore evidence ${name} does not match its forensic manifest`, EXIT.IDENTITY);
        }
      }
      const summary = new Map();
      for (const line of (await readFile(join(directory, 'restore-summary.txt'), 'utf8')).trim().split(/\r?\n/)) {
        const index = line.indexOf('=');
        if (index < 1 || summary.has(line.slice(0, index))) throw new ContractError('failed database restore summary is malformed', EXIT.IDENTITY);
        summary.set(line.slice(0, index), line.slice(index + 1));
      }
      const expected = {
        schema: 'booking.preprod-database-restore/v1', environment: 'preprod', project: state.project,
        operationId: state.operationId, fencingEpoch: String(binding.forensicFencingEpoch), sourceBackupDigest: binding.sourceBackupDigest,
        quarantineDatabase: 'booking_preprod_failed_op06', postRestoreDatabase: 'booking_preprod',
        migrationTableAbsent: 'true', legacyDataDigestMatch: 'true', legacySequenceDigestMatch: 'true', largeObjectDigestMatch: 'true',
      };
      if (summary.size !== Object.keys(expected).length || Object.entries(expected).some(([key, value]) => summary.get(key) !== value)) {
        throw new ContractError('failed database restore summary does not match the canonical recovery identity', EXIT.IDENTITY);
      }
      const frozenState = JSON.parse(await readFile(join(directory, 'deploy-state.json'), 'utf8'));
      if (frozenState.phase !== 'FAILED' || frozenState.operationId !== state.operationId ||
          frozenState.fencingEpoch !== binding.forensicFencingEpoch || frozenState.fencingEpoch >= state.fencingEpoch ||
          frozenState.generation !== binding.forensicStateGeneration || frozenState.approvalId !== binding.forensicApprovalId ||
          frozenState.candidate?.manifestDigest !== releaseIdentity.manifestDigest) {
        throw new ContractError('failed database restore evidence deployment state binding is invalid', EXIT.IDENTITY);
      }
      const sourceLines = (await readFile(join(directory, 'source-evidence-digests.txt'), 'utf8')).trim().split(/\r?\n/);
      const freezeManifestPath = '/volume1/happybooking/booking-preprod/.g4/forensics/g4.fc79097-op06-freeze-compare-20260910T1057Z/forensic-manifest.txt';
      const postExpandPath = '/volume1/happybooking/booking-preprod/.g4/forensics/g4.fc79097-op06-freeze-compare-20260910T1057Z/g4.fc79097c5756.06-post-expand.dump';
      const expectedSourceLines = [
        `${binding.freezeManifestDigest.slice(7)}  ${freezeManifestPath}`,
        `${binding.postExpandBackupDigest.slice(7)}  ${postExpandPath}`,
      ];
      if (canonicalJson(sourceLines) !== canonicalJson(expectedSourceLines) || await digestFile(freezeManifestPath) !== binding.freezeManifestDigest ||
          await digestFile(postExpandPath) !== binding.postExpandBackupDigest) {
        throw new ContractError('failed database restore source evidence is not bound to the frozen comparison', EXIT.IDENTITY);
      }
      const runDocker = async (argv, label) => {
        const currentTimeoutMs = typeof revalidateLease === 'function' ? revalidateLease().timeoutMs : timeoutMs;
        const result = await runner(docker, argv, { cwd: paths.releaseDirectory, env, timeoutMs: currentTimeoutMs });
        assertResult(result, EXIT.DATABASE);
        return result.stdout;
      };
      const running = (await runDocker(['ps', '--filter', `label=com.docker.compose.project=${state.project}`, '--format', '{{.Names}}'], 'preprod runtime'))
        .trim().split(/\r?\n/).filter(Boolean).sort();
      if (canonicalJson(running) !== canonicalJson(['booking-preprod-postgres-1', 'booking-preprod-redis-1'])) {
        throw new ContractError('preproduction writers are not frozen for database restore attestation', EXIT.DATABASE);
      }
      const admin = (sql, database = 'postgres') => runDocker(['exec', 'booking-preprod-postgres-1', 'psql', '-v', 'ON_ERROR_STOP=1',
        '-U', 'booking_preprod', '-d', database, '-Atc', sql], 'database attestation');
      const databases = (await admin("select datname||'|'||oid::text||'|'||datallowconn::text from pg_database where datname in ('booking_preprod','booking_preprod_failed_op06','booking_preprod_g4_op06_post_check','booking_preprod_g4_op06_old_check') order by datname"))
        .trim().split(/\r?\n/).filter(Boolean);
      const expectedDatabases = ['booking_preprod|17915|true', 'booking_preprod_failed_op06|16384|false',
        'booking_preprod_g4_op06_post_check|17914|true'];
      if (canonicalJson(databases) !== canonicalJson(expectedDatabases)) throw new ContractError('database restore identity set or connection policy drifted', EXIT.DATABASE);
      if ((await admin("select count(*) from pg_stat_activity where datname in ('booking_preprod','booking_preprod_failed_op06','booking_preprod_g4_op06_post_check') and pid<>pg_backend_pid()" )).trim() !== '0') {
        throw new ContractError('database restore attestation requires zero preproduction database sessions', EXIT.DATABASE);
      }
      if ((await admin("select (to_regclass('public.migrations') is null)::int", 'booking_preprod')).trim() !== '1') {
        throw new ContractError('restored database unexpectedly retains the migrations ledger', EXIT.DATABASE);
      }
      const expectedTables = await readFile(join(directory, 'live-after-table-digests.txt'), 'utf8');
      const tableLines = [];
      for (const line of expectedTables.trim().split(/\r?\n/)) {
        const [table] = line.split('|');
        if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new ContractError('forensic table identity is invalid', EXIT.IDENTITY);
        const columns = (await admin(`select string_agg(format('%I',column_name),',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='${table}'`, 'booking_preprod')).trim();
        if (!columns) throw new ContractError(`restored table ${table} has no canonical columns`, EXIT.DATABASE);
        const count = (await admin(`select count(*) from public."${table}"`, 'booking_preprod')).trim();
        const rows = await admin(`COPY (SELECT row_to_json(t)::text FROM (SELECT ${columns} FROM public."${table}") t) TO STDOUT`, 'booking_preprod');
        const sortedRows = rows.trim() ? rows.trim().split(/\r?\n/)
          .sort((left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))) : [];
        const digest = sha256(sortedRows.length ? `${sortedRows.join('\n')}\n` : '');
        tableLines.push(`${table}|${count}|${digest.slice(7)}`);
      }
      const liveTableEvidence = `${tableLines.join('\n')}\n`;
      if (liveTableEvidence !== expectedTables || sha256(liveTableEvidence) !== binding.liveTableEvidenceDigest) {
        throw new ContractError('restored live table evidence differs from the verified swap result', EXIT.DATABASE);
      }
      const expectedSequences = await readFile(join(directory, 'live-after-sequence-values.txt'), 'utf8');
      const sequenceLines = [];
      for (const line of expectedSequences.trim().split(/\r?\n/)) {
        const [sequence] = line.split('|');
        if (!/^[a-z_][a-z0-9_]*$/.test(sequence)) throw new ContractError('forensic sequence identity is invalid', EXIT.IDENTITY);
        const value = (await admin(`select last_value::text||'|'||is_called::text from public."${sequence}"`, 'booking_preprod')).trim();
        sequenceLines.push(`${sequence}|${value}`);
      }
      const liveSequenceEvidence = `${sequenceLines.join('\n')}\n`;
      if (liveSequenceEvidence !== expectedSequences || sha256(liveSequenceEvidence) !== binding.liveSequenceEvidenceDigest) {
        throw new ContractError('restored live sequence evidence differs from the verified swap result', EXIT.DATABASE);
      }
      const largeObjects = await admin("COPY (select loid::text||'|'||pageno::text||'|'||encode(data,'hex') from pg_largeobject order by loid,pageno) TO STDOUT", 'booking_preprod');
      if (sha256(largeObjects) !== binding.liveLargeObjectDigest ||
          (await readFile(join(directory, 'live-after-large-objects.sha256'), 'utf8')).trim() !== binding.liveLargeObjectDigest.slice(7)) {
        throw new ContractError('restored live large-object evidence differs from the verified swap result', EXIT.DATABASE);
      }
      return { forensicDirectory: directory, forensicManifestDigest: expectedManifestDigest,
        sourceBackupDigest: binding.sourceBackupDigest, restoreSummaryDigest: entries.get('restore-summary.txt').digest,
        runningContainers: running, databases, activeSessions: 0, migrationTableAbsent: true,
        liveTableEvidenceDigest: binding.liveTableEvidenceDigest, liveSequenceEvidenceDigest: binding.liveSequenceEvidenceDigest,
        liveLargeObjectDigest: binding.liveLargeObjectDigest };
    };
    const databaseArgv = ['exec', 'booking-preprod-postgres-1', 'psql', '--no-password', '--tuples-only', '--no-align', '--quiet',
      '--username', 'booking_preprod', '--dbname', 'booking_preprod', '--command',
      "SELECT (to_regclass('public.migrations') IS NULL)::int || '|' || current_database() || '|' || current_user;"];
    const verifyDatabase = (value) => {
      if (value.trim() !== '1|booking_preprod|booking_preprod') {
        throw new ContractError('restored preproduction database still exposes the migrations ledger or the wrong identity', EXIT.DATABASE);
      }
      return { database: 'booking_preprod', databaseUser: 'booking_preprod', migrationTableAbsent: true };
    };
    return guardPlan({ executable: docker, argv: databaseArgv, cwd: paths.releaseDirectory, env: trustedEnvironment.env,
      environmentBinding: trustedEnvironment.environmentBinding,
      artifactBinding: { recovery: { kind: 'database-restore-attestation', operationId: state.operationId,
        forensicDirectory: binding.forensicDirectory, forensicManifestDigest: binding.forensicManifestDigest,
        forensicStateGeneration: binding.forensicStateGeneration, forensicFencingEpoch: binding.forensicFencingEpoch,
        forensicApprovalId: binding.forensicApprovalId, sourceBackupDigest: binding.sourceBackupDigest,
        freezeManifestDigest: binding.freezeManifestDigest, postExpandBackupDigest: binding.postExpandBackupDigest,
        liveTableEvidenceDigest: binding.liveTableEvidenceDigest, liveSequenceEvidenceDigest: binding.liveSequenceEvidenceDigest,
        liveLargeObjectDigest: binding.liveLargeObjectDigest,
        databases: ['booking_preprod|17915|true', 'booking_preprod_failed_op06|16384|false', 'booking_preprod_g4_op06_post_check|17914|true'] } },
      preflightArtifacts: attestForensicRestore, verifyExecution: verifyDatabase,
      readback: { executable: docker, argv: databaseArgv, verify: verifyDatabase }, verifyArtifacts: attestForensicRestore });
  }
  if (spec.kind === 'compose-egress') {
    const preflightArtifacts = combineArtifactChecks(inspectComposeConfig, inspectImages(['telegram-egress']));
    return guardPlan({ executable: docker, argv: [...composePrefix, 'up', '--no-build', '--pull', 'never', '--no-deps', '--wait', 'telegram-egress'], cwd: paths.releaseDirectory,
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
  if (spec.kind === 'failed-active-runtime-restore') {
    const binding = runtime.legacyActiveRuntimeBinding || LEGACY_ACTIVE_RUNTIME_BINDING;
    if (state.operationId !== (runtime.failedRestoreBinding || FAILED_RESTORE_BINDING).operationId ||
        releaseIdentity.releaseId !== LEGACY_OLD_BINDING.releaseId || releaseIdentity.gitSha !== LEGACY_OLD_BINDING.gitSha ||
        releaseIdentity.manifestDigest !== LEGACY_OLD_BINDING.manifestRawDigest) {
      throw new ContractError('active runtime restore is not bound to the fixed failed operation and legacy identity', EXIT.IDENTITY);
    }
    const inspectArgv = ['container', 'inspect', binding.backend.id, binding.gateway.id];
    const verifyInspect = (value) => verifyLegacyActiveRuntimeInspect(value, state, binding, false);
    const predecessorCheck = ({ statePath, adoptionReceipt, recoveryPending }) =>
      verifyRestorePredecessors(statePath, state, adoptionReceipt, recoveryPending);
    const preflightCheck = (context) => verifyLegacyActiveRuntimePreflightArtifacts(
      context, state, paths, docker, runtime, binding, predecessorCheck,
    );
    const runtimeCheck = (context) => verifyLegacyActiveRuntimeArtifacts(context, state, paths, docker, runtime);
    return guardPlan({ executable: docker, argv: ['start', binding.backend.id, binding.gateway.id], cwd: paths.releaseDirectory,
      env: trustedEnvironment.env, environmentBinding: trustedEnvironment.environmentBinding,
      artifactBinding: { recovery: { kind: 'fixed-legacy-active-runtime-restore', operationId: state.operationId,
        backend: binding.backend, gateway: binding.gateway, nginx: binding.nginx, databaseOid: binding.databaseOid,
        bot: binding.bot, allowedMutation: 'docker-start-existing-container-ids-only', forbidden: ['compose', 'create', 'pull'] } },
      preflightArtifacts: preflightCheck, replayPreflightArtifacts: preflightCheck,
      verifyExecution: (value) => verifyLegacyDockerStartOutput(value, binding),
      readback: { executable: docker, argv: inspectArgv, verify: verifyInspect },
      verifyArtifacts: runtimeCheck, replayVerifyArtifacts: runtimeCheck });
  }
  if (spec.kind === 'release-probe') {
    const recoveredProbe = args.action === 'preprod-probe-recovered-active';
    const publicProbe = recoveredProbe || ['preprod-probe-observation', 'preprod-probe-rollback'].includes(args.action);
    const businessSmoke = args.action === 'preprod-probe-observation';
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
      if (businessSmoke) {
        const traceHex = sha256(`${state.operationId}:${args['action-id']}:${state.generation}:${state.fencingEpoch}`).slice(7);
        const expectedMarker = `g4_${traceHex.slice(0, 24)}`;
        const expectedUpdateId = Number(8_000_000_000_000_000n + (BigInt(`0x${traceHex.slice(24, 38)}`) % 100_000_000_000_000n));
        const fixture = parsed.fixture;
        const checks = parsed.checks;
        if (!hasExactObjectKeys(parsed, ['schema', 'status', 'origin', 'releaseId', 'gitSha', 'manifestDigest', 'slot', 'configSchema',
              'migrationFloor', 'migrationCatalogDigest', 'telegramBotMode', 'telegramWebhookEnabled', 'telegramWebhookUrl', 'fixture', 'checks']) ||
            !hasExactObjectKeys(fixture, ['marker', 'updateId', 'operationId', 'actionId', 'generation', 'fencingEpoch']) ||
            !hasExactObjectKeys(checks, ['publicIdentity', 'rootUi', 'sessionChain', 'shortLinks', 'database', 'telegramWidget', 'telegramLogin', 'telegramInbox']) ||
            !hasExactObjectKeys(checks?.publicIdentity, ['status']) || !hasExactObjectKeys(checks?.rootUi, ['statusCode', 'bodyDigest']) ||
            !hasExactObjectKeys(checks?.sessionChain, ['registered', 'loggedIn', 'rotated', 'authenticatedReadback', 'loggedOut', 'revokedReadback']) ||
            !hasExactObjectKeys(checks?.shortLinks, ['referral', 'share']) ||
            !hasExactObjectKeys(checks?.shortLinks?.referral, ['statusCode', 'location']) ||
            !hasExactObjectKeys(checks?.shortLinks?.share, ['statusCode', 'location']) ||
            !hasExactObjectKeys(checks?.database, ['database', 'databaseUser', 'writeReadback', 'sessionRows', 'revokedRows', 'fixtureOwnership', 'fixtureCleanup']) ||
            !hasExactObjectKeys(checks?.telegramWidget, ['origin', 'botUsername', 'transport', 'domainAccepted', 'embedInitialized']) ||
            !hasExactObjectKeys(checks?.telegramLogin, ['signatureAlgorithm', 'syntheticFixture', 'sessionCreated', 'authenticatedReadback',
              'databaseIdentityReadback', 'logoutConfirmed', 'revokedSessionRejected', 'databaseRevocationReadback', 'fixtureCleanup']) ||
            !hasExactObjectKeys(checks?.telegramInbox, ['deliveryStatusCodes', 'rowCount', 'processedCount', 'processedAtPresent', 'sideEffectOperations']) ||
            parsed.schema !== 'booking.preprod-business-smoke/v2' ||
            !fixture || fixture.marker !== expectedMarker || fixture.updateId !== expectedUpdateId ||
            fixture.operationId !== state.operationId || fixture.actionId !== args['action-id'] ||
            fixture.generation !== state.generation || fixture.fencingEpoch !== state.fencingEpoch ||
            checks?.publicIdentity?.status !== 'pass' || checks?.rootUi?.statusCode !== 200 || !DIGEST.test(checks?.rootUi?.bodyDigest || '') ||
            checks?.sessionChain?.registered !== true || checks?.sessionChain?.loggedIn !== true || checks?.sessionChain?.rotated !== true ||
            checks?.sessionChain?.authenticatedReadback !== true || checks?.sessionChain?.loggedOut !== true || checks?.sessionChain?.revokedReadback !== true ||
            checks?.shortLinks?.referral?.statusCode !== 302 || checks?.shortLinks?.referral?.location !== `/#/pages/login/register?ref=G4${expectedMarker.slice(3, 15).toUpperCase()}` ||
            checks?.shortLinks?.share?.statusCode !== 302 || checks?.shortLinks?.share?.location !== `/#/pages/booking/detail?slug=${expectedMarker}` ||
            checks?.database?.database !== 'booking_preprod' || checks?.database?.databaseUser !== 'booking_preprod' ||
            checks?.database?.writeReadback !== true || checks?.database?.sessionRows !== 2 || checks?.database?.revokedRows !== 2 ||
            checks?.database?.fixtureOwnership !== 'username-and-smoke-email' ||
            checks?.database?.fixtureCleanup !== 'deleted-and-read-back' ||
            checks?.telegramWidget?.origin !== 'https://booking-preprod.happybooking.uk' ||
            checks?.telegramWidget?.botUsername !== manifest.artifacts.gateway.telegramBotUsername ||
            checks?.telegramWidget?.transport !== 'tls-validated-no-redirect-no-cache' ||
            checks?.telegramWidget?.domainAccepted !== true || checks?.telegramWidget?.embedInitialized !== true ||
            checks?.telegramLogin?.signatureAlgorithm !== 'sha256-bot-token+hmac-sha256' ||
            checks?.telegramLogin?.syntheticFixture !== true || checks?.telegramLogin?.sessionCreated !== true ||
            checks?.telegramLogin?.authenticatedReadback !== true || checks?.telegramLogin?.databaseIdentityReadback !== true ||
            checks?.telegramLogin?.logoutConfirmed !== true || checks?.telegramLogin?.revokedSessionRejected !== true ||
            checks?.telegramLogin?.databaseRevocationReadback !== true || checks?.telegramLogin?.fixtureCleanup !== 'deleted-and-read-back' ||
            canonicalJson(checks?.telegramInbox?.deliveryStatusCodes) !== canonicalJson([200, 200]) ||
            checks?.telegramInbox?.rowCount !== 1 || checks?.telegramInbox?.processedCount !== 1 ||
            checks?.telegramInbox?.processedAtPresent !== true || checks?.telegramInbox?.sideEffectOperations !== 0) {
          throw new ContractError('observation business smoke receipt is incomplete', EXIT.READINESS);
        }
      }
      return parsed;
    };
    const probeArgs = [fileURLToPath(new URL(businessSmoke ? './probe-fenced-business.mjs' : (publicProbe ? './probe-fenced-public.mjs' : './probe-fenced-candidate.mjs'), import.meta.url)),
      ...(publicProbe ? [] : ['--base-url', `http://127.0.0.1:${port}`]),
      '--release-id', releaseIdentity.releaseId, '--git-sha', releaseIdentity.gitSha, '--manifest-digest', releaseIdentity.manifestDigest, '--slot', releaseIdentity.slot,
      ...(publicProbe && !exactLegacyCompose ? ['--config-schema', manifest.contracts.configSchema,
        '--migration-floor', manifest.contracts.migration.expandFloor,
        '--migration-catalog-digest', manifest.contracts.migration.catalogDigest,
        '--telegram-bot-mode', 'webhook', '--telegram-webhook-enabled', 'true',
        '--telegram-webhook-url', 'https://booking-preprod.happybooking.uk/telegram/webhook'] : []),
      ...(businessSmoke ? ['--operation-id', state.operationId, '--action-id', args['action-id'],
        '--generation', String(state.generation), '--fencing-epoch', String(state.fencingEpoch)] : [])];
    const probeRuntimeArtifacts = recoveredProbe
      ? ({ statePath }) => verifyRecoveredRuntimeHead(statePath, state)
      : (exactLegacyCompose ? null : combineArtifactChecks(inspectReleaseRuntime, inspectTelegramEgress));
    return guardPlan({ executable: process.execPath, argv: probeArgs, cwd: paths.releaseDirectory,
      env: trustedEnvironment.env, environmentBinding: trustedEnvironment.environmentBinding,
      artifactBinding: { probe: { slot: releaseIdentity.slot, ...(publicProbe ? { origin: 'https://booking-preprod.happybooking.uk',
        ...(!exactLegacyCompose ? { configSchema: manifest.contracts.configSchema, migrationFloor: manifest.contracts.migration.expandFloor,
          migrationCatalogDigest: manifest.contracts.migration.catalogDigest, telegramBotMode: 'webhook', telegramWebhookEnabled: true,
          telegramWebhookUrl: 'https://booking-preprod.happybooking.uk/telegram/webhook',
          ...(businessSmoke ? { businessSmokeContract: 'booking.preprod-business-smoke/v2' } : {}) } : {}) } : { port }),
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
    return guardPlan({ executable: docker, argv: [...composePrefix, 'up', '--no-build', '--pull', 'never', '--no-deps', '--wait', ...services], cwd: paths.releaseDirectory,
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
            routeContractDigest: imageEvidence.routeContract.digest, containerIds,
            gatewayConfigImage: `${artifacts.gateway.image}:${releaseIdentity.releaseId}` };
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
    const migrationArtifacts = async (context) => ({ ...(await backendImagePreflight(context)), compose: await inspectComposeConfig(context), dataPlane: await inspectDataPlane(context),
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
    const baselineArtifacts = async (context) => ({ ...(await backendImagePreflight(context)), compose: await inspectComposeConfig(context), dataPlane: await inspectDataPlane(context),
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
  const approvedIngressGatewayBinding = async (identity) => {
    const exactLegacy = identity.releaseId === LEGACY_OLD_BINDING.releaseId && identity.gitSha === LEGACY_OLD_BINDING.gitSha &&
      identity.manifestDigest === LEGACY_OLD_BINDING.manifestRawDigest && identity.slot === 'green';
    if (exactLegacy) return { containerId: LEGACY_ACTIVE_RUNTIME_BINDING.gateway.id,
      backendContainerId: LEGACY_ACTIVE_RUNTIME_BINDING.backend.id, imageId: LEGACY_ACTIVE_RUNTIME_BINDING.gateway.imageId,
      configImage: LEGACY_ACTIVE_RUNTIME_BINDING.gateway.image, configHash: LEGACY_ACTIVE_RUNTIME_BINDING.gateway.configHash };
    if (runtime.ingressApprovedBindings) {
      const fixture = runtime.ingressApprovedBindings[identity.releaseId];
      if (runtime.releaseManifest && runtime.releaseRoot && fixture) return fixture;
      if (fixture) throw new ContractError('injected ingress runtime binding is unavailable outside an isolated fixture', EXIT.IDENTITY);
    }
    if (!runtime.statePath) throw new ContractError('canonical deploy-state path is unavailable for ingress runtime binding', EXIT.IDENTITY);
    const stageDigest = state.evidence.stageReceiptDigest;
    if (!DIGEST.test(stageDigest || '')) throw new ContractError('ingress requires a canonical candidate stage receipt', EXIT.IDENTITY);
    const { receipt, acceptedReceipt } = await readCanonicalExecutorReceiptByDigest(runtime.statePath, stageDigest);
    const artifacts = receipt.verification?.artifacts;
    const binding = { containerId: artifacts?.containerIds?.gateway, backendContainerId: artifacts?.containerIds?.backend,
      imageId: artifacts?.gateway?.imageId, configImage: artifacts?.gatewayConfigImage, configHash: artifacts?.runtimeBindings?.gateway?.configHash };
    if (acceptedReceipt.receiptDigest !== stageDigest || receipt.action !== 'preprod-stage' || receipt.status !== 'pass' ||
        receipt.environment !== state.environment || receipt.project !== state.project || receipt.operationId !== state.operationId ||
        receipt.manifestDigest !== identity.manifestDigest || !sameReleaseIdentity(receipt.releaseIdentity, identity) ||
        receipt.runtimeEnvDigest !== state.runtimeEnvDigest || canonicalJson(receipt.resourceIds) !== canonicalJson([state.resources.edgeNetwork]) ||
        !DOCKER_CONTAINER_ID.test(binding.containerId || '') || !DOCKER_CONTAINER_ID.test(binding.backendContainerId || '') ||
        !DIGEST.test(binding.imageId || '') || typeof binding.configImage !== 'string' || !binding.configImage.endsWith(`:${identity.releaseId}`) ||
        !/^[0-9a-f]{64}$/.test(binding.configHash || '')) {
      throw new ContractError('canonical stage receipt does not contain an approved exact gateway runtime identity', EXIT.IDENTITY);
    }
    return binding;
  };
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
  const sourceIdentity = args.action === 'preprod-rollback-ingress' ? state.active : rollbackIdentity;
  const [sourceGatewayBinding, targetGatewayBinding] = await Promise.all([
    approvedIngressGatewayBinding(sourceIdentity), approvedIngressGatewayBinding(releaseIdentity),
  ]);
  const cycleBinding = { actionKind, actionId: args['action-id'], sequence, approvalId: state.approvalId,
    leaseId: state.lease.leaseId, holderId: state.lease.holderId, rollbackUpstream,
    rollbackReleaseId: rollbackIdentity.releaseId, rollbackManifestDigest: rollbackIdentity.manifestDigest };
  const mutationArgs = ['--execute', 'true', '--environment', state.environment, '--project', state.project, '--hostname', hostname,
    '--upstream', upstream, '--release', releaseIdentity.releaseId, '--manifest-digest', releaseIdentity.manifestDigest,
    '--operation-id', state.operationId, '--approval-id', state.approvalId, '--lease-id', state.lease.leaseId,
    '--holder-id', state.lease.holderId, '--action-kind', actionKind, '--action-id', args['action-id'], '--sequence', String(sequence),
    '--fencing-epoch', String(state.fencingEpoch), '--rollback-upstream', rollbackUpstream, '--rollback-release', rollbackIdentity.releaseId,
    '--rollback-manifest-digest', rollbackIdentity.manifestDigest,
    '--source-container-id', sourceGatewayBinding.containerId, '--source-backend-container-id', sourceGatewayBinding.backendContainerId,
    '--source-image-id', sourceGatewayBinding.imageId, '--source-config-image', sourceGatewayBinding.configImage,
    '--source-config-hash', sourceGatewayBinding.configHash,
    '--target-container-id', targetGatewayBinding.containerId, '--target-backend-container-id', targetGatewayBinding.backendContainerId,
    '--target-image-id', targetGatewayBinding.imageId, '--target-config-image', targetGatewayBinding.configImage,
    '--target-config-hash', targetGatewayBinding.configHash];
  const ingressRuntimeArtifacts = exactLegacyCompose ? null : combineArtifactChecks(inspectReleaseRuntime, inspectTelegramEgress);
  return guardPlan({ executable: helper, argv: mutationArgs, cwd: paths.releaseDirectory,
    env: trustedEnvironment.env, environmentBinding: trustedEnvironment.environmentBinding,
    artifactBinding: { ingress: { hostname, upstream, releaseId: releaseIdentity.releaseId, manifestDigest: releaseIdentity.manifestDigest,
      operationId: state.operationId, fencingEpoch: state.fencingEpoch, sourceGatewayBinding, targetGatewayBinding, ...cycleBinding } },
    ...(ingressRuntimeArtifacts ? { preflightArtifacts: ingressRuntimeArtifacts, verifyArtifacts: ingressRuntimeArtifacts,
      replayPreflightArtifacts: ingressRuntimeArtifacts, replayVerifyArtifacts: ingressRuntimeArtifacts } : {}),
    readback: { executable: helper, argv: ['--readback', '--project', state.project, '--hostname', hostname], verify: (value) => {
      let parsed; try { parsed = JSON.parse(value); } catch { throw new ContractError('ingress readback is not JSON', EXIT.INGRESS); }
      const expectedKeys = ['schema', 'project', 'hostname', 'edgeNetwork', 'logicalAlias', 'fixedRemoteService', 'aliasState', 'upstream', 'releaseId',
        'manifestDigest', 'operationId', 'approvalId', 'leaseId', 'holderId', 'actionKind', 'actionId', 'sequence', 'fencingEpoch', 'rollbackUpstream',
        'rollbackReleaseId', 'rollbackManifestDigest', 'sourceReleaseId', 'sourceManifestDigest', 'sourceUpstream', 'sourceContainerId',
        'sourceBackendContainerId', 'sourceImageId', 'sourceConfigImage', 'sourceConfigHash', 'targetContainerId', 'targetBackendContainerId',
        'targetImageId', 'targetConfigImage', 'targetConfigHash', 'cloudflaredContainerId', 'cloudflaredImageId', 'cloudflaredStartedAt', 'proofDigest', 'guard', 'observedAt'];
      const guard = parsed?.guard;
      if (!parsed || Object.keys(parsed).sort().join(',') !== [...expectedKeys].sort().join(',') || parsed.schema !== 'booking.ingress-readback/v3' ||
          parsed.project !== state.project || parsed.hostname !== hostname || parsed.upstream !== upstream || parsed.releaseId !== releaseIdentity.releaseId ||
          parsed.edgeNetwork !== state.resources.edgeNetwork || parsed.logicalAlias !== 'gateway-green' ||
          parsed.fixedRemoteService !== 'http://gateway-green:8080' || parsed.aliasState !== 'desired' ||
          parsed.manifestDigest !== releaseIdentity.manifestDigest || parsed.operationId !== state.operationId || parsed.fencingEpoch !== state.fencingEpoch ||
          parsed.approvalId !== cycleBinding.approvalId || parsed.leaseId !== cycleBinding.leaseId || parsed.holderId !== cycleBinding.holderId ||
          parsed.actionKind !== cycleBinding.actionKind || parsed.actionId !== cycleBinding.actionId || parsed.sequence !== cycleBinding.sequence ||
          parsed.rollbackUpstream !== cycleBinding.rollbackUpstream || parsed.rollbackReleaseId !== cycleBinding.rollbackReleaseId ||
          parsed.rollbackManifestDigest !== cycleBinding.rollbackManifestDigest || !DIGEST.test(parsed.proofDigest || '') ||
          parsed.sourceContainerId !== sourceGatewayBinding.containerId || parsed.sourceBackendContainerId !== sourceGatewayBinding.backendContainerId ||
          parsed.sourceImageId !== sourceGatewayBinding.imageId || parsed.sourceConfigImage !== sourceGatewayBinding.configImage || parsed.sourceConfigHash !== sourceGatewayBinding.configHash ||
          parsed.targetContainerId !== targetGatewayBinding.containerId || parsed.targetBackendContainerId !== targetGatewayBinding.backendContainerId ||
          parsed.targetImageId !== targetGatewayBinding.imageId || parsed.targetConfigImage !== targetGatewayBinding.configImage || parsed.targetConfigHash !== targetGatewayBinding.configHash ||
          !DIGEST.test(parsed.cloudflaredImageId || '') ||
          !/^[0-9a-f]{64}$/.test(parsed.cloudflaredContainerId || '') || !Number.isFinite(Date.parse(parsed.cloudflaredStartedAt)) ||
          !guard || Object.keys(guard).sort().join(',') !== ['mode', 'convergence', 'fencedResources', 'exactIdMutation', 'cloudflareMutationAllowed', 'publicProbeRequired'].sort().join(',') ||
          guard.mode !== 'local-docker-network-alias' || guard.convergence !== 'previous-desired-in-flight-readback' ||
          canonicalJson([...guard.fencedResources].sort()) !== canonicalJson(['booking-preprod-edge', 'ingress:booking-preprod'].sort()) || guard.exactIdMutation !== true ||
          guard.cloudflareMutationAllowed !== false || guard.publicProbeRequired !== true ||
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

function historicalRecoveryCommandDigest(plan, fencingEpoch) {
  if (!Number.isInteger(fencingEpoch) || fencingEpoch < 1) {
    throw new ContractError('historical recovery command identity cannot be reconstructed', EXIT.IDENTITY);
  }
  const hasRegistryBinding = plan.registrySupplyChainBinding !== null && plan.registrySupplyChainBinding !== undefined;
  const hasEnvironmentBinding = plan.environmentBinding !== null && plan.environmentBinding !== undefined;
  if (!hasRegistryBinding && !hasEnvironmentBinding) return commandIdentity(plan);
  if (!hasRegistryBinding || !hasEnvironmentBinding ||
      !plan.registrySupplyChainBinding || typeof plan.registrySupplyChainBinding !== 'object' ||
      Array.isArray(plan.registrySupplyChainBinding) ||
      !Number.isInteger(plan.registrySupplyChainBinding.fencingEpoch) ||
      !plan.environmentBinding || typeof plan.environmentBinding !== 'object' ||
      Array.isArray(plan.environmentBinding)) {
    throw new ContractError('historical recovery command identity cannot be reconstructed', EXIT.IDENTITY);
  }
  const currentRegistryDigest = sha256(plan.registrySupplyChainBinding);
  if (plan.environmentBinding.BOOKING_REGISTRY_SUPPLY_CHAIN_DIGEST !== currentRegistryDigest) {
    throw new ContractError('recovery command registry binding is internally inconsistent', EXIT.IDENTITY);
  }
  const registrySupplyChainBinding = { ...plan.registrySupplyChainBinding, fencingEpoch };
  return commandIdentity({ ...plan, registrySupplyChainBinding,
    environmentBinding: { ...plan.environmentBinding,
      BOOKING_REGISTRY_SUPPLY_CHAIN_DIGEST: sha256(registrySupplyChainBinding) } });
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
  const priorRequest = { schema: schemaForAction(args.action).request, environment: state.environment, project: state.project,
    action: args.action, actionId: pending.actionId, operationId: state.operationId, approvalId: pending.approvalId,
    generation: pending.generation, fencingEpoch: pending.fencingEpoch, leaseId: pending.leaseId, holderId: pending.holderId,
    manifestDigest: releaseIdentity.manifestDigest, releaseIdentity, resourceIds, runtimeEnvDigest: state.runtimeEnvDigest,
    commandDigest: commandIdentity(priorPlan) };
  if (priorRequest.commandDigest !== pending.commandDigest || sha256(priorRequest) !== pending.requestDigest) {
    throw new ContractError('prior pending ingress request digest does not match its immutable recovery identity', EXIT.INGRESS);
  }
  return { pending, priorPlan, priorRequest, recoveryArgv: [...priorArgv, '--recover-pending', 'true'] };
}

function verifyPriorPendingIngress(readback, state, args, releaseIdentity, resource, priorIdentity) {
  let observed;
  try { observed = JSON.parse(readback.stdout); } catch { throw new ContractError('prior pending ingress proof readback is not JSON', EXIT.INGRESS); }
  const pending = priorIdentity.pending;
  const rollback = state.rollback;
  const sequence = args.action === 'preprod-rollback-ingress' ? 2 : (state.rollbackRehearsalCompleted ? 3 : 1);
  if (!pending || args['action-id'] === pending.actionId || observed?.schema !== 'booking.ingress-readback/v3' ||
      observed.project !== state.project || observed.hostname !== 'booking-preprod.happybooking.uk' ||
      observed.upstream !== `gateway-${releaseIdentity.slot}:8080` || observed.releaseId !== releaseIdentity.releaseId ||
      observed.manifestDigest !== releaseIdentity.manifestDigest || observed.operationId !== state.operationId ||
      observed.fencingEpoch !== resource.highestAcceptedFencingEpoch || observed.actionKind !== args.action ||
      observed.actionId !== pending.actionId || observed.sequence !== sequence ||
      observed.rollbackUpstream !== `gateway-${rollback.slot}:8080` || observed.rollbackReleaseId !== rollback.releaseId ||
      observed.rollbackManifestDigest !== rollback.manifestDigest || observed.approvalId !== pending.approvalId ||
      observed.leaseId !== pending.leaseId || observed.holderId !== pending.holderId ||
      observed.edgeNetwork !== state.resources.edgeNetwork || observed.logicalAlias !== 'gateway-green' ||
      observed.fixedRemoteService !== 'http://gateway-green:8080' || observed.aliasState !== 'desired' ||
      !DIGEST.test(observed.proofDigest || '') || observed.guard?.mode !== 'local-docker-network-alias' ||
      observed.guard?.convergence !== 'previous-desired-in-flight-readback' ||
      canonicalJson([...(observed.guard?.fencedResources || [])].sort()) !== canonicalJson(['booking-preprod-edge', 'ingress:booking-preprod'].sort()) || observed.guard?.exactIdMutation !== true ||
      observed.guard?.cloudflareMutationAllowed !== false || observed.guard?.publicProbeRequired !== true) {
    throw new ContractError('prior pending ingress identity/action does not match the independently proven remote state', EXIT.INGRESS);
  }
  return observed;
}

const TAKEOVER_ADOPTABLE_ACTIONS = new Set([
  'preprod-stage', 'preprod-baseline-ledger', 'preprod-expand-migrate', 'preprod-prepare-telegram-egress',
  'preprod-transfer-singletons', 'preprod-rollback-singletons',
  'preprod-set-webhook', 'preprod-restore-active-runtime',
]);

const FAILED_RESTORE_BINDING = Object.freeze({
  operationId: 'g4.fc79097c5756.06',
  manifestDigest: 'sha256:dc23534a1d05706e073ffa4f0baf78cf069f90fa893d1c6d68559c4f970c3884',
  sourceBackupDigest: 'sha256:1e3a8ee51c80a62817cf160b452abcb655359503cdf0ef2daaa7ca501aa367a6',
  forensicDirectory: '/volume1/happybooking/booking-preprod/.g4/forensics/g4.fc79097-op06-database-swap-20260910T1101Z',
  forensicManifestDigest: 'sha256:045bd2c8b85a80e75385bc0ecdbe0b2f234f5042b37ac0f2db645c236eac2e66',
  forensicStateGeneration: 9,
  forensicFencingEpoch: 2,
  forensicApprovalId: 'approval.user.20260910.g4.recovery.r7',
  freezeManifestDigest: 'sha256:f59f3e825eea28b53119516013d9892b09ab83a3b5b68d4b8bc2a4867ccf0155',
  postExpandBackupDigest: 'sha256:022608ba1cdb44946c1369c9ffe190ce5b72f26bc3d2e4c2cac3dda8e9ae7043',
  liveTableEvidenceDigest: 'sha256:1c29effde2c6844dc53de730791c6eb3cf1a7310d1c54b6f18317ab2b00f048d',
  liveSequenceEvidenceDigest: 'sha256:97614048e19a080ed839f27b1ecbe9dbdd4eed06a30e5bec8a0e1afcac496504',
  liveLargeObjectDigest: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  priorTelegramFencingEpoch: 1,
  priorTelegramActionId: 'g4.fc79097c5756.06.egress.rehearsal.f1',
  priorTelegramFailureReceiptDigest: 'sha256:db40132b7eb61b372a291a0dbe285d8f35c38333a2b4d4d8b4a92185a68530a9',
});

export function telegramAbortDockerCommands(project) {
  if (project !== 'booking-preprod') throw new ContractError('Telegram abort project is not preproduction', EXIT.IDENTITY);
  const containerName = `${project}-telegram-egress-1`;
  return Object.freeze({
    containerName,
    // The request digest binds this placeholder procedure. Runtime execution
    // replaces it only with the twice-inspected immutable Docker container ID.
    mutationArgv: Object.freeze(['container', 'rm', '--force', '<verified-container-id>']),
    readbackArgv: Object.freeze(['ps', '-a', '--filter', `name=^/${containerName}$`, '--format', '{{.ID}}|{{.Names}}']),
  });
}

const LEGACY_ACTIVE_RUNTIME_BINDING = Object.freeze({
  backend: Object.freeze({
    id: '50dbe86316e2bdfe2b84727fe7407ef435eec3c91f3c764d605c7fc8a552d4fb',
    imageId: 'sha256:a1bebe8670c2dc5524c9cd3b0d91a3274d85365a6b252c3cdd9907c6b48695ee',
    image: 'booking-preprod-backend:booking-20260908T202714Z-317be4dec675',
    service: 'backend-green', configHash: 'beba82426cab283cdbaeac564dad4226c40d5a71b4910ef76f5e7eed407fa31d',
  }),
  gateway: Object.freeze({
    id: 'eb38bbd0b092d1cdc8c30e62faa400421d0764f5fc5f3997e3986f3a7b10800d',
    imageId: 'sha256:0a26e5415496cd1227d80833fa2a4bae5fdb41d558119ed2ec5d6df0b0fd5593',
    image: 'booking-preprod-gateway:booking-20260908T202714Z-317be4dec675',
    service: 'gateway-green', configHash: '67ca960d4f4dc4266ea8b003e22e26545a8f0418d3bad6e83a76be6bece8791e',
  }),
  cloudflared: Object.freeze({
    name: 'booking-preprod-cloudflared',
    imageId: 'sha256:c1d35f78a5f68601e349d12fed690bc5cb3a0d64d0d25dd7297d415aa399c179',
    image: 'cloudflare/cloudflared@sha256:6b599ca3e974349ead3286d178da61d291961182ec3fe9c505e1dd02c8ac31b0',
    user: '65532:65532',
    cmd: Object.freeze(['tunnel', '--no-autoupdate', '--token-file', '/run/secrets/tunnel-token', 'run']),
    tokenMount: Object.freeze({ type: 'bind', source: '/etc/happybooking/secrets/cloudflare-preprod-tunnel-token',
      destination: '/run/secrets/tunnel-token', rw: false, propagation: 'rprivate' }),
  }),
  nginx: Object.freeze({
    source: '/volume1/homes/realzyq/booking-preprod/releases/booking-20260908T202714Z-317be4dec675/source/frontend/nginx.preprod.conf',
    destination: '/etc/nginx/conf.d/default.conf', digest: 'sha256:ac038692b8ee7e826e057334554bbd006deec617f71750c54bdf94bfa496752a',
    mode: 0o644, uid: 0, gid: 0, size: 364,
  }),
  databaseOid: 17915,
  bot: Object.freeze({ id: 8711543100, username: 'HappyBookingPreprodBot' }),
});

async function readRecoveryResourceState(statePath, state, resourceId, allowPending = false, allowMissingVirgin = false) {
  let value;
  try { value = JSON.parse(await readFile(join(resourceDirectory(statePath, resourceId), 'resource-state.json'), 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT' && allowMissingVirgin) return { schema: 'booking.fenced-resource/v1',
      environment: state.environment, project: state.project, resourceId, highestAcceptedFencingEpoch: 0,
      operationId: null, manifestDigest: null, pendingAction: null, receiptChainHead: null, updatedAt: null, missingVirgin: true };
    throw new ContractError(`recovery predecessor state is unavailable for ${resourceId}`, EXIT.SINGLETON);
  }
  if (value?.schema !== 'booking.fenced-resource/v1' || value.environment !== state.environment || value.project !== state.project ||
      value.resourceId !== resourceId || !Number.isInteger(value.highestAcceptedFencingEpoch) ||
      value.highestAcceptedFencingEpoch > state.fencingEpoch || (!allowPending && value.pendingAction !== null) ||
      (value.receiptChainHead !== null && !DIGEST.test(value.receiptChainHead || ''))) {
    throw new ContractError(`recovery predecessor state is not closed for ${resourceId}`, EXIT.SINGLETON);
  }
  return value;
}

function assertRecoveryReceiptIdentity(receipt, state, expectedAction, expectedIdentity, expectedResources, expectedFence) {
  if (receipt?.schema !== schemaForAction(expectedAction).receipt || receipt.status !== 'pass' ||
      receipt.environment !== state.environment || receipt.project !== state.project || receipt.operationId !== state.operationId ||
      receipt.action !== expectedAction || receipt.fencingEpoch !== expectedFence || receipt.runtimeEnvDigest !== state.runtimeEnvDigest ||
      receipt.manifestDigest !== expectedIdentity.manifestDigest || canonicalJson(receipt.releaseIdentity) !== canonicalJson(expectedIdentity) ||
      canonicalJson(receipt.resourceIds) !== canonicalJson(expectedResources) || receipt.requestDigest !== sha256(receiptRequestBody(receipt))) {
    throw new ContractError(`${expectedAction} recovery predecessor receipt identity is invalid`, EXIT.IDENTITY);
  }
  return receipt;
}

async function verifyRestorePredecessors(statePath, state, adoptionReceipt = null, recoveryPending = null) {
  const databaseResources = [state.resources.databaseRef, state.resources.dataNetwork];
  const telegramResource = `telegram:${state.project}`;
  let databaseHead; let telegramHead; let expectedFence = null;
  if (adoptionReceipt) {
    assertRecoveryReceiptIdentity(adoptionReceipt, state, 'preprod-restore-active-runtime', state.active,
      [state.resources.edgeNetwork, state.resources.dataNetwork, state.resources.databaseRef, telegramResource, state.resources.ingressRef],
      adoptionReceipt.fencingEpoch);
    expectedFence = adoptionReceipt.fencingEpoch;
    const predecessors = new Map((adoptionReceipt.resources || []).map((resource) => [resource.resourceId, resource.previousReceiptDigest]));
    databaseHead = predecessors.get(state.resources.databaseRef);
    telegramHead = predecessors.get(telegramResource);
    if (!databaseHead || predecessors.get(state.resources.dataNetwork) !== databaseHead || !telegramHead) {
      throw new ContractError('active runtime restore receipt omits exact database or Telegram predecessors', EXIT.IDENTITY);
    }
  } else {
    const states = new Map();
    for (const resourceId of [...Object.values(state.resources), telegramResource]) {
      states.set(resourceId, await readRecoveryResourceState(statePath, state, resourceId, Boolean(recoveryPending),
        [state.resources.edgeNetwork, state.resources.ingressRef].includes(resourceId)));
    }
    const predecessorHead = async (resource, resourceId) => {
      if (resource.manifestDigest === state.active.manifestDigest && resource.receiptChainHead) {
        const candidate = await readCanonicalExecutorReceiptByDigest(statePath, resource.receiptChainHead);
        if (candidate.receipt.action === 'preprod-restore-active-runtime' && candidate.receipt.operationId === state.operationId) {
          const prior = candidate.receipt.resources?.find((item) => item.resourceId === resourceId)?.previousReceiptDigest;
          if (!prior) throw new ContractError('completed active restore omits a recovery predecessor', EXIT.IDENTITY);
          return prior;
        }
      }
      return resource.receiptChainHead;
    };
    databaseHead = await predecessorHead(states.get(state.resources.databaseRef), state.resources.databaseRef);
    const dataHead = await predecessorHead(states.get(state.resources.dataNetwork), state.resources.dataNetwork);
    telegramHead = await predecessorHead(states.get(telegramResource), telegramResource);
    if (!databaseHead || dataHead !== databaseHead || !telegramHead) {
      throw new ContractError('active runtime recovery requires closed database and Telegram receipt heads', EXIT.IDENTITY);
    }
  }
  const database = await readCanonicalExecutorReceiptByDigest(statePath, databaseHead);
  const telegram = await readCanonicalExecutorReceiptByDigest(statePath, telegramHead);
  if (database.acceptedReceipt.receiptDigest !== databaseHead || telegram.acceptedReceipt.receiptDigest !== telegramHead) {
    throw new ContractError('active runtime recovery predecessor is not the accepted canonical receipt', EXIT.IDENTITY);
  }
  const predecessorFence = database.receipt.fencingEpoch;
  if (!Number.isInteger(predecessorFence) || telegram.receipt.fencingEpoch !== predecessorFence || predecessorFence > state.fencingEpoch ||
      (expectedFence !== null && predecessorFence !== expectedFence)) {
    throw new ContractError('active runtime recovery predecessor fencing epochs are inconsistent', EXIT.SINGLETON);
  }
  assertRecoveryReceiptIdentity(database.receipt, state, 'preprod-attest-database-restore', state.candidate,
    databaseResources, predecessorFence);
  assertRecoveryReceiptIdentity(telegram.receipt, state, 'preprod-abort-telegram-egress', state.candidate,
    [telegramResource], predecessorFence);
  return { databaseRestoreReceiptDigest: databaseHead, telegramAbortReceiptDigest: telegramHead,
    predecessorFencingEpoch: predecessorFence };
}

async function verifyRecoveredRuntimeHead(statePath, state) {
  const resourceIds = [state.resources.edgeNetwork, state.resources.dataNetwork, state.resources.databaseRef,
    `telegram:${state.project}`, state.resources.ingressRef];
  const states = await Promise.all(resourceIds.map((resourceId) => readRecoveryResourceState(statePath, state, resourceId)));
  const heads = [...new Set(states.map((value) => value.receiptChainHead))];
  if (heads.length !== 1 || !heads[0] || states.some((value) => value.highestAcceptedFencingEpoch !== state.fencingEpoch ||
      value.operationId !== state.operationId || value.manifestDigest !== state.active.manifestDigest)) {
    throw new ContractError('recovered active runtime resources do not share the current fenced receipt head', EXIT.IDENTITY);
  }
  const canonical = await readCompletedExecutorReceiptByDigest(statePath, heads[0]);
  assertRecoveryReceiptIdentity(canonical.receipt, state, 'preprod-restore-active-runtime', state.active, resourceIds, state.fencingEpoch);
  await verifyRestorePredecessors(statePath, state, canonical.receipt);
  return { activeRuntimeRestoreReceiptDigest: canonical.acceptedReceipt.receiptDigest, fencingEpoch: state.fencingEpoch };
}

function verifyLegacyProbeOutput(stdout, identity, label) {
  const value = parseLastJson(stdout, `${label} did not emit JSON`, EXIT.READINESS);
  if (value.status !== 'pass' || value.releaseId !== identity.releaseId || value.gitSha !== identity.gitSha ||
      value.manifestDigest !== identity.manifestDigest || value.slot !== identity.slot) {
    throw new ContractError(`${label} identity mismatch`, EXIT.READINESS);
  }
  return value;
}

async function verifyLegacyNginxBinding(binding, runtime) {
  const canonical = await realpath(binding.nginx.source).catch(() => {
    throw new ContractError('fixed legacy Nginx bind source is unavailable', EXIT.IDENTITY);
  });
  const metadata = await stat(canonical);
  if (canonical !== binding.nginx.source || !metadata.isFile() || metadata.size !== binding.nginx.size ||
      (!runtime.allowNonRootEvidence && process.platform !== 'win32' &&
        (metadata.uid !== binding.nginx.uid || metadata.gid !== binding.nginx.gid || (metadata.mode & 0o777) !== binding.nginx.mode)) ||
      await digestFile(canonical) !== binding.nginx.digest) {
    throw new ContractError('fixed legacy Nginx bind source identity drifted', EXIT.IDENTITY);
  }
  return binding.nginx.digest;
}

function verifyLegacyDatabaseIdentity(value, binding) {
  const observed = value.trim();
  if (observed !== `booking_preprod|booking_preprod|${binding.databaseOid}|1`) {
    throw new ContractError('restored legacy database schema or OID drifted', EXIT.DATABASE);
  }
  return { name: 'booking_preprod', user: 'booking_preprod', oid: binding.databaseOid, migrationsTableAbsent: true };
}

export const LEGACY_SUPPORTING_INSPECT_FORMAT = '{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},"ConfigImage":{{json .Config.Image}},"User":{{json .Config.User}},"Labels":{{json .Config.Labels}},"PortBindings":{{json .HostConfig.PortBindings}},"ReadonlyRootfs":{{json .HostConfig.ReadonlyRootfs}},"Privileged":{{json .HostConfig.Privileged}},"CapDrop":{{json .HostConfig.CapDrop}},"SecurityOpt":{{json .HostConfig.SecurityOpt}},"Cmd":{{json .Config.Cmd}},"Mounts":{{json .Mounts}},"Networks":{{json .NetworkSettings.Networks}},"Running":{{json .State.Running}}}';

async function inspectLegacyNetworkTopology(run, state, binding, fixedContainers) {
  const networkStdout = await run(['network', 'inspect', state.resources.edgeNetwork, state.resources.dataNetwork]);
  let networks;
  try { networks = JSON.parse(networkStdout); }
  catch { throw new ContractError('fixed legacy network topology readback is not JSON', EXIT.IDENTITY); }
  const edgeNetwork = Array.isArray(networks) ? networks.find((network) => network?.Name === state.resources.edgeNetwork) : null;
  const dataNetwork = Array.isArray(networks) ? networks.find((network) => network?.Name === state.resources.dataNetwork) : null;
  const endpointIds = [
    { network: dataNetwork, name: 'booking-preprod-postgres-1' },
    { network: dataNetwork, name: 'booking-preprod-redis-1' },
    { network: edgeNetwork, name: binding.cloudflared.name },
  ].map(({ network, name }) => {
    const endpointEntries = network?.Containers && typeof network.Containers === 'object' && !Array.isArray(network.Containers)
      ? Object.entries(network.Containers) : [];
    const matches = endpointEntries.filter(([, endpoint]) => endpoint?.Name === name);
    if (matches.length !== 1 || !/^[0-9a-f]{64}$/.test(matches[0][0])) {
      throw new ContractError(`fixed legacy ${name} network endpoint identity drifted`, EXIT.IDENTITY);
    }
    return matches[0][0];
  });
  const supportingContainersStdout = await run(['container', 'inspect', '--format', LEGACY_SUPPORTING_INSPECT_FORMAT, ...endpointIds]);
  return verifyLegacyNetworkTopology(networkStdout, supportingContainersStdout, state, fixedContainers, binding);
}

async function verifyLegacyActiveRuntimePreflightArtifacts(context, state, paths, docker, runtime, binding, predecessorCheck) {
  const { runner, env, timeoutMs, revalidateLease } = context;
  const run = async (argv, exitCode = EXIT.IDENTITY) => {
    const currentTimeout = typeof revalidateLease === 'function' ? revalidateLease().timeoutMs : timeoutMs;
    const value = await runner(docker, argv, { cwd: paths.releaseDirectory, env, timeoutMs: currentTimeout });
    assertResult(value, exitCode);
    return value.stdout;
  };
  const predecessors = await predecessorCheck(context);
  const inspected = verifyLegacyActiveRuntimeInspect(
    await run(['container', 'inspect', binding.backend.id, binding.gateway.id]), state, binding, false, true,
  );
  const networkTopology = await inspectLegacyNetworkTopology(run, state, binding, inspected);
  const running = (await run(['ps', '--filter', `label=com.docker.compose.project=${state.project}`, '--format', '{{.Names}}'], EXIT.READINESS))
    .trim().split(/\r?\n/).filter(Boolean).sort();
  const expectedRunning = ['booking-preprod-postgres-1', 'booking-preprod-redis-1',
    ...(inspected.backend.running ? ['booking-preprod-backend-green-1'] : []),
    ...(inspected.gateway.running ? ['booking-preprod-gateway-green-1'] : []),
  ].sort();
  if (canonicalJson(running) !== canonicalJson(expectedRunning)) {
    throw new ContractError('unexpected preproduction project container is running before active restore', EXIT.SINGLETON);
  }
  const nginxBindDigest = await verifyLegacyNginxBinding(binding, runtime);
  const database = verifyLegacyDatabaseIdentity(await run(['exec', 'booking-preprod-postgres-1', 'psql', '--no-password',
    '--tuples-only', '--no-align', '--quiet', '--username', 'booking_preprod', '--dbname', 'booking_preprod', '--command',
    "SELECT current_database()||'|'||current_user||'|'||(SELECT oid::text FROM pg_database WHERE datname=current_database())||'|'||(to_regclass('public.migrations') IS NULL)::int;"], EXIT.DATABASE), binding);
  await assertLoopbackPortAvailable(18083, runtime);
  if (!inspected.gateway.running) await assertLoopbackPortAvailable(18082, runtime);
  return { predecessors, containers: inspected, networkTopology, runningContainers: running, nginxBindDigest, database,
    ports: { inactiveAvailable: '127.0.0.1:18083', active: inspected.gateway.running ? '127.0.0.1:18082' : 'available:127.0.0.1:18082' } };
}

async function verifyLegacyActiveRuntimeArtifacts({ runner, env, timeoutMs, statePath, revalidateLease, preflightEvidence },
  state, paths, docker, runtime) {
  const binding = runtime.legacyActiveRuntimeBinding || LEGACY_ACTIVE_RUNTIME_BINDING;
  const run = async (argv, exitCode = EXIT.IDENTITY) => {
    const currentTimeout = typeof revalidateLease === 'function' ? revalidateLease().timeoutMs : timeoutMs;
    const value = await runner(docker, argv, { cwd: paths.releaseDirectory, env, timeoutMs: currentTimeout });
    assertResult(value, exitCode);
    return value.stdout;
  };
  let inspected;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const stdout = await run(['container', 'inspect', binding.backend.id, binding.gateway.id], EXIT.READINESS);
    try { inspected = verifyLegacyActiveRuntimeInspect(stdout, state, binding, true); break; }
    catch (error) {
      if (attempt === 29 || !/health|identity or isolation/.test(error.message)) throw error;
      if (typeof revalidateLease === 'function') revalidateLease(1_500);
      await (runtime.recoveryDelay || delay)(1_000);
    }
  }
  const networkTopology = await inspectLegacyNetworkTopology(run, state, binding, inspected);
  const running = (await run(['ps', '--filter', `label=com.docker.compose.project=${state.project}`, '--format', '{{.Names}}'], EXIT.READINESS))
    .trim().split(/\r?\n/).filter(Boolean).sort();
  const expectedRunning = ['booking-preprod-backend-green-1', 'booking-preprod-gateway-green-1', 'booking-preprod-postgres-1', 'booking-preprod-redis-1'].sort();
  if (canonicalJson(running) !== canonicalJson(expectedRunning)) throw new ContractError('unexpected preproduction project container is running', EXIT.SINGLETON);
  await assertLoopbackPortAvailable(18083, runtime);
  await verifyLegacyNginxBinding(binding, runtime);
  const database = verifyLegacyDatabaseIdentity(await run(['exec', 'booking-preprod-postgres-1', 'psql', '--no-password', '--tuples-only', '--no-align', '--quiet',
    '--username', 'booking_preprod', '--dbname', 'booking_preprod', '--command',
    "SELECT current_database()||'|'||current_user||'|'||(SELECT oid::text FROM pg_database WHERE datname=current_database())||'|'||(to_regclass('public.migrations') IS NULL)::int;"], EXIT.DATABASE), binding);
  const localProbeArgs = [fileURLToPath(new URL('./probe-fenced-candidate.mjs', import.meta.url)), '--base-url', 'http://127.0.0.1:18082',
    '--release-id', state.active.releaseId, '--git-sha', state.active.gitSha, '--manifest-digest', state.active.manifestDigest, '--slot', state.active.slot];
  let probe = await runner(process.execPath, localProbeArgs, { cwd: paths.releaseDirectory, env, timeoutMs: typeof revalidateLease === 'function' ? revalidateLease().timeoutMs : timeoutMs });
  assertResult(probe, EXIT.READINESS);
  const local = verifyLegacyProbeOutput(probe.stdout, state.active, 'legacy local three-endpoint probe');
  const publicProbeArgs = [fileURLToPath(new URL('./probe-fenced-public.mjs', import.meta.url)),
    '--release-id', state.active.releaseId, '--git-sha', state.active.gitSha, '--manifest-digest', state.active.manifestDigest, '--slot', state.active.slot];
  probe = await runner(process.execPath, publicProbeArgs, { cwd: paths.releaseDirectory, env, timeoutMs: typeof revalidateLease === 'function' ? revalidateLease().timeoutMs : timeoutMs });
  assertResult(probe, EXIT.READINESS);
  const ingress = verifyLegacyProbeOutput(probe.stdout, state.active, 'legacy public ingress three-endpoint probe');
  const telegramScript = "const https=require('https');const token=process.env.TELEGRAM_BOT_TOKEN;if(!token)process.exit(41);const get=(m)=>new Promise((ok,no)=>https.get('https://api.telegram.org/bot'+token+'/'+m,r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{const x=JSON.parse(b);x.ok?ok(x.result):no(Error('api'));}catch(e){no(e)}})}).on('error',no));Promise.all([get('getMe'),get('getWebhookInfo')]).then(([m,w])=>{console.log(JSON.stringify({botId:m.id,botUsername:m.username,webhookUrl:w.url||''}))}).catch(()=>process.exit(42));";
  const telegramOutput = await run(['exec', binding.backend.id, 'node', '-e', telegramScript], EXIT.INGRESS);
  const telegram = parseLastJson(telegramOutput, 'legacy Telegram readback did not emit JSON', EXIT.INGRESS);
  if (telegram.botId !== binding.bot.id || String(telegram.botUsername || '').toLowerCase() !== binding.bot.username.toLowerCase() || telegram.webhookUrl !== '') {
    throw new ContractError('legacy Telegram bot identity or polling delivery state drifted', EXIT.INGRESS);
  }
  return { ...(preflightEvidence ? { predecessors: preflightEvidence } : {}), containers: inspected, networkTopology, runningContainers: running,
    nginxBindDigest: binding.nginx.digest, database,
    ports: { active: '127.0.0.1:18082', inactiveAvailable: '127.0.0.1:18083' }, localProbe: local, ingressProbe: ingress,
    telegram: { botId: telegram.botId, botUsername: telegram.botUsername, mode: 'polling', webhookUrl: '' } };
}

function receiptRequestBody(receipt) {
  return { schema: schemaForAction(receipt.action).request, environment: receipt.environment, project: receipt.project,
    action: receipt.action, actionId: receipt.actionId, operationId: receipt.operationId, approvalId: receipt.approvalId,
    generation: receipt.generation, fencingEpoch: receipt.fencingEpoch, leaseId: receipt.leaseId, holderId: receipt.holderId,
    manifestDigest: receipt.manifestDigest, releaseIdentity: receipt.releaseIdentity, resourceIds: receipt.resourceIds,
    runtimeEnvDigest: receipt.runtimeEnvDigest, commandDigest: receipt.commandDigest,
    ...(receipt.action === 'preprod-stage' ? { telegramEgressReceiptDigest: receipt.telegramEgressReceiptDigest } : {}) };
}

function assertFixedTelegramFailureReceipt(failed, state, releaseIdentity, binding, expectedResources) {
  const failureResource = failed?.resources?.[0];
  if (!failed || failed.receiptDigest !== binding.priorTelegramFailureReceiptDigest ||
      failed.schema !== schemaForAction('preprod-prepare-telegram-egress').receipt || failed.status !== 'fail' ||
      failed.environment !== state.environment || failed.project !== state.project || failed.operationId !== state.operationId ||
      failed.action !== 'preprod-prepare-telegram-egress' || failed.actionId !== binding.priorTelegramActionId ||
      failed.fencingEpoch !== binding.priorTelegramFencingEpoch || failed.manifestDigest !== releaseIdentity.manifestDigest ||
      failed.runtimeEnvDigest !== state.runtimeEnvDigest || !DIGEST.test(failed.commandDigest || '') ||
      canonicalJson(failed.releaseIdentity) !== canonicalJson(releaseIdentity) ||
      canonicalJson(failed.resourceIds) !== canonicalJson(expectedResources) ||
      failed.requestDigest !== sha256(receiptRequestBody(failed)) || failed.resources?.length !== 1 ||
      failureResource?.resourceId !== expectedResources[0] ||
      failureResource?.highestAcceptedFencingEpoch !== binding.priorTelegramFencingEpoch ||
      (failureResource.previousReceiptDigest !== null && !DIGEST.test(failureResource.previousReceiptDigest || ''))) {
    throw new ContractError('Telegram abort fixed prior failure receipt is invalid', EXIT.IDENTITY);
  }
  return failureResource.previousReceiptDigest;
}

function assertTelegramAbortReceipt(receipt, acceptedReceipt, state, releaseIdentity, binding, fixedFailure, expectedResourceId,
  expectedPreviousReceiptDigest, expectedCommandDigest, expectedPending = null) {
  const expectedPriorFailure = { action: 'preprod-prepare-telegram-egress', fencingEpoch: binding.priorTelegramFencingEpoch,
    receiptDigest: binding.priorTelegramFailureReceiptDigest, requestDigest: fixedFailure.requestDigest };
  const resource = receipt?.resources?.[0];
  if (!receipt || !acceptedReceipt ||
      receipt.schema !== schemaForAction('preprod-abort-telegram-egress').receipt || receipt.status !== 'pass' ||
      receipt.environment !== state.environment || receipt.project !== state.project || receipt.operationId !== state.operationId ||
      receipt.action !== 'preprod-abort-telegram-egress' || receipt.manifestDigest !== releaseIdentity.manifestDigest ||
      receipt.runtimeEnvDigest !== state.runtimeEnvDigest || receipt.commandDigest !== expectedCommandDigest ||
      canonicalJson(receipt.releaseIdentity) !== canonicalJson(releaseIdentity) ||
      canonicalJson(receipt.resourceIds) !== canonicalJson([expectedResourceId]) ||
      receipt.requestDigest !== sha256(receiptRequestBody(receipt)) || receipt.resources?.length !== 1 ||
      resource?.resourceId !== expectedResourceId || resource?.highestAcceptedFencingEpoch !== receipt.fencingEpoch ||
      resource?.previousReceiptDigest !== expectedPreviousReceiptDigest ||
      canonicalJson(receipt.verification?.priorFailure) !== canonicalJson(expectedPriorFailure) ||
      !DIGEST.test(receipt.executionOutputDigest || '') || !DIGEST.test(receipt.readbackOutputDigest || '') ||
      !Number.isInteger(receipt.fencingEpoch) || receipt.fencingEpoch <= binding.priorTelegramFencingEpoch) {
    throw new ContractError('Telegram abort prior receipt is not canonically bound to the failed operation', EXIT.IDENTITY);
  }
  if (expectedPending && (receipt.actionId !== expectedPending.actionId || receipt.approvalId !== expectedPending.approvalId ||
      receipt.leaseId !== expectedPending.leaseId || receipt.holderId !== expectedPending.holderId ||
      receipt.generation !== expectedPending.generation || receipt.fencingEpoch !== expectedPending.fencingEpoch ||
      receipt.commandDigest !== expectedPending.commandDigest || receipt.requestDigest !== expectedPending.requestDigest)) {
    throw new ContractError('Telegram abort prior receipt does not match its pending action', EXIT.IDENTITY);
  }
  return receipt;
}

async function assertTelegramAbortReceiptChain(statePath, head, baseHead, state, releaseIdentity, binding, fixedFailure,
  expectedResourceId, expectedCommandDigestForFence, maximumFencingEpoch) {
  let cursor = head;
  let upperFence = maximumFencingEpoch;
  const visited = new Set();
  let newest = null;
  while (cursor !== baseHead) {
    if (!cursor || visited.has(cursor)) throw new ContractError('Telegram abort receipt chain is incomplete or cyclic', EXIT.IDENTITY);
    visited.add(cursor);
    const canonical = await readCanonicalExecutorReceiptByDigest(statePath, cursor);
    if (canonical.acceptedReceipt.receiptDigest !== cursor) {
      throw new ContractError('Telegram abort receipt chain head is not the canonical accepted receipt', EXIT.IDENTITY);
    }
    const receipt = assertTelegramAbortReceipt(canonical.receipt, canonical.acceptedReceipt, state, releaseIdentity, binding, fixedFailure,
      expectedResourceId, canonical.receipt.resources?.[0]?.previousReceiptDigest,
      expectedCommandDigestForFence(canonical.receipt.fencingEpoch));
    if (receipt.fencingEpoch >= upperFence) throw new ContractError('Telegram abort receipt chain fencing epochs are not strictly increasing', EXIT.IDENTITY);
    if (!newest) newest = { ...canonical, receipt };
    upperFence = receipt.fencingEpoch;
    cursor = receipt.resources[0].previousReceiptDigest;
  }
  return newest;
}

function assertDatabaseAttestationReceipt(receipt, acceptedReceipt, state, releaseIdentity, resourceIds,
  expectedCommandDigest, expectedFencingEpoch, expectedPending = null, expectedPreviousByResource = null) {
  const expectedResourceIds = [...resourceIds];
  const observedResourceIds = [...(receipt?.resourceIds || [])];
  const receiptResources = receipt?.resources || [];
  const byResource = new Map(receiptResources.map((resource) => [resource?.resourceId, resource]));
  const predecessorHeads = new Set(receiptResources.map((resource) => resource?.previousReceiptDigest));
  if (!receipt || !acceptedReceipt || !DIGEST.test(acceptedReceipt.receiptDigest || '') ||
      receipt.schema !== schemaForAction('preprod-attest-database-restore').receipt || !['pass', 'fail'].includes(receipt.status) ||
      receipt.environment !== state.environment || receipt.project !== state.project || receipt.operationId !== state.operationId ||
      receipt.action !== 'preprod-attest-database-restore' || receipt.manifestDigest !== releaseIdentity.manifestDigest ||
      receipt.runtimeEnvDigest !== state.runtimeEnvDigest || receipt.commandDigest !== expectedCommandDigest ||
      receipt.fencingEpoch !== expectedFencingEpoch || canonicalJson(receipt.releaseIdentity) !== canonicalJson(releaseIdentity) ||
      canonicalJson(observedResourceIds) !== canonicalJson(expectedResourceIds) ||
      receipt.requestDigest !== sha256(receiptRequestBody(receipt)) || receiptResources.length !== resourceIds.length ||
      byResource.size !== resourceIds.length || predecessorHeads.size !== 1 || resourceIds.some((resourceId) => {
        const resource = byResource.get(resourceId);
        return !resource || resource.highestAcceptedFencingEpoch !== expectedFencingEpoch ||
          (resource.previousReceiptDigest !== null && !DIGEST.test(resource.previousReceiptDigest || '')) ||
          (expectedPreviousByResource && resource.previousReceiptDigest !== expectedPreviousByResource.get(resourceId));
      }) || !DIGEST.test(receipt.executionOutputDigest || '') || !DIGEST.test(receipt.readbackOutputDigest || '')) {
    throw new ContractError('database restore prior receipt is not canonically bound to the failed operation', EXIT.IDENTITY);
  }
  if (expectedPending && (receipt.actionId !== expectedPending.actionId || receipt.approvalId !== expectedPending.approvalId ||
      receipt.leaseId !== expectedPending.leaseId || receipt.holderId !== expectedPending.holderId ||
      receipt.generation !== expectedPending.generation || receipt.fencingEpoch !== expectedPending.fencingEpoch ||
      receipt.commandDigest !== expectedPending.commandDigest || receipt.requestDigest !== expectedPending.requestDigest)) {
    throw new ContractError('database restore prior receipt does not match its pending action', EXIT.IDENTITY);
  }
  return receipt;
}

async function verifyFixedDatabaseMigrationPredecessor(statePath, state, releaseIdentity, resourceIds, binding, observedHead) {
  const expandHead = state.evidence.expandMigrationReceiptDigest;
  const baselineHead = state.evidence.baselineReceiptDigest;
  if (!DIGEST.test(expandHead || '') || !DIGEST.test(baselineHead || '') || observedHead !== expandHead) {
    throw new ContractError('database restore fixed predecessor does not match the rooted migration evidence', EXIT.IDENTITY);
  }
  const verifyReceipt = async (head, action, previousReceiptDigest) => {
    const canonical = await readCanonicalExecutorReceiptByDigest(statePath, head);
    const receipt = canonical.receipt;
    const resources = Array.isArray(receipt?.resources) ? receipt.resources : [];
    const byResource = new Map(resources.map((resource) => [resource?.resourceId, resource]));
    if (canonical.acceptedReceipt.receiptDigest !== head || receipt?.schema !== schemaForAction(action).receipt ||
        receipt.status !== 'pass' || receipt.environment !== state.environment || receipt.project !== state.project ||
        receipt.operationId !== state.operationId || receipt.action !== action || receipt.runtimeEnvDigest !== state.runtimeEnvDigest ||
        receipt.manifestDigest !== releaseIdentity.manifestDigest || canonicalJson(receipt.releaseIdentity) !== canonicalJson(releaseIdentity) ||
        canonicalJson(receipt.resourceIds) !== canonicalJson(resourceIds) || receipt.requestDigest !== sha256(receiptRequestBody(receipt)) ||
        !Number.isInteger(receipt.fencingEpoch) || receipt.fencingEpoch < 1 || receipt.fencingEpoch > binding.forensicFencingEpoch ||
        resources.length !== resourceIds.length || byResource.size !== resourceIds.length || resourceIds.some((resourceId) => {
          const resource = byResource.get(resourceId);
          return !resource || resource.highestAcceptedFencingEpoch !== receipt.fencingEpoch ||
            resource.previousReceiptDigest !== previousReceiptDigest;
        })) {
      throw new ContractError(`database restore fixed ${action} receipt identity is invalid`, EXIT.IDENTITY);
    }
    return receipt;
  };
  await verifyReceipt(baselineHead, 'preprod-baseline-ledger', null);
  await verifyReceipt(expandHead, 'preprod-expand-migrate', baselineHead);
  return expandHead;
}

async function prepareFailedDatabaseAttestationContinuity({ statePath, state, args, releaseIdentity, resourceIds,
  locks, requestBody, requestDigest, binding, revalidateLease, commandDigestForFence }) {
  const resources = [];
  for (const lock of locks) resources.push(await inspectLockedResourceState(lock, {
    environment: state.environment, project: state.project, resourceId: lock.resourceId,
  }));
  if (resources.some((resource) => resource.operationId !== state.operationId ||
      resource.manifestDigest !== releaseIdentity.manifestDigest || resource.highestAcceptedFencingEpoch > state.fencingEpoch)) {
    throw new ContractError('database restore resource identity is not continuous with the failed operation', EXIT.IDENTITY);
  }
  const epochs = new Set(resources.map((resource) => resource.highestAcceptedFencingEpoch));
  if (epochs.size !== 1) throw new ContractError('database restore resources do not share one accepted fencing epoch', EXIT.SINGLETON);
  if (resources.some((resource) => resource.receiptChainHead !== resources[0].receiptChainHead)) {
    throw new ContractError('database restore resources do not share one receipt-chain predecessor', EXIT.IDENTITY);
  }
  const resourceEpoch = resources[0].highestAcceptedFencingEpoch;
  const allPending = resources.every((resource) => resource.pendingAction !== null);
  const allCompleted = resources.every((resource) => resource.pendingAction === null);
  if (!allPending && !allCompleted) {
    throw new ContractError('database restore resources disagree on prior action completion', EXIT.SINGLETON);
  }
  if (resourceEpoch === state.fencingEpoch) {
    if (allCompleted) {
      return { accepted: null, verification: null };
    }
    const pending = resources[0].pendingAction;
    if (resources.some((resource) => canonicalJson(resource.pendingAction) !== canonicalJson(pending)) ||
        pending.action !== args.action || pending.actionId !== args['action-id'] || pending.requestDigest !== requestDigest ||
        pending.approvalId !== state.approvalId || pending.leaseId !== state.lease.leaseId ||
        pending.holderId !== state.lease.holderId || pending.generation !== state.generation ||
        pending.fencingEpoch !== state.fencingEpoch || pending.commandDigest !== requestBody.commandDigest) {
      throw new ContractError('database restore current pending resources do not match the requested action', EXIT.IDENTITY);
    }
    return { accepted: resources, verification: { mode: 'current-pending-resumed',
      priorFencingEpoch: state.fencingEpoch, priorReceiptDigest: null } };
  }

  const nextBinding = (resourceId, now) => ({
    environment: state.environment, project: state.project, resourceId, fencingEpoch: state.fencingEpoch,
    operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest,
    action: args.action, actionId: args['action-id'], requestDigest, approvalId: state.approvalId,
    leaseId: state.lease.leaseId, holderId: state.lease.holderId, generation: state.generation,
    commandDigest: requestBody.commandDigest, now,
  });
  let mode;
  let priorReceiptDigest = null;

  if (resourceEpoch <= binding.forensicFencingEpoch) {
    if (!allCompleted || !DIGEST.test(resources[0].receiptChainHead || '')) {
      throw new ContractError('database restore fixed-evidence predecessor resources are inconsistent', EXIT.IDENTITY);
    }
    priorReceiptDigest = await verifyFixedDatabaseMigrationPredecessor(
      statePath, state, releaseIdentity, resourceIds, binding, resources[0].receiptChainHead,
    );
    mode = 'fixed-evidence-predecessor';
  } else if (allCompleted) {
    const head = resources[0].receiptChainHead;
    if (!DIGEST.test(head || '')) {
      throw new ContractError('database restore completed prior fence has inconsistent receipt-chain heads', EXIT.IDENTITY);
    }
    const canonical = await readCanonicalExecutorReceiptByDigest(statePath, head);
    assertDatabaseAttestationReceipt(canonical.receipt, canonical.acceptedReceipt, state, releaseIdentity, resourceIds,
      commandDigestForFence(resourceEpoch), resourceEpoch);
    if (canonical.receipt.status !== 'pass') {
      throw new ContractError('database restore completed prior fence is not backed by a pass receipt', EXIT.IDENTITY);
    }
    priorReceiptDigest = canonical.acceptedReceipt.receiptDigest;
    mode = 'prior-completed-re-attested';
  } else {
    const pending = resources[0].pendingAction;
    if (resources.some((resource) => canonicalJson(resource.pendingAction) !== canonicalJson(pending)) ||
        pending.action !== args.action || pending.fencingEpoch !== resourceEpoch ||
        pending.commandDigest !== commandDigestForFence(resourceEpoch)) {
      throw new ContractError('database restore prior pending resources do not share one immutable action identity', EXIT.IDENTITY);
    }
    const priorRequest = { schema: schemaForAction(args.action).request, environment: state.environment, project: state.project,
      action: args.action, actionId: pending.actionId, operationId: state.operationId, approvalId: pending.approvalId,
      generation: pending.generation, fencingEpoch: pending.fencingEpoch, leaseId: pending.leaseId, holderId: pending.holderId,
      manifestDigest: releaseIdentity.manifestDigest, releaseIdentity, resourceIds,
      runtimeEnvDigest: state.runtimeEnvDigest, commandDigest: pending.commandDigest };
    if (pending.requestDigest !== sha256(priorRequest)) {
      throw new ContractError('database restore prior pending request identity is invalid', EXIT.IDENTITY);
    }
    const previousByResource = new Map(resources.map((resource) => [resource.resourceId, resource.receiptChainHead]));
    const recorded = await readExecutorReceipt(statePath, resourceEpoch, args.action, pending.actionId);
    if (recorded) {
      const canonical = await readCanonicalExecutorReceiptByDigest(statePath, recorded.receiptDigest);
      if (canonicalJson(canonical.receipt) !== canonicalJson(recorded)) {
        throw new ContractError('database restore prior pending receipt is not canonical', EXIT.IDENTITY);
      }
      assertDatabaseAttestationReceipt(recorded, canonical.acceptedReceipt, state, releaseIdentity, resourceIds,
        commandDigestForFence(resourceEpoch), resourceEpoch, pending, previousByResource);
      if (recorded.status === 'pass') {
        for (let index = 0; index < locks.length; index += 1) {
          const mutationAt = revalidateLease().observedAt;
          await adoptPriorEpochPendingAction(locks[index], {
            fencingEpoch: resourceEpoch, pendingAction: structuredClone(resources[index].pendingAction),
            receiptChainHead: resources[index].receiptChainHead,
          }, { environment: state.environment, project: state.project, resourceId: resources[index].resourceId,
            fencingEpoch: state.fencingEpoch, operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest,
            now: mutationAt.toISOString() }, recorded.receiptDigest);
        }
        priorReceiptDigest = recorded.receiptDigest;
        mode = 'prior-pending-pass-adopted';
      } else {
        mode = 'prior-pending-fail-superseded';
      }
    } else {
      mode = 'prior-pending-without-receipt-superseded';
    }
    if (mode !== 'prior-pending-pass-adopted') {
      for (let index = 0; index < locks.length; index += 1) {
        const mutationAt = revalidateLease().observedAt;
        await supersedePriorEpochPendingAction(locks[index], {
          fencingEpoch: resourceEpoch, pendingAction: structuredClone(resources[index].pendingAction),
          receiptChainHead: resources[index].receiptChainHead,
        }, nextBinding(resources[index].resourceId, mutationAt.toISOString()));
      }
      const accepted = [];
      for (const lock of locks) accepted.push(await inspectLockedResourceState(lock, {
        environment: state.environment, project: state.project, resourceId: lock.resourceId,
      }));
      return { accepted, verification: { mode, priorFencingEpoch: resourceEpoch, priorReceiptDigest } };
    }
  }

  const accepted = [];
  for (const lock of locks) {
    const mutationAt = revalidateLease().observedAt;
    accepted.push(await acceptResourceEpoch(lock, nextBinding(lock.resourceId, mutationAt.toISOString())));
  }
  return { accepted, verification: { mode, priorFencingEpoch: resourceEpoch, priorReceiptDigest } };
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
  if (acceptedReceipt.receiptDigest !== head || receipt.schema !== schemaForAction(receipt.action).receipt || receipt.status !== 'pass' ||
      receipt.environment !== state.environment || receipt.project !== state.project || receipt.fencingEpoch >= state.fencingEpoch ||
      receipt.actionId === args['action-id'] || receipt.runtimeEnvDigest !== state.runtimeEnvDigest ||
      canonicalJson(receipt.releaseIdentity) !== canonicalJson(releaseIdentity) ||
      canonicalJson(observedResources) !== canonicalJson(expectedResources) || receipt.requestDigest !== sha256(receiptRequestBody(receipt))) {
    throw new ContractError('prior-fence action receipt does not match the canonical adoption identity', EXIT.SINGLETON);
  }
  return { receipt, acceptedReceipt };
}

async function recoverPriorActionByDesiredReadback({ statePath, state, args, releaseIdentity, resourceIds,
  resourceStates, locks, requestBody, requestDigest, plan, runner, runtime, revalidateLease }) {
  if (!TAKEOVER_ADOPTABLE_ACTIONS.has(args.action) || state.fencingEpoch < 2 || resourceStates.length !== locks.length) return null;
  if (resourceStates.some((resource) => resource.highestAcceptedFencingEpoch > state.fencingEpoch ||
      resource.operationId !== state.operationId || resource.manifestDigest !== releaseIdentity.manifestDigest)) return null;
  const pendingStates = resourceStates.filter((resource) => resource.pendingAction !== null);
  if (pendingStates.length === 0) return null;
  const currentPending = pendingStates.filter((resource) => resource.highestAcceptedFencingEpoch === state.fencingEpoch);
  const priorPending = pendingStates.filter((resource) => resource.highestAcceptedFencingEpoch < state.fencingEpoch);
  if (currentPending.some((resource) => {
    const pending = resource.pendingAction;
    return pending.fencingEpoch !== state.fencingEpoch || pending.action !== args.action || pending.actionId !== args['action-id'] ||
      pending.requestDigest !== requestDigest || pending.commandDigest !== requestBody.commandDigest ||
      pending.approvalId !== state.approvalId || pending.leaseId !== state.lease.leaseId ||
      pending.holderId !== state.lease.holderId || pending.generation !== state.generation;
  })) {
    throw new ContractError('current-fence partial accept has conflicting pending identity', EXIT.SINGLETON);
  }
  const priorIdentities = new Set(priorPending.map((resource) => canonicalJson(resource.pendingAction)));
  if (priorIdentities.size > 1 || priorPending.some((resource) => resource.pendingAction.action !== args.action ||
      resource.pendingAction.fencingEpoch !== resource.highestAcceptedFencingEpoch ||
      resource.pendingAction.commandDigest !== requestBody.commandDigest)) {
    throw new ContractError('prior-fence partial action has conflicting pending identities', EXIT.SINGLETON);
  }
  for (const resource of priorPending) {
    const prior = resource.pendingAction;
    const priorRequest = { schema: schemaForAction(args.action).request, environment: state.environment, project: state.project,
      action: args.action, actionId: prior.actionId, operationId: state.operationId, approvalId: prior.approvalId,
      generation: prior.generation, fencingEpoch: prior.fencingEpoch, leaseId: prior.leaseId, holderId: prior.holderId,
      manifestDigest: releaseIdentity.manifestDigest, releaseIdentity, resourceIds,
      runtimeEnvDigest: state.runtimeEnvDigest, commandDigest: prior.commandDigest,
      ...(args.action === 'preprod-stage' ? { telegramEgressReceiptDigest: requestBody.telegramEgressReceiptDigest } : {}) };
    if (prior.requestDigest !== sha256(priorRequest)) {
      throw new ContractError('prior-fence partial action request digest is invalid', EXIT.IDENTITY);
    }
  }
  const pending = priorPending[0]?.pendingAction || currentPending[0]?.pendingAction;
  const recorded = priorPending.length > 0
    ? await readExecutorReceipt(statePath, pending.fencingEpoch, args.action, pending.actionId)
    : null;
  const receiptMode = recorded?.status || 'missing';
  if (recorded) {
    const canonical = await readCanonicalExecutorReceiptByDigest(statePath, recorded.receiptDigest);
    if (canonicalJson(canonical.receipt) !== canonicalJson(recorded) || recorded.operationId !== state.operationId ||
        recorded.fencingEpoch !== pending.fencingEpoch || recorded.requestDigest !== pending.requestDigest ||
        recorded.commandDigest !== pending.commandDigest || canonicalJson(recorded.releaseIdentity) !== canonicalJson(releaseIdentity) ||
        canonicalJson([...recorded.resourceIds].sort()) !== canonicalJson([...resourceIds].sort())) {
      throw new ContractError('prior-fence partial action receipt identity is invalid', EXIT.IDENTITY);
    }
  }
  const completedStates = resourceStates.filter((resource) => resource.pendingAction === null);
  const completedReceipts = [];
  for (const resource of completedStates) {
    if (!resource.receiptChainHead) throw new ContractError('prior-fence partial completion has no receipt-chain head', EXIT.SINGLETON);
    const canonical = await readCanonicalExecutorReceiptByDigest(statePath, resource.receiptChainHead);
    const receipt = canonical.receipt;
    if (canonical.acceptedReceipt.receiptDigest !== resource.receiptChainHead || receipt.status !== 'pass' ||
        receipt.action !== args.action || receipt.operationId !== state.operationId ||
        receipt.manifestDigest !== releaseIdentity.manifestDigest || receipt.fencingEpoch !== resource.highestAcceptedFencingEpoch ||
        canonicalJson([...receipt.resourceIds].sort()) !== canonicalJson([...resourceIds].sort())) {
      throw new ContractError('prior-fence partial completion has no canonical pass receipt', EXIT.SINGLETON);
    }
    completedReceipts.push(canonical);
  }
  let replay;
  try {
    replay = await verifyCurrentExternalState(plan, { runner, env: plan.env || runtime.env || process.env,
      revalidateLease, statePath, adoptionReceipt: recorded || completedReceipts[0]?.receipt });
  } catch {
    throw new ContractError(`prior-fence ${receiptMode} action is not exact desired state; recovery is ambiguous`, EXIT.SINGLETON);
  }
  if (!runtime.planBuilder) await inspectTrustedRuntimeEnvironment(state, runtime);
  const completedAt = (await passRegistryGate(plan, revalidateLease)).observedAt;
  const receiptBody = { ...requestBody, schema: schemaForAction(args.action).receipt, requestDigest,
    startedAt: completedAt.toISOString(), completedAt: completedAt.toISOString(), status: 'pass',
    executionOutputDigest: sha256(''), readbackOutputDigest: replay.readbackOutputDigest,
    verification: { ...replay.verification, adoption: { mode: 'prior-partial-proven-applied-read-only',
      priorReceiptMode: receiptMode, priorFencingEpoch: Math.min(...pendingStates.map((resource) => resource.pendingAction.fencingEpoch)),
      priorRequestDigest: pending.requestDigest,
      priorReceiptDigest: recorded?.receiptDigest || null } },
    resources: resourceStates.map((resource) => ({ resourceId: resource.resourceId,
      highestAcceptedFencingEpoch: state.fencingEpoch, previousReceiptDigest: resource.receiptChainHead })) };
  const receipt = { ...receiptBody, receiptDigest: sha256(receiptBody) };
  revalidateLease();
  await writeExecutorReceipt(statePath, receipt);
  for (let index = 0; index < locks.length; index += 1) {
    const resource = resourceStates[index];
    const lock = locks[index];
    const mutationAt = revalidateLease().observedAt.toISOString();
    if (resource.pendingAction && resource.highestAcceptedFencingEpoch < state.fencingEpoch) {
      await adoptPriorEpochPendingAction(lock, { fencingEpoch: resource.highestAcceptedFencingEpoch,
        pendingAction: structuredClone(resource.pendingAction), receiptChainHead: resource.receiptChainHead }, {
        environment: state.environment, project: state.project, resourceId: resource.resourceId,
        fencingEpoch: state.fencingEpoch, operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest,
        now: mutationAt,
      }, receipt.receiptDigest);
    } else if (resource.pendingAction) {
      await completeResourceAction(lock, { environment: state.environment, project: state.project, resourceId: resource.resourceId,
        fencingEpoch: state.fencingEpoch, operationId: state.operationId, actionId: args['action-id'], requestDigest,
        now: mutationAt }, receipt.receiptDigest);
    } else {
      await acceptResourceEpoch(lock, { environment: state.environment, project: state.project, resourceId: resource.resourceId,
        fencingEpoch: state.fencingEpoch, operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest,
        action: args.action, actionId: args['action-id'], requestDigest, approvalId: state.approvalId,
        leaseId: state.lease.leaseId, holderId: state.lease.holderId, generation: state.generation,
        commandDigest: requestBody.commandDigest, now: mutationAt });
      await completeResourceAction(lock, { environment: state.environment, project: state.project, resourceId: resource.resourceId,
        fencingEpoch: state.fencingEpoch, operationId: state.operationId, actionId: args['action-id'], requestDigest,
        now: revalidateLease().observedAt.toISOString() }, receipt.receiptDigest);
    }
  }
  const currentGroupBinding = { environment: state.environment, project: state.project, operationId: state.operationId,
    generation: state.generation, fencingEpoch: state.fencingEpoch, action: args.action, actionId: args['action-id'], requestDigest,
    manifestDigest: releaseIdentity.manifestDigest, approvalId: state.approvalId, leaseId: state.lease.leaseId,
    holderId: state.lease.holderId, commandDigest: requestBody.commandDigest, now: revalidateLease().observedAt.toISOString() };
  await finalizeRecoveredResourceActionGroup(statePath, locks, currentGroupBinding, receipt.receiptDigest);
  return receipt;
}

async function prepareRetryableProbeContinuity({ statePath, state, args, releaseIdentity, resourceIds, locks,
  requestBody, requestDigest, priorReceipt, revalidateLease }) {
  if (!RETRYABLE_READ_ONLY_PROBES.has(args.action)) return null;
  if (locks.length !== 1 || resourceIds.length !== 1) {
    throw new ContractError('read-only probe recovery requires exactly one fenced resource', EXIT.SINGLETON);
  }
  const resource = await inspectLockedResourceState(locks[0], {
    environment: state.environment, project: state.project, resourceId: resourceIds[0],
  }).catch((error) => {
    if (/has no fencing state/.test(error?.message || '')) return null;
    throw error;
  });
  if (!resource || resource.pendingAction === null) return null;
  const pending = resource.pendingAction;
  const priorRequest = {
    schema: schemaForAction(args.action).request, environment: state.environment, project: state.project,
    action: args.action, actionId: pending.actionId, operationId: state.operationId, approvalId: pending.approvalId,
    generation: pending.generation, fencingEpoch: pending.fencingEpoch, leaseId: pending.leaseId, holderId: pending.holderId,
    manifestDigest: releaseIdentity.manifestDigest, releaseIdentity, resourceIds,
    runtimeEnvDigest: state.runtimeEnvDigest, commandDigest: pending.commandDigest,
  };
  const currentFence = pending.fencingEpoch === state.fencingEpoch;
  const currentPending = currentFence && pending.actionId === args['action-id'] && pending.requestDigest === requestDigest &&
    pending.approvalId === state.approvalId && pending.leaseId === state.lease.leaseId &&
    pending.holderId === state.lease.holderId && pending.generation === state.generation;
  if (resource.highestAcceptedFencingEpoch !== pending.fencingEpoch || pending.fencingEpoch > state.fencingEpoch ||
      resource.operationId !== state.operationId || resource.manifestDigest !== releaseIdentity.manifestDigest ||
      pending.action !== args.action || pending.commandDigest !== requestBody.commandDigest ||
      pending.requestDigest !== sha256(priorRequest) || (currentFence && !currentPending)) {
    throw new ContractError('read-only probe pending action identity is inconsistent', EXIT.IDENTITY);
  }
  if (resource.receiptChainHead) {
    const predecessor = await readCanonicalExecutorReceiptByDigest(statePath, resource.receiptChainHead);
    if (predecessor.acceptedReceipt.receiptDigest !== resource.receiptChainHead || predecessor.receipt.status !== 'pass' ||
        predecessor.receipt.environment !== state.environment || predecessor.receipt.project !== state.project ||
        !predecessor.receipt.resourceIds?.includes(resource.resourceId)) {
      throw new ContractError('read-only probe pending action receipt-chain head is invalid', EXIT.IDENTITY);
    }
  }
  const recorded = currentFence ? priorReceipt : await readExecutorReceipt(
    statePath, pending.fencingEpoch, args.action, pending.actionId,
  );
  if (recorded) {
    const canonical = await readCanonicalExecutorReceiptByDigest(statePath, recorded.receiptDigest);
    const recordedResource = recorded.resources?.[0];
    if (canonical.acceptedReceipt.receiptDigest !== recorded.receiptDigest || canonicalJson(canonical.receipt) !== canonicalJson(recorded) ||
        recorded.schema !== schemaForAction(args.action).receipt || !['pass', 'fail'].includes(recorded.status) ||
        recorded.environment !== state.environment || recorded.project !== state.project || recorded.action !== args.action ||
        recorded.actionId !== pending.actionId || recorded.operationId !== state.operationId ||
        recorded.approvalId !== pending.approvalId || recorded.generation !== pending.generation ||
        recorded.fencingEpoch !== pending.fencingEpoch || recorded.leaseId !== pending.leaseId || recorded.holderId !== pending.holderId ||
        recorded.manifestDigest !== releaseIdentity.manifestDigest || canonicalJson(recorded.releaseIdentity) !== canonicalJson(releaseIdentity) ||
        canonicalJson(recorded.resourceIds) !== canonicalJson(resourceIds) || recorded.runtimeEnvDigest !== state.runtimeEnvDigest ||
        recorded.commandDigest !== pending.commandDigest || recorded.requestDigest !== pending.requestDigest ||
        recorded.requestDigest !== sha256(receiptRequestBody(recorded)) || recorded.resources?.length !== 1 ||
        recordedResource?.resourceId !== resource.resourceId ||
        recordedResource?.highestAcceptedFencingEpoch !== pending.fencingEpoch ||
        recordedResource?.previousReceiptDigest !== resource.receiptChainHead) {
      throw new ContractError('read-only probe pending receipt is not bound to the exact pending request and chain head', EXIT.IDENTITY);
    }
    if (currentFence && recorded.status === 'pass') return null;
  }
  if (currentFence) {
    return { accepted: [resource], verification: { mode: recorded ? 'same-fence-fail-retried' : 'same-fence-missing-retried',
      priorFencingEpoch: state.fencingEpoch, priorReceiptDigest: recorded?.receiptDigest || null } };
  }
  const mutationAt = revalidateLease().observedAt;
  await supersedePriorEpochPendingAction(locks[0], {
    fencingEpoch: resource.highestAcceptedFencingEpoch, pendingAction: structuredClone(pending),
    receiptChainHead: resource.receiptChainHead,
  }, {
    environment: state.environment, project: state.project, resourceId: resource.resourceId,
    fencingEpoch: state.fencingEpoch, operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest,
    action: args.action, actionId: args['action-id'], requestDigest, approvalId: state.approvalId,
    leaseId: state.lease.leaseId, holderId: state.lease.holderId, generation: state.generation,
    commandDigest: requestBody.commandDigest, now: mutationAt.toISOString(),
  });
  const accepted = await inspectLockedResourceState(locks[0], {
    environment: state.environment, project: state.project, resourceId: resource.resourceId,
  });
  return { accepted: [accepted], verification: { mode: `cross-fence-${recorded?.status || 'missing'}-superseded-and-retried`,
    priorFencingEpoch: pending.fencingEpoch, priorReceiptDigest: recorded?.receiptDigest || null } };
}

function assertResult(result, exitCode) {
  if (!result || result.exitCode !== 0 || result.signal || result.overflow) throw new ContractError('external action failed or exceeded its bounded output', exitCode);
}

async function passRegistryGate(plan, revalidateLease, reserveMs = 500) {
  if (plan.registrySupplyChainGate) await plan.registrySupplyChainGate();
  return revalidateLease(reserveMs);
}

async function verifyCurrentExternalState(plan, context) {
  let leaseWindow = await passRegistryGate(plan, context.revalidateLease);
  if (!plan.readback) throw new ContractError('recorded action has no independent replay readback', EXIT.SINGLETON);
  let preflightVerification = null;
  if (plan.preflight) {
    const preflight = await context.runner(plan.preflight.executable, plan.preflight.argv, {
      cwd: plan.cwd, env: context.env, timeoutMs: leaseWindow.timeoutMs,
    });
    assertResult(preflight, EXIT.IDENTITY);
    preflightVerification = plan.preflight.verify(preflight.stdout);
  }
  let preflightArtifactEvidence = null;
  const replayPreflightArtifacts = plan.replayPreflightArtifacts || plan.preflightArtifacts;
  if (replayPreflightArtifacts) {
    leaseWindow = context.revalidateLease();
    preflightArtifactEvidence = await replayPreflightArtifacts({ ...context, timeoutMs: leaseWindow.timeoutMs });
  }
  leaseWindow = await passRegistryGate(plan, context.revalidateLease);
  const readback = await context.runner(plan.readback.executable, plan.readback.argv, {
    cwd: plan.cwd, env: context.env, timeoutMs: leaseWindow.timeoutMs,
  });
  assertResult(readback, EXIT.IDENTITY);
  const verification = { ...(preflightVerification ? { preflight: preflightVerification } : {}), runtime: plan.readback.verify(readback.stdout) };
  const artifactVerifier = plan.replayVerifyArtifacts || plan.verifyArtifacts;
  if (artifactVerifier) {
    leaseWindow = await passRegistryGate(plan, context.revalidateLease);
    verification.artifacts = await artifactVerifier({ ...context, timeoutMs: leaseWindow.timeoutMs,
      preflightEvidence: preflightArtifactEvidence });
  }
  return { verification, readbackOutputDigest: sha256(readback.stdout) };
}

// Called by the state manager while it still owns the deployment-state lock.
// Rebuild the trusted stage plan and inspect live state; never trust the
// verification object embedded in a previously published receipt.
export async function verifyStageRuntimeForTransition(statePath, state, receipt, runtime = {}) {
  if (receipt.action !== 'preprod-stage' || receipt.status !== 'pass' || receipt.generation !== state.generation ||
      receipt.fencingEpoch !== state.fencingEpoch || receipt.operationId !== state.operationId) {
    throw new ContractError('candidate start requires a current-generation stage receipt', EXIT.READINESS);
  }
  const actionArgs = {
    action: 'preprod-stage', 'action-id': receipt.actionId, environment: state.environment, project: state.project,
    'approval-id': state.approvalId, 'expected-generation': String(state.generation),
    'expected-fencing-epoch': String(state.fencingEpoch), 'manifest-digest': state.candidate?.manifestDigest,
    'operation-id': state.operationId, 'lease-id': state.lease?.leaseId, 'holder-id': state.lease?.holderId,
    'resource-id': state.resources.edgeNetwork,
  };
  const planBuilder = runtime.stageTransitionPlanBuilder || runtime.planBuilder || buildPlan;
  const plan = await planBuilder(state, actionArgs, { ...runtime, statePath });
  const runner = runtime.stageTransitionCommandRunner || runtime.commandRunner || defaultCommandRunner;
  const revalidateLease = (reserveMs = 500) => {
    const observedAt = runtime.now ? runtime.now() : new Date(runtime.nowMs ?? Date.now());
    if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime()) || !state.lease ||
        Date.parse(state.lease.expiresAt) - observedAt.getTime() - reserveMs < 1) {
      throw new ContractError('lease has insufficient remaining time for stage transition readback', EXIT.SINGLETON);
    }
    return { observedAt, timeoutMs: Date.parse(state.lease.expiresAt) - observedAt.getTime() - reserveMs };
  };
  return verifyCurrentExternalState(plan, { runner, env: plan.env || runtime.env || process.env, revalidateLease, statePath });
}

async function verifyPublishedIngressState(plan, context, receipt) {
  const leaseWindow = await passRegistryGate(plan, context.revalidateLease);
  const readback = await context.runner(plan.readback.executable, plan.readback.argv, {
    cwd: plan.cwd, env: context.env, timeoutMs: leaseWindow.timeoutMs,
  });
  assertResult(readback, EXIT.INGRESS);
  let parsed; try { parsed = JSON.parse(readback.stdout); } catch { throw new ContractError('ingress pass recovery readback is not JSON', EXIT.INGRESS); }
  const expected = receipt.verification?.runtime;
  const { observedAt: parsedAt, ...parsedIdentity } = parsed || {};
  const { observedAt: _expectedAt, ...expectedIdentity } = expected || {};
  if (!Number.isFinite(Date.parse(parsedAt)) || canonicalJson(parsedIdentity) !== canonicalJson(expectedIdentity)) {
    throw new ContractError('ingress pass recovery readback drifted from the published proof', EXIT.INGRESS);
  }
  return { verification: { runtime: parsed }, readbackOutputDigest: sha256(readback.stdout) };
}

async function currentTelegramEgressPredecessor(statePath, state, releaseIdentity, args) {
  const telegramResourceId = `telegram:${state.project}`;
  let resource;
  try { resource = JSON.parse(await readFile(join(resourceDirectory(statePath, telegramResourceId), 'resource-state.json'), 'utf8')); }
  catch { throw new ContractError('stage requires a completed current Telegram egress resource', EXIT.READINESS); }
  const pending = resource?.pendingAction;
  const currentStagePending = pending !== null && pending?.action === 'preprod-stage' && pending.actionId === args['action-id'] &&
    pending.fencingEpoch === state.fencingEpoch && pending.generation === state.generation && pending.approvalId === state.approvalId &&
    pending.leaseId === state.lease?.leaseId && pending.holderId === state.lease?.holderId;
  if ((pending !== null && !currentStagePending) || !DIGEST.test(resource?.receiptChainHead || '') ||
      resource.environment !== state.environment || resource.project !== state.project || resource.resourceId !== telegramResourceId ||
      resource.highestAcceptedFencingEpoch !== state.fencingEpoch || resource.operationId !== state.operationId ||
      resource.manifestDigest !== releaseIdentity.manifestDigest) {
    throw new ContractError('stage Telegram egress resource is not current and completed', EXIT.READINESS);
  }
  const current = await readCanonicalExecutorReceiptByDigest(statePath, resource.receiptChainHead);
  let predecessorDigest;
  if (current.receipt.action === 'preprod-prepare-telegram-egress') {
    predecessorDigest = current.acceptedReceipt.receiptDigest;
  } else if (pending === null && current.receipt.action === 'preprod-stage' && current.receipt.actionId === args['action-id'] &&
      current.receipt.schema === schemaForAction('preprod-stage').receipt && current.receipt.status === 'pass' &&
      current.receipt.operationId === state.operationId && current.receipt.generation === state.generation &&
      current.receipt.fencingEpoch === state.fencingEpoch && current.receipt.approvalId === state.approvalId &&
      current.receipt.leaseId === state.lease?.leaseId && current.receipt.holderId === state.lease?.holderId &&
      current.receipt.manifestDigest === releaseIdentity.manifestDigest &&
      canonicalJson(current.receipt.releaseIdentity) === canonicalJson(releaseIdentity) &&
      canonicalJson(current.receipt.resourceIds) === canonicalJson([state.resources.edgeNetwork, telegramResourceId])) {
    predecessorDigest = current.receipt.telegramEgressReceiptDigest;
    const telegramVector = current.receipt.resources?.find((entry) => entry.resourceId === telegramResourceId);
    if (current.acceptedReceipt.receiptDigest !== resource.receiptChainHead || telegramVector?.previousReceiptDigest !== predecessorDigest) {
      throw new ContractError('stage replay does not preserve its Telegram predecessor vector', EXIT.READINESS);
    }
  } else {
    throw new ContractError('stage Telegram resource head is neither fresh egress nor the same stage replay', EXIT.READINESS);
  }
  const { receipt, acceptedReceipt } = await readCanonicalExecutorReceiptByDigest(statePath, predecessorDigest);
  const requestBody = {
    schema: schemaForAction(receipt.action).request, environment: receipt.environment, project: receipt.project,
    action: receipt.action, actionId: receipt.actionId, operationId: receipt.operationId, approvalId: receipt.approvalId,
    generation: receipt.generation, fencingEpoch: receipt.fencingEpoch, leaseId: receipt.leaseId, holderId: receipt.holderId,
    manifestDigest: receipt.manifestDigest, releaseIdentity: receipt.releaseIdentity, resourceIds: receipt.resourceIds,
    runtimeEnvDigest: receipt.runtimeEnvDigest, commandDigest: receipt.commandDigest,
  };
  if (acceptedReceipt.receiptDigest !== predecessorDigest || receipt.action !== 'preprod-prepare-telegram-egress' ||
      receipt.status !== 'pass' || receipt.operationId !== state.operationId || receipt.approvalId !== state.approvalId ||
      receipt.generation !== state.generation || receipt.fencingEpoch !== state.fencingEpoch ||
      receipt.leaseId !== state.lease?.leaseId || receipt.holderId !== state.lease?.holderId ||
      receipt.manifestDigest !== releaseIdentity.manifestDigest || canonicalJson(receipt.releaseIdentity) !== canonicalJson(releaseIdentity) ||
      canonicalJson(receipt.resourceIds) !== canonicalJson([telegramResourceId]) ||
      receipt.runtimeEnvDigest !== state.runtimeEnvDigest || receipt.requestDigest !== sha256(requestBody)) {
    throw new ContractError('stage Telegram egress receipt is not bound to the current operation generation and fence', EXIT.READINESS);
  }
  return predecessorDigest;
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
    const revalidateLease = (reserveMs = 500) => {
      const observedAt = now();
      if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
        throw new ContractError('trusted runtime clock is invalid', EXIT.SWITCH);
      }
      assertStateBinding(state, args, spec, observedAt.getTime());
      const timeoutMs = Date.parse(state.lease.expiresAt) - observedAt.getTime() - reserveMs;
      if (timeoutMs < 1) throw new ContractError('lease has insufficient remaining time for external action', EXIT.SINGLETON);
      return { observedAt, timeoutMs };
    };
    let rootedWebhookReplay = false;
    if (args.action === 'preprod-set-webhook' && state.phase === 'OBSERVING') {
      const rootedDigest = state.evidence.webhookReceiptDigest;
      if (!rootedDigest) throw new ContractError('OBSERVING has no rooted webhook action to replay', EXIT.INGRESS);
      const { receipt, acceptedReceipt } = await readCanonicalExecutorReceiptByDigest(statePath, rootedDigest);
      if (acceptedReceipt.receiptDigest !== rootedDigest || receipt.schema !== schemaForAction(args.action).receipt ||
          receipt.action !== args.action || receipt.actionId !== args['action-id'] ||
          receipt.operationId !== state.operationId || receipt.fencingEpoch !== state.fencingEpoch) {
        throw new ContractError('OBSERVING permits only exact replay of the rooted webhook action', EXIT.INGRESS);
      }
      rootedWebhookReplay = true;
    }
    const telegramEgressReceiptDigest = args.action === 'preprod-stage'
      ? await currentTelegramEgressPredecessor(statePath, state, releaseIdentity, args) : null;
    const plan = await (runtime.planBuilder || buildPlan)(state, args, { ...runtime, statePath });
    const requestBody = { schema: schemaForAction(args.action).request, environment: state.environment, project: state.project,
      action: args.action, actionId: args['action-id'], operationId: state.operationId, approvalId: state.approvalId,
      generation: state.generation, fencingEpoch: state.fencingEpoch, leaseId: state.lease.leaseId, holderId: state.lease.holderId,
      manifestDigest: releaseIdentity.manifestDigest, releaseIdentity, resourceIds, runtimeEnvDigest: state.runtimeEnvDigest,
      commandDigest: commandIdentity(plan), ...(telegramEgressReceiptDigest ? { telegramEgressReceiptDigest } : {}) };
    const requestDigest = sha256(requestBody);
    const priorReceipt = await readExecutorReceipt(statePath, state.fencingEpoch, args.action, args['action-id']);
    if (priorReceipt && (priorReceipt.schema !== schemaForAction(args.action).receipt ||
        (!rootedWebhookReplay && priorReceipt.requestDigest !== requestDigest) ||
        !['pass', 'fail'].includes(priorReceipt.status))) {
      throw new ContractError('existing action receipt does not match this request', EXIT.SINGLETON);
    }
    const locks = await acquireResourceLocks(statePath, resourceIds);
    try {
      const runner = runtime.commandRunner || defaultCommandRunner;
      await passRegistryGate(plan, revalidateLease);
      const probeContinuity = spec.kind === 'release-probe' && priorReceipt?.status !== 'pass'
        ? await prepareRetryableProbeContinuity({ statePath, state, args, releaseIdentity, resourceIds, locks,
          requestBody, requestDigest, priorReceipt, revalidateLease })
        : null;
      const reconcileBinding = {
        environment: state.environment, project: state.project, fencingEpoch: state.fencingEpoch,
        operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest,
        action: args.action, actionId: args['action-id'], requestDigest, approvalId: state.approvalId,
        leaseId: state.lease.leaseId, holderId: state.lease.holderId, generation: state.generation,
        commandDigest: requestBody.commandDigest, now: firstNow.toISOString(),
      };
      const ambiguousGroup = priorReceipt?.status === 'pass' ? null
        : await readResourceActionGroup(statePath, reconcileBinding, resourceIds);
      let resumeUnstartedGroup = null;
      if (ambiguousGroup && ['MUTATING', 'EXECUTING', 'RECEIPT_WRITTEN'].includes(ambiguousGroup.value.phase) && priorReceipt?.status !== 'pass') {
        const resources = [];
        for (const lock of locks) {
          const resource = await inspectLockedResourceState(lock, { ...reconcileBinding, resourceId: lock.resourceId });
          const pending = resource.pendingAction;
          if (resource.highestAcceptedFencingEpoch !== state.fencingEpoch || resource.operationId !== state.operationId ||
              resource.manifestDigest !== releaseIdentity.manifestDigest || pending?.action !== args.action ||
              pending.actionId !== args['action-id'] || pending.requestDigest !== requestDigest ||
              pending.commandDigest !== requestBody.commandDigest || pending.groupDigest !== ambiguousGroup.value.groupDigest) {
            throw new ContractError('ambiguous action-group resource identity drifted', EXIT.SINGLETON);
          }
          resources.push(resource);
        }
        let replay;
        try {
          replay = await verifyCurrentExternalState(plan, { runner, env: plan.env || runtime.env || process.env,
            revalidateLease, statePath, adoptionReceipt: priorReceipt });
        } catch {
          if (ambiguousGroup.value.phase === 'MUTATING' && !priorReceipt) {
            // MUTATING is deliberately before the durable dispatch boundary.
            // It proves a crash occurred before any command dispatch was
            // recorded, so this exact group may consume its one dispatch.
            resumeUnstartedGroup = { group: ambiguousGroup, resources };
          } else if (ambiguousGroup.value.phase === 'RECEIPT_WRITTEN' && priorReceipt?.status === 'fail' &&
              ['ACCEPTED', 'MUTATING'].includes(ambiguousGroup.value.receiptFromPhase) &&
              ambiguousGroup.value.receiptDigest === priorReceipt.receiptDigest) {
            reconcileBinding.now = revalidateLease().observedAt.toISOString();
            await resumeResourceActionGroupBeforeDispatch(statePath, reconcileBinding, resourceIds, priorReceipt.receiptDigest);
            resumeUnstartedGroup = { group: ambiguousGroup, resources };
          } else {
            throw new ContractError('ambiguous action-group is not exact desired state; automatic mutation is forbidden', EXIT.SINGLETON);
          }
        }
        if (replay) {
          if (!runtime.planBuilder) await inspectTrustedRuntimeEnvironment(state, runtime);
          const completedAt = (await passRegistryGate(plan, revalidateLease)).observedAt;
          const receiptBody = { ...requestBody, schema: schemaForAction(args.action).receipt, requestDigest,
            startedAt: firstNow.toISOString(), completedAt: completedAt.toISOString(), status: 'pass',
            executionOutputDigest: sha256(''), readbackOutputDigest: replay.readbackOutputDigest,
            verification: { ...replay.verification, reconcile: { mode: 'same-fence-proven-applied-read-only',
              priorReceiptMode: priorReceipt?.status || 'missing', groupDigest: ambiguousGroup.value.groupDigest } },
            resources: resources.map((resource) => ({ resourceId: resource.resourceId,
              highestAcceptedFencingEpoch: state.fencingEpoch, previousReceiptDigest: resource.receiptChainHead })) };
          const receipt = { ...receiptBody, receiptDigest: sha256(receiptBody) };
          revalidateLease();
          await writeExecutorReceipt(statePath, receipt);
          reconcileBinding.now = revalidateLease().observedAt.toISOString();
          await reconcileResourceActionGroupReceipt(statePath, reconcileBinding, resourceIds, receipt.receiptDigest);
          await completeResourceActionGroup(statePath, locks, reconcileBinding, receipt.receiptDigest);
          return receipt;
        }
      }
      if (args.action === 'preprod-abort-telegram-egress') {
        if (locks.length !== 1) throw new ContractError('Telegram abort requires exactly one fenced resource', EXIT.SINGLETON);
        const recoveryBinding = runtime.failedRestoreBinding || FAILED_RESTORE_BINDING;
        const commandDigestForFence = (fencingEpoch) => historicalRecoveryCommandDigest(plan, fencingEpoch);
        if (state.operationId !== recoveryBinding.operationId || releaseIdentity.manifestDigest !== recoveryBinding.manifestDigest) {
          throw new ContractError('Telegram abort is not bound to this failed operation', EXIT.IDENTITY);
        }
        const failed = await readExecutorReceipt(statePath, recoveryBinding.priorTelegramFencingEpoch,
          'preprod-prepare-telegram-egress', recoveryBinding.priorTelegramActionId);
        const expectedResources = [`telegram:${state.project}`];
        const canonicalFailure = failed ? await readCanonicalExecutorReceiptByDigest(statePath, failed.receiptDigest) : null;
        if (!canonicalFailure || canonicalFailure.acceptedReceipt.receiptDigest !== failed?.receiptDigest ||
            canonicalJson(canonicalFailure.receipt) !== canonicalJson(failed)) {
          throw new ContractError('Telegram abort fixed prior failure receipt is not canonical', EXIT.IDENTITY);
        }
        const baseReceiptChainHead = assertFixedTelegramFailureReceipt(failed, state, releaseIdentity, recoveryBinding, expectedResources);
        let resource = await inspectLockedResourceState(locks[0], {
          environment: state.environment, project: state.project, resourceId: locks[0].resourceId,
        });
        if (resource.operationId !== state.operationId || resource.manifestDigest !== releaseIdentity.manifestDigest ||
            resource.highestAcceptedFencingEpoch > state.fencingEpoch) {
          throw new ContractError('Telegram abort resource identity is not continuous with the failed operation', EXIT.IDENTITY);
        }
        let pending = resource.pendingAction;
        const currentPending = resource.highestAcceptedFencingEpoch === state.fencingEpoch &&
          pending?.action === args.action && pending.actionId === args['action-id'] && pending.requestDigest === requestDigest &&
          pending.approvalId === state.approvalId && pending.leaseId === state.lease.leaseId && pending.holderId === state.lease.holderId &&
          pending.generation === state.generation && pending.fencingEpoch === state.fencingEpoch && pending.commandDigest === requestBody.commandDigest;
        if (priorReceipt) {
          const direct = await readCanonicalExecutorReceiptByDigest(statePath, priorReceipt.receiptDigest);
          if (canonicalJson(direct.receipt) !== canonicalJson(priorReceipt)) {
            throw new ContractError('Telegram abort current receipt is not canonical', EXIT.IDENTITY);
          }
          if (currentPending) {
            assertTelegramAbortReceipt(priorReceipt, direct.acceptedReceipt, state, releaseIdentity, recoveryBinding, failed,
              resource.resourceId, resource.receiptChainHead, requestBody.commandDigest, pending);
          } else {
            const newest = resource.pendingAction === null && resource.highestAcceptedFencingEpoch === state.fencingEpoch
              ? await assertTelegramAbortReceiptChain(statePath, resource.receiptChainHead, baseReceiptChainHead, state,
                releaseIdentity, recoveryBinding, failed, resource.resourceId, commandDigestForFence, state.fencingEpoch + 1)
              : null;
            if (!newest || newest.acceptedReceipt.receiptDigest !== resource.receiptChainHead ||
                newest.receipt.receiptDigest !== priorReceipt.receiptDigest || newest.receipt.requestDigest !== requestDigest) {
              throw new ContractError('Telegram abort completed resource does not match the current receipt', EXIT.IDENTITY);
            }
          }
        } else if (!currentPending) {
          if (resource.highestAcceptedFencingEpoch >= state.fencingEpoch) {
            throw new ContractError('Telegram abort current resource has no matching pending action or receipt', EXIT.SINGLETON);
          }
          const prior = { fencingEpoch: resource.highestAcceptedFencingEpoch,
            pendingAction: pending === null ? null : structuredClone(pending), receiptChainHead: resource.receiptChainHead };
          const newest = await assertTelegramAbortReceiptChain(statePath, resource.receiptChainHead, baseReceiptChainHead, state,
            releaseIdentity, recoveryBinding, failed, resource.resourceId, commandDigestForFence, state.fencingEpoch);
          const nextBinding = {
            environment: state.environment, project: state.project, resourceId: resource.resourceId,
            fencingEpoch: state.fencingEpoch, operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest,
            action: args.action, actionId: args['action-id'], requestDigest, approvalId: state.approvalId,
            leaseId: state.lease.leaseId, holderId: state.lease.holderId, generation: state.generation,
            commandDigest: requestBody.commandDigest, now: revalidateLease().observedAt.toISOString(),
          };
          if (pending?.action === 'preprod-prepare-telegram-egress') {
            if (resource.highestAcceptedFencingEpoch !== recoveryBinding.priorTelegramFencingEpoch ||
                resource.receiptChainHead !== baseReceiptChainHead || pending.actionId !== recoveryBinding.priorTelegramActionId ||
                pending.fencingEpoch !== recoveryBinding.priorTelegramFencingEpoch || failed.action !== pending.action ||
                failed.actionId !== pending.actionId || failed.approvalId !== pending.approvalId || failed.leaseId !== pending.leaseId ||
                failed.holderId !== pending.holderId || failed.generation !== pending.generation ||
                failed.fencingEpoch !== pending.fencingEpoch || failed.commandDigest !== pending.commandDigest ||
                failed.requestDigest !== pending.requestDigest) {
              throw new ContractError('Telegram abort prior failure receipt does not match the pending action', EXIT.IDENTITY);
            }
            await supersedePriorEpochPendingAction(locks[0], prior, nextBinding);
          } else if (pending?.action === args.action) {
            const priorRequest = { schema: schemaForAction(args.action).request, environment: state.environment, project: state.project,
              action: args.action, actionId: pending.actionId, operationId: state.operationId, approvalId: pending.approvalId,
              generation: pending.generation, fencingEpoch: pending.fencingEpoch, leaseId: pending.leaseId, holderId: pending.holderId,
              manifestDigest: releaseIdentity.manifestDigest, releaseIdentity, resourceIds: expectedResources,
              runtimeEnvDigest: state.runtimeEnvDigest, commandDigest: pending.commandDigest };
            if (pending.fencingEpoch !== resource.highestAcceptedFencingEpoch ||
                pending.commandDigest !== commandDigestForFence(pending.fencingEpoch) ||
                pending.requestDigest !== sha256(priorRequest)) {
              throw new ContractError('Telegram abort prior pending request identity is invalid', EXIT.IDENTITY);
            }
            const completedPending = await readExecutorReceipt(statePath, pending.fencingEpoch, args.action, pending.actionId);
            if (completedPending) {
              if (completedPending.status !== 'pass') throw new ContractError('Telegram abort prior pending receipt is not a pass', EXIT.IDENTITY);
              const canonical = await readCanonicalExecutorReceiptByDigest(statePath, completedPending.receiptDigest);
              if (canonicalJson(canonical.receipt) !== canonicalJson(completedPending)) {
                throw new ContractError('Telegram abort prior pending receipt is not canonical', EXIT.IDENTITY);
              }
              assertTelegramAbortReceipt(completedPending, canonical.acceptedReceipt, state, releaseIdentity, recoveryBinding, failed,
                resource.resourceId, resource.receiptChainHead, commandDigestForFence(pending.fencingEpoch), pending);
              await adoptPriorEpochPendingAction(locks[0], prior, { environment: state.environment, project: state.project,
                resourceId: resource.resourceId, fencingEpoch: state.fencingEpoch, operationId: state.operationId,
                manifestDigest: releaseIdentity.manifestDigest, now: nextBinding.now }, completedPending.receiptDigest);
              const adopted = await inspectLockedResourceState(locks[0], { environment: state.environment, project: state.project,
                resourceId: resource.resourceId });
              await acceptResourceEpoch(locks[0], { ...nextBinding, now: revalidateLease().observedAt.toISOString() });
              if (adopted.receiptChainHead !== completedPending.receiptDigest) {
                throw new ContractError('Telegram abort prior receipt was not adopted into the resource chain', EXIT.IDENTITY);
              }
            } else {
              await supersedePriorEpochPendingAction(locks[0], prior, nextBinding);
            }
          } else if (pending === null) {
            if (!newest || newest.acceptedReceipt.receiptDigest !== resource.receiptChainHead ||
                newest.receipt.fencingEpoch !== resource.highestAcceptedFencingEpoch) {
              throw new ContractError('Telegram abort completed prior fence has no canonical receipt-chain head', EXIT.IDENTITY);
            }
            await acceptResourceEpoch(locks[0], nextBinding);
          } else {
            throw new ContractError('Telegram abort cannot bind the prior pending action', EXIT.SINGLETON);
          }
          resource = await inspectLockedResourceState(locks[0], { environment: state.environment, project: state.project,
            resourceId: resource.resourceId });
          pending = resource.pendingAction;
          if (resource.highestAcceptedFencingEpoch !== state.fencingEpoch || pending?.actionId !== args['action-id'] ||
              pending.requestDigest !== requestDigest || pending.commandDigest !== requestBody.commandDigest) {
            throw new ContractError('Telegram abort takeover did not establish the current fenced pending action', EXIT.SINGLETON);
          }
        }
        if (priorReceipt) {
          // The generic replay path below performs the same fresh absence readback and closes any current-fence pending state.
        } else {
        let execution; let readback; let verification; let completedAt;
        try {
          let leaseWindow = await passRegistryGate(plan, revalidateLease);
          const before = await runner(plan.readback.executable, plan.readback.argv, { cwd: plan.cwd,
            env: plan.env || runtime.env || process.env, timeoutMs: leaseWindow.timeoutMs });
          assertResult(before, EXIT.SINGLETON);
          let alreadyAbsent = null;
          try { alreadyAbsent = plan.readback.verify(before.stdout); } catch { /* Existing target must be inspected before removal. */ }
          let executionVerification = null;
          if (!alreadyAbsent) {
            if (!plan.preflight) throw new ContractError('Telegram abort requires exact target preflight', EXIT.IDENTITY);
            leaseWindow = await passRegistryGate(plan, revalidateLease);
            const preflight = await runner(plan.preflight.executable, plan.preflight.argv, { cwd: plan.cwd,
              env: plan.env || runtime.env || process.env, timeoutMs: leaseWindow.timeoutMs });
            assertResult(preflight, EXIT.IDENTITY);
            const target = plan.preflight.verify(preflight.stdout);
            leaseWindow = await passRegistryGate(plan, revalidateLease);
            const immediate = await runner(plan.preflight.executable, plan.preflight.argv, { cwd: plan.cwd,
              env: plan.env || runtime.env || process.env, timeoutMs: leaseWindow.timeoutMs });
            assertResult(immediate, EXIT.IDENTITY);
            const immediateTarget = plan.preflight.verify(immediate.stdout);
            if (canonicalJson(immediateTarget) !== canonicalJson(target)) {
              throw new ContractError('Telegram egress abort target changed between identity checks', EXIT.IDENTITY);
            }
            leaseWindow = await passRegistryGate(plan, revalidateLease);
            const removeByIdArgv = ['container', 'rm', '--force', target.containerId];
            execution = await runner(plan.executable, removeByIdArgv, { cwd: plan.cwd, env: plan.env || runtime.env || process.env,
              timeoutMs: leaseWindow.timeoutMs });
            assertResult(execution, EXIT.SINGLETON);
            if (execution.stdout.trim() !== target.containerId) {
              throw new ContractError('Telegram egress abort removed-container ID does not match the twice-inspected target', EXIT.IDENTITY);
            }
            executionVerification = { ...(plan.verifyExecution ? plan.verifyExecution(execution.stdout) : {}), target };
          } else {
            execution = { stdout: '', exitCode: 0, signal: null, overflow: false };
          }
          leaseWindow = await passRegistryGate(plan, revalidateLease);
          readback = await runner(plan.readback.executable, plan.readback.argv, { cwd: plan.cwd,
            env: plan.env || runtime.env || process.env, timeoutMs: leaseWindow.timeoutMs });
          assertResult(readback, EXIT.SINGLETON);
          verification = { ...(executionVerification ? { execution: executionVerification } : {}), runtime: plan.readback.verify(readback.stdout),
            reconcile: { mode: alreadyAbsent ? 'already-absent-idempotent-pass' : 'exact-container-force-removed' },
            priorFailure: { action: 'preprod-prepare-telegram-egress', fencingEpoch: recoveryBinding.priorTelegramFencingEpoch,
              receiptDigest: failed.receiptDigest, requestDigest: failed.requestDigest } };
          if (!runtime.planBuilder) await inspectTrustedRuntimeEnvironment(state, runtime);
          completedAt = (await passRegistryGate(plan, revalidateLease)).observedAt;
        } catch (error) {
          throw error;
        }
        const receiptBody = { ...requestBody, schema: schemaForAction(args.action).receipt, requestDigest,
          startedAt: firstNow.toISOString(), completedAt: completedAt.toISOString(), status: 'pass',
          executionOutputDigest: sha256(execution.stdout), readbackOutputDigest: sha256(readback.stdout), verification,
          resources: [{ resourceId: resource.resourceId, highestAcceptedFencingEpoch: state.fencingEpoch,
            previousReceiptDigest: resource.receiptChainHead }] };
        const receipt = { ...receiptBody, receiptDigest: sha256(receiptBody) };
        revalidateLease();
        await writeExecutorReceipt(statePath, receipt);
        const mutationAt = revalidateLease().observedAt;
        await completeResourceAction(locks[0], { environment: state.environment, project: state.project,
          resourceId: resource.resourceId, fencingEpoch: state.fencingEpoch, operationId: state.operationId,
          actionId: args['action-id'], requestDigest, now: mutationAt.toISOString() }, receipt.receiptDigest);
        return receipt;
        }
      }
      let failedDatabaseContinuity = null;
      if (args.action === 'preprod-attest-database-restore') {
        const recoveryBinding = runtime.failedRestoreBinding || FAILED_RESTORE_BINDING;
        if (state.operationId !== recoveryBinding.operationId || releaseIdentity.manifestDigest !== recoveryBinding.manifestDigest ||
            !Number.isInteger(recoveryBinding.forensicFencingEpoch) || state.fencingEpoch <= recoveryBinding.forensicFencingEpoch) {
          throw new ContractError('failed database recovery continuity is not bound to the fixed restore evidence', EXIT.IDENTITY);
        }
        failedDatabaseContinuity = await prepareFailedDatabaseAttestationContinuity({ statePath, state, args, releaseIdentity,
          resourceIds, locks, requestBody, requestDigest, binding: recoveryBinding, revalidateLease,
          commandDigestForFence: (fencingEpoch) => historicalRecoveryCommandDigest(plan, fencingEpoch) });
        if (priorReceipt) {
          const canonical = await readCanonicalExecutorReceiptByDigest(statePath, priorReceipt.receiptDigest);
          if (canonicalJson(canonical.receipt) !== canonicalJson(priorReceipt)) {
            throw new ContractError('database restore current receipt is not canonical', EXIT.IDENTITY);
          }
          assertDatabaseAttestationReceipt(priorReceipt, canonical.acceptedReceipt, state, releaseIdentity, resourceIds,
            requestBody.commandDigest, state.fencingEpoch);
          if (priorReceipt.status !== 'pass') {
            throw new ContractError('database restore current receipt is not a pass', EXIT.IDENTITY);
          }
        }
      }
      if (args.action === 'preprod-restore-active-runtime' && !priorReceipt) {
        const resourceStates = [];
        for (const lock of locks) resourceStates.push(await readRecoveryResourceState(statePath, state, lock.resourceId, true,
          [state.resources.edgeNetwork, state.resources.ingressRef].includes(lock.resourceId)));
        const pendingStates = resourceStates.filter((resource) => resource.pendingAction !== null);
        if (pendingStates.length !== 0) {
          const priorPendingDigests = new Set();
          for (const resource of pendingStates) {
            const pending = resource.pendingAction;
            const pendingRequest = { schema: schemaForAction(args.action).request, environment: state.environment, project: state.project,
              action: args.action, actionId: pending.actionId, operationId: state.operationId, approvalId: pending.approvalId,
              generation: pending.generation, fencingEpoch: pending.fencingEpoch, leaseId: pending.leaseId, holderId: pending.holderId,
              manifestDigest: releaseIdentity.manifestDigest, releaseIdentity, resourceIds,
              runtimeEnvDigest: state.runtimeEnvDigest, commandDigest: pending.commandDigest };
            const currentPending = pending.fencingEpoch === state.fencingEpoch && pending.actionId === args['action-id'] &&
              pending.approvalId === state.approvalId && pending.leaseId === state.lease.leaseId &&
              pending.holderId === state.lease.holderId && pending.generation === state.generation && pending.requestDigest === requestDigest;
            if (resource.highestAcceptedFencingEpoch !== pending.fencingEpoch || resource.operationId !== state.operationId ||
                resource.manifestDigest !== releaseIdentity.manifestDigest || pending.action !== args.action ||
                pending.commandDigest !== historicalRecoveryCommandDigest(plan, pending.fencingEpoch) || pending.fencingEpoch > state.fencingEpoch ||
                pending.requestDigest !== sha256(pendingRequest) || (pending.fencingEpoch === state.fencingEpoch && !currentPending)) {
              throw new ContractError('active runtime restore pending resource identity is inconsistent', EXIT.SINGLETON);
            }
            if (!currentPending) priorPendingDigests.add(pending.requestDigest);
          }
          if (priorPendingDigests.size > 1) throw new ContractError('active runtime restore has conflicting prior pending attempts', EXIT.SINGLETON);
          let completedPrior = null;
          for (const resource of resourceStates.filter((item) => item.pendingAction === null &&
            item.manifestDigest === releaseIdentity.manifestDigest && item.receiptChainHead)) {
            const canonical = await readCanonicalExecutorReceiptByDigest(statePath, resource.receiptChainHead);
            if (canonical.receipt.action === args.action && canonical.receipt.operationId === state.operationId) {
              if (completedPrior && completedPrior.receipt.receiptDigest !== canonical.receipt.receiptDigest) {
                throw new ContractError('active runtime restore has conflicting completed prior receipts', EXIT.SINGLETON);
              }
              completedPrior = canonical;
            }
          }
          let preflightEvidence = null;
          if (plan.preflightArtifacts) {
            const leaseWindow = revalidateLease(1_000);
            preflightEvidence = await plan.preflightArtifacts({ runner, env: plan.env || runtime.env || process.env,
              timeoutMs: leaseWindow.timeoutMs, revalidateLease, statePath, recoveryPending: true,
              adoptionReceipt: completedPrior?.receipt });
          }
          const runtimeSnapshot = preflightEvidence?.containers;
          const hasRuntimeSnapshot = typeof runtimeSnapshot?.backend?.running === 'boolean' &&
            typeof runtimeSnapshot?.gateway?.running === 'boolean';
          const externalStateComplete = hasRuntimeSnapshot && runtimeSnapshot.backend.running && runtimeSnapshot.gateway.running;
          const mustReadOnlyRecover = hasRuntimeSnapshot
            ? externalStateComplete
            : (priorPendingDigests.size === 1 || completedPrior !== null || pendingStates.length === locks.length);
          let replay = null;
          if (mustReadOnlyRecover) {
            replay = await verifyCurrentExternalState(plan, { runner, env: plan.env || runtime.env || process.env,
              revalidateLease, statePath, recoveryPending: true, adoptionReceipt: completedPrior?.receipt });
          }
          for (let index = 0; index < locks.length; index += 1) {
            const mutationAt = revalidateLease().observedAt.toISOString();
            const resource = resourceStates[index];
            const binding = { environment: state.environment, project: state.project, resourceId: resource.resourceId,
              fencingEpoch: state.fencingEpoch, operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest,
              allowedPreviousManifestDigest: state.candidate?.manifestDigest, action: args.action, actionId: args['action-id'],
              requestDigest, approvalId: state.approvalId, leaseId: state.lease.leaseId, holderId: state.lease.holderId,
              generation: state.generation, commandDigest: requestBody.commandDigest, now: mutationAt };
            if (resource.pendingAction?.fencingEpoch === state.fencingEpoch) continue;
            if (resource.pendingAction) {
              await supersedePriorEpochPendingAction(locks[index], { fencingEpoch: resource.highestAcceptedFencingEpoch,
                pendingAction: structuredClone(resource.pendingAction), receiptChainHead: resource.receiptChainHead }, binding);
            } else {
              await acceptResourceEpoch(locks[index], binding);
            }
          }
          let executionOutput = '';
          if (!mustReadOnlyRecover) {
            let leaseWindow = await passRegistryGate(plan, revalidateLease, 1_000);
            const execution = await runner(plan.executable, plan.argv, { cwd: plan.cwd, env: plan.env || runtime.env || process.env,
              timeoutMs: leaseWindow.timeoutMs });
            assertResult(execution, EXIT.SWITCH);
            executionOutput = execution.stdout;
            const executionVerification = plan.verifyExecution ? plan.verifyExecution(execution.stdout) : null;
            leaseWindow = await passRegistryGate(plan, revalidateLease);
            const readback = await runner(plan.readback.executable, plan.readback.argv, { cwd: plan.cwd,
              env: plan.env || runtime.env || process.env, timeoutMs: leaseWindow.timeoutMs });
            assertResult(readback, EXIT.READINESS);
            const verification = { ...(executionVerification ? { execution: executionVerification } : {}), runtime: plan.readback.verify(readback.stdout) };
            if (plan.verifyArtifacts) verification.artifacts = await plan.verifyArtifacts({ runner,
              env: plan.env || runtime.env || process.env, timeoutMs: revalidateLease().timeoutMs, statePath, revalidateLease,
              preflightEvidence });
            replay = { verification, readbackOutputDigest: sha256(readback.stdout) };
          }
          const completedAt = revalidateLease().observedAt;
          const priorPendingDigest = [...priorPendingDigests][0] || pendingStates[0].pendingAction.requestDigest;
          const receiptBody = { ...requestBody, schema: schemaForAction(args.action).receipt, requestDigest,
            startedAt: firstNow.toISOString(), completedAt: completedAt.toISOString(), status: 'pass',
            executionOutputDigest: sha256(executionOutput), readbackOutputDigest: replay.readbackOutputDigest,
            verification: { ...replay.verification, adoption: { mode: mustReadOnlyRecover
              ? 'prior-pending-proven-applied-read-only' : (hasRuntimeSnapshot
                ? 'fixed-container-idempotent-start-retried' : 'partial-current-fence-accept-completed-before-start'),
              priorFencingEpoch: Math.min(...pendingStates.map((resource) => resource.pendingAction.fencingEpoch)),
              priorRequestDigest: priorPendingDigest } },
            resources: resourceStates.map((resource) => ({ resourceId: resource.resourceId,
              highestAcceptedFencingEpoch: state.fencingEpoch, previousReceiptDigest: resource.receiptChainHead })) };
          const receipt = { ...receiptBody, receiptDigest: sha256(receiptBody) };
          revalidateLease();
          await writeExecutorReceipt(statePath, receipt);
          for (const lock of locks) {
            const mutationAt = revalidateLease().observedAt;
            await completeResourceAction(lock, { environment: state.environment, project: state.project,
              resourceId: lock.resourceId, fencingEpoch: state.fencingEpoch, operationId: state.operationId,
              actionId: args['action-id'], requestDigest, now: mutationAt.toISOString() }, receipt.receiptDigest);
          }
          return receipt;
        }
      }
      if (priorReceipt?.status === 'pass') {
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
              let leaseWindow = await passRegistryGate(plan, revalidateLease);
              const priorReadback = await runner(plan.readback.executable, plan.readback.argv, {
                cwd: plan.cwd, env: plan.env || runtime.env || process.env,
                timeoutMs: leaseWindow.timeoutMs,
              });
              assertResult(priorReadback, EXIT.INGRESS);
              verifyPriorPendingIngress(priorReadback, state, args, releaseIdentity, priorEpochResource, priorIdentity);
              const replayArtifacts = plan.replayVerifyArtifacts || plan.verifyArtifacts;
              if (replayArtifacts) {
                const replayPreflight = plan.replayPreflightArtifacts || plan.preflightArtifacts;
                leaseWindow = revalidateLease();
                const preflightEvidence = replayPreflight ? await replayPreflight({ runner,
                  env: plan.env || runtime.env || process.env, timeoutMs: leaseWindow.timeoutMs, statePath }) : null;
                leaseWindow = revalidateLease();
                await replayArtifacts({ runner, env: plan.env || runtime.env || process.env, timeoutMs: leaseWindow.timeoutMs, statePath,
                  revalidateLease,
                  preflightEvidence });
              }
            } else {
              await verifyCurrentExternalState(plan, { runner, env: plan.env || runtime.env || process.env,
                revalidateLease, statePath });
            }
            if (!runtime.planBuilder) await inspectTrustedRuntimeEnvironment(state, runtime);
            await passRegistryGate(plan, revalidateLease);
            const mutationAt = revalidateLease().observedAt;
            await adoptPriorEpochPendingAction(locks[0], {
              fencingEpoch: priorEpochResource.highestAcceptedFencingEpoch,
              pendingAction: structuredClone(priorEpochResource.pendingAction),
              receiptChainHead: priorEpochResource.receiptChainHead,
            }, { environment: state.environment, project: state.project, resourceId: priorEpochResource.resourceId,
              fencingEpoch: state.fencingEpoch, operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest,
              now: mutationAt.toISOString() }, priorReceipt.receiptDigest);
            return priorReceipt;
          }
        }
        {
          const vectorStates = [];
          for (const lock of locks) vectorStates.push(await inspectLockedResourceState(lock, {
            environment: state.environment, project: state.project, resourceId: lock.resourceId,
          }));
          if (vectorStates.some((resource) => resource.highestAcceptedFencingEpoch < state.fencingEpoch)) {
            const canonicalPass = await readCanonicalExecutorReceiptByDigest(statePath, priorReceipt.receiptDigest);
            const vector = new Map((priorReceipt.resources || []).map((item) => [item.resourceId, item]));
            if (canonicalPass.acceptedReceipt.receiptDigest !== priorReceipt.receiptDigest ||
                canonicalJson(canonicalPass.receipt) !== canonicalJson(priorReceipt) || vector.size !== resourceIds.length ||
                resourceIds.some((resourceId) => !vector.has(resourceId))) {
              throw new ContractError('published pass recovery vector is not canonical or complete', EXIT.IDENTITY);
            }
            for (const resource of vectorStates) {
              const expected = vector.get(resource.resourceId);
              if (resource.operationId !== state.operationId || resource.manifestDigest !== releaseIdentity.manifestDigest ||
                  resource.highestAcceptedFencingEpoch > state.fencingEpoch ||
                  resource.receiptChainHead !== expected.previousReceiptDigest) {
                // A resource already completed by this pass is the sole
                // exception to the vector's predecessor head.
                if (!(resource.highestAcceptedFencingEpoch === state.fencingEpoch && resource.pendingAction === null &&
                    resource.receiptChainHead === priorReceipt.receiptDigest)) {
                  throw new ContractError(`resource ${resource.resourceId} drifted from the published pass recovery vector`, EXIT.SINGLETON);
                }
              }
              if (resource.pendingAction) {
                const pending = resource.pendingAction;
                if (pending.action !== args.action || pending.fencingEpoch !== resource.highestAcceptedFencingEpoch) {
                  throw new ContractError(`resource ${resource.resourceId} pending identity conflicts with the published pass`, EXIT.IDENTITY);
                }
                if (resource.highestAcceptedFencingEpoch === state.fencingEpoch) {
                  if (pending.commandDigest !== requestBody.commandDigest || pending.actionId !== args['action-id'] || pending.requestDigest !== requestDigest ||
                      pending.approvalId !== state.approvalId || pending.leaseId !== state.lease.leaseId ||
                      pending.holderId !== state.lease.holderId || pending.generation !== state.generation) {
                    throw new ContractError(`resource ${resource.resourceId} current pending identity conflicts with the published pass`, EXIT.IDENTITY);
                  }
                } else {
                  if (spec.kind.includes('ingress') && pending.requestDigest !== priorReceipt.verification?.adoption?.priorRequestDigest) {
                    throw new ContractError(`resource ${resource.resourceId} prior ingress pending identity conflicts with the published pass`, EXIT.IDENTITY);
                  }
                  const priorRequest = { schema: schemaForAction(args.action).request, environment: state.environment, project: state.project,
                    action: args.action, actionId: pending.actionId, operationId: state.operationId, approvalId: pending.approvalId,
                    generation: pending.generation, fencingEpoch: pending.fencingEpoch, leaseId: pending.leaseId,
                    holderId: pending.holderId, manifestDigest: releaseIdentity.manifestDigest, releaseIdentity, resourceIds,
                    runtimeEnvDigest: state.runtimeEnvDigest, commandDigest: pending.commandDigest,
                    ...(args.action === 'preprod-stage' ? { telegramEgressReceiptDigest: requestBody.telegramEgressReceiptDigest } : {}) };
                  if (pending.requestDigest !== sha256(priorRequest)) {
                    throw new ContractError(`resource ${resource.resourceId} prior pending request is invalid`, EXIT.IDENTITY);
                  }
                }
              } else if (resource.highestAcceptedFencingEpoch < state.fencingEpoch &&
                  resource.receiptChainHead !== expected.previousReceiptDigest) {
                throw new ContractError(`resource ${resource.resourceId} prior completion is outside the published pass vector`, EXIT.SINGLETON);
              }
            }
            const replayContext = { runner, env: plan.env || runtime.env || process.env,
              revalidateLease, statePath, adoptionReceipt: priorReceipt };
            const replay = spec.kind.includes('ingress')
              ? await verifyPublishedIngressState(plan, replayContext, priorReceipt)
              : await verifyCurrentExternalState(plan, replayContext);
            if (!runtime.planBuilder) await inspectTrustedRuntimeEnvironment(state, runtime);
            await passRegistryGate(plan, revalidateLease);
            for (let index = 0; index < locks.length; index += 1) {
              const lock = locks[index];
              const resource = vectorStates[index];
              if (resource.highestAcceptedFencingEpoch === state.fencingEpoch && resource.pendingAction === null) continue;
              const mutationAt = revalidateLease().observedAt.toISOString();
              if (resource.highestAcceptedFencingEpoch < state.fencingEpoch && resource.pendingAction) {
                await adoptPriorEpochPendingAction(lock, { fencingEpoch: resource.highestAcceptedFencingEpoch,
                  pendingAction: structuredClone(resource.pendingAction), receiptChainHead: resource.receiptChainHead }, {
                  environment: state.environment, project: state.project, resourceId: resource.resourceId,
                  fencingEpoch: state.fencingEpoch, operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest,
                  now: mutationAt }, priorReceipt.receiptDigest);
              } else {
                if (resource.highestAcceptedFencingEpoch < state.fencingEpoch) {
                  await acceptResourceEpoch(lock, { environment: state.environment, project: state.project,
                    resourceId: resource.resourceId, fencingEpoch: state.fencingEpoch, operationId: state.operationId,
                    manifestDigest: releaseIdentity.manifestDigest, action: args.action, actionId: args['action-id'], requestDigest,
                    approvalId: state.approvalId, leaseId: state.lease.leaseId, holderId: state.lease.holderId,
                    generation: state.generation, commandDigest: requestBody.commandDigest, now: mutationAt });
                }
                await completeResourceAction(lock, { environment: state.environment, project: state.project,
                  resourceId: resource.resourceId, fencingEpoch: state.fencingEpoch, operationId: state.operationId,
                  actionId: args['action-id'], requestDigest, now: revalidateLease().observedAt.toISOString() },
                priorReceipt.receiptDigest);
              }
              if (runtime.afterPublishedPassResourceRecovery) await runtime.afterPublishedPassResourceRecovery({
                recoveredCount: index + 1, resourceId: resource.resourceId,
              });
            }
            reconcileBinding.now = revalidateLease().observedAt.toISOString();
            await finalizeRecoveredResourceActionGroup(statePath, locks, reconcileBinding, priorReceipt.receiptDigest);
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
          revalidateLease, statePath });
        if (!runtime.planBuilder) await inspectTrustedRuntimeEnvironment(state, runtime);
        const { observedAt: recoveredAt } = await passRegistryGate(plan, revalidateLease);
        if (resourceStates.some((item) => item.pendingAction !== null)) {
          const recoveryBody = { schema: 'booking.external-action-recovery/v1', environment: state.environment, project: state.project,
            action: args.action, actionId: args['action-id'], operationId: state.operationId, fencingEpoch: state.fencingEpoch,
            manifestDigest: releaseIdentity.manifestDigest, releaseIdentity, requestDigest, originalReceiptDigest: priorReceipt.receiptDigest,
            recoveredAt: recoveredAt.toISOString(), readbackOutputDigest: replay.readbackOutputDigest, verification: replay.verification,
            resources: resourceStates.map((item) => ({ resourceId: item.resourceId, previousReceiptDigest: item.receiptChainHead, wasPending: item.pendingAction !== null })) };
          const recoveryReceipt = { ...recoveryBody, receiptDigest: sha256(recoveryBody) };
          revalidateLease();
          await writeExecutorRecoveryReceipt(statePath, recoveryReceipt);
          for (const lock of locks) {
            const mutationAt = revalidateLease().observedAt;
            await recoverResourceAction(lock, { environment: state.environment, project: state.project, resourceId: lock.resourceId,
              fencingEpoch: state.fencingEpoch, operationId: state.operationId, actionId: args['action-id'], requestDigest, now: mutationAt.toISOString() },
            [...acceptedPriorReceiptDigests], recoveryReceipt.receiptDigest);
          }
          reconcileBinding.now = revalidateLease().observedAt.toISOString();
          await finalizeRecoveredResourceActionGroup(statePath, locks, reconcileBinding, recoveryReceipt.receiptDigest);
          return recoveryReceipt;
        }
        if (priorReceipt.requestDigest === requestDigest) {
          reconcileBinding.now = revalidateLease().observedAt.toISOString();
          await finalizeRecoveredResourceActionGroup(statePath, locks, reconcileBinding, priorReceipt.receiptDigest);
        }
        return priorReceipt;
      }
      if (spec.kind.includes('ingress') && state.fencingEpoch >= 2) {
        const priorResources = [];
        for (const lock of locks) priorResources.push(await inspectLockedResourceState(lock, {
          environment: state.environment, project: state.project, resourceId: lock.resourceId,
        }));
        const priorPendingResources = priorResources.filter((resource) =>
          resource.pendingAction !== null && resource.highestAcceptedFencingEpoch < state.fencingEpoch);
        if (priorPendingResources.length !== 0) {
          const priorResource = priorPendingResources.find((resource) => resource.resourceId === state.resources.ingressRef) || priorPendingResources[0];
          const pendingSignature = priorResource && canonicalJson({ epoch: priorResource.highestAcceptedFencingEpoch,
            operationId: priorResource.operationId, manifestDigest: priorResource.manifestDigest, pendingAction: priorResource.pendingAction });
          const currentPendingMatches = (resource) => resource.pendingAction !== null &&
            resource.highestAcceptedFencingEpoch === state.fencingEpoch && resource.operationId === state.operationId &&
            resource.manifestDigest === releaseIdentity.manifestDigest && resource.pendingAction.action === args.action &&
            resource.pendingAction.actionId === args['action-id'] && resource.pendingAction.requestDigest === requestDigest &&
            resource.pendingAction.commandDigest === requestBody.commandDigest;
          if (!priorResource || priorPendingResources.some((resource) =>
            canonicalJson({ epoch: resource.highestAcceptedFencingEpoch, operationId: resource.operationId,
              manifestDigest: resource.manifestDigest, pendingAction: resource.pendingAction }) !== pendingSignature) ||
              priorResources.some((resource) => !priorPendingResources.includes(resource) && !currentPendingMatches(resource)) ||
              priorResource.operationId !== state.operationId || priorResource.manifestDigest !== releaseIdentity.manifestDigest) {
            throw new ContractError('prior pending ingress resource identity cannot be recovered', EXIT.INGRESS);
          }
          const runner = runtime.commandRunner || defaultCommandRunner;
          const priorIdentity = priorPendingIngressPlan(state, args, releaseIdentity, priorResource, plan, resourceIds);
          const priorRecorded = await readExecutorReceipt(statePath, priorResource.highestAcceptedFencingEpoch,
            args.action, priorResource.pendingAction.actionId);
          const priorReceiptMode = priorRecorded?.status || 'missing';
          if (priorRecorded) {
            const canonical = await readCanonicalExecutorReceiptByDigest(statePath, priorRecorded.receiptDigest);
            if (canonicalJson(canonical.receipt) !== canonicalJson(priorRecorded) ||
                priorRecorded.schema !== schemaForAction(args.action).receipt || priorRecorded.action !== args.action ||
                priorRecorded.actionId !== priorResource.pendingAction.actionId || priorRecorded.operationId !== state.operationId ||
                priorRecorded.fencingEpoch !== priorResource.highestAcceptedFencingEpoch ||
                priorRecorded.requestDigest !== priorResource.pendingAction.requestDigest ||
                priorRecorded.requestDigest !== sha256(priorIdentity.priorRequest) ||
                canonicalJson(priorRecorded.releaseIdentity) !== canonicalJson(releaseIdentity) ||
                canonicalJson(priorRecorded.resourceIds) !== canonicalJson(resourceIds)) {
              throw new ContractError('prior pending ingress receipt is not bound to the exact old-fence request', EXIT.INGRESS);
            }
          }
          let priorProof = null;
          let priorProofOutput = null;
          let notApplied = null;
          let leaseWindow = await passRegistryGate(plan, revalidateLease);
          const priorReadback = await runner(plan.readback.executable, plan.readback.argv, {
            cwd: plan.cwd, env: plan.env || runtime.env || process.env, timeoutMs: leaseWindow.timeoutMs,
          });
          if (priorReadback?.exitCode === 0 && !priorReadback.signal && !priorReadback.overflow) {
            priorProof = verifyPriorPendingIngress(priorReadback, state, args, releaseIdentity, priorResource, priorIdentity);
            priorProofOutput = priorReadback.stdout;
          } else {
            leaseWindow = await passRegistryGate(plan, revalidateLease);
            const recovered = await runner(plan.executable, priorIdentity.recoveryArgv, {
              cwd: plan.cwd, env: plan.env || runtime.env || process.env, timeoutMs: leaseWindow.timeoutMs,
            });
            assertResult(recovered, EXIT.INGRESS);
            let recoveryValue;
            try { recoveryValue = JSON.parse(recovered.stdout); }
            catch { throw new ContractError('prior pending ingress recovery is not JSON', EXIT.INGRESS); }
            if (recoveryValue?.schema === 'booking.ingress-readback/v3') {
              priorProof = verifyPriorPendingIngress(recovered, state, args, releaseIdentity, priorResource, priorIdentity);
              priorProofOutput = recovered.stdout;
            } else {
              const pending = priorIdentity.pending;
              const expectedSequence = args.action === 'preprod-rollback-ingress' ? 2 : (state.rollbackRehearsalCompleted ? 3 : 1);
              const expectedRecoveryKeys = ['schema', 'outcome', 'project', 'hostname', 'edgeNetwork', 'logicalAlias', 'fixedRemoteService',
                'aliasState', 'operationId', 'actionKind', 'actionId', 'sequence', 'fencingEpoch', 'previousProofDigest', 'guard', 'observedAt'];
              const recoveryGuard = recoveryValue?.guard;
              if (!recoveryValue || Object.keys(recoveryValue).sort().join(',') !== expectedRecoveryKeys.sort().join(',') ||
                  recoveryValue.schema !== 'booking.ingress-pending-recovery/v2' || recoveryValue.outcome !== 'not-applied' ||
                  recoveryValue.project !== state.project || recoveryValue.hostname !== 'booking-preprod.happybooking.uk' ||
                  recoveryValue.edgeNetwork !== state.resources.edgeNetwork || recoveryValue.logicalAlias !== 'gateway-green' ||
                  recoveryValue.fixedRemoteService !== 'http://gateway-green:8080' || recoveryValue.aliasState !== 'previous' ||
                  recoveryValue.operationId !== state.operationId || recoveryValue.actionKind !== args.action ||
                  recoveryValue.actionId !== pending.actionId || recoveryValue.sequence !== expectedSequence ||
                  recoveryValue.fencingEpoch !== pending.fencingEpoch ||
                  (recoveryValue.previousProofDigest !== null && !DIGEST.test(recoveryValue.previousProofDigest || '')) ||
                  !recoveryGuard || Object.keys(recoveryGuard).sort().join(',') !==
                    ['mode', 'convergence', 'fencedResources', 'cloudflareMutationAllowed'].sort().join(',') ||
                  recoveryGuard.mode !== 'local-docker-network-alias' ||
                  recoveryGuard.convergence !== 'previous-desired-in-flight-readback' ||
                  canonicalJson([...(recoveryGuard.fencedResources || [])].sort()) !== canonicalJson(['booking-preprod-edge', 'ingress:booking-preprod'].sort()) ||
                  recoveryGuard.cloudflareMutationAllowed !== false ||
                  !Number.isFinite(Date.parse(recoveryValue.observedAt))) {
                throw new ContractError('prior pending ingress not-applied proof is invalid', EXIT.INGRESS);
              }
              notApplied = recoveryValue;
            }
          }
          if (priorReceiptMode === 'pass' && notApplied) {
            throw new ContractError('prior ingress pass receipt conflicts with not-applied remote evidence', EXIT.INGRESS);
          }
          let preflightArtifactEvidence = null;
          if (plan.preflightArtifacts) {
            leaseWindow = revalidateLease();
            preflightArtifactEvidence = await plan.preflightArtifacts({ runner,
              env: plan.env || runtime.env || process.env, timeoutMs: leaseWindow.timeoutMs, statePath });
          }
          if (notApplied) {
            const { observedAt: supersededAt } = await passRegistryGate(plan, revalidateLease);
            let supersededCount = 0;
            for (const lock of locks) {
              const resource = priorResources.find((item) => item.resourceId === lock.resourceId);
              if (currentPendingMatches(resource)) continue;
              await supersedePriorEpochPendingAction(lock, {
                fencingEpoch: resource.highestAcceptedFencingEpoch,
                pendingAction: structuredClone(resource.pendingAction), receiptChainHead: resource.receiptChainHead,
              }, { environment: state.environment, project: state.project, resourceId: resource.resourceId,
                fencingEpoch: state.fencingEpoch, operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest,
                action: args.action, actionId: args['action-id'], requestDigest, approvalId: state.approvalId,
                leaseId: state.lease.leaseId, holderId: state.lease.holderId, generation: state.generation,
                commandDigest: requestBody.commandDigest, now: supersededAt.toISOString() });
              supersededCount += 1;
              if (runtime.afterIngressResourceSupersede) await runtime.afterIngressResourceSupersede({ supersededCount, resourceId: resource.resourceId });
            }
          }
          let execution = null;
          let executionVerification = null;
          let readback = null;
          let verification = priorProof;
          if (notApplied) {
            leaseWindow = await passRegistryGate(plan, revalidateLease, 1_000);
            execution = await runner(plan.executable, plan.argv, { cwd: plan.cwd, env: plan.env || runtime.env || process.env,
              timeoutMs: leaseWindow.timeoutMs });
            assertResult(execution, EXIT.INGRESS);
            executionVerification = plan.readback.verify(execution.stdout);
            leaseWindow = await passRegistryGate(plan, revalidateLease);
            readback = await runner(plan.readback.executable, plan.readback.argv, { cwd: plan.cwd,
              env: plan.env || runtime.env || process.env, timeoutMs: leaseWindow.timeoutMs });
            assertResult(readback, EXIT.INGRESS);
            verification = plan.readback.verify(readback.stdout);
          }
          const artifactVerifier = plan.verifyArtifacts;
          leaseWindow = await passRegistryGate(plan, revalidateLease);
          const artifactVerification = artifactVerifier ? await artifactVerifier({ runner, env: plan.env || runtime.env || process.env,
            timeoutMs: leaseWindow.timeoutMs, statePath, revalidateLease, preflightEvidence: preflightArtifactEvidence }) : null;
          if (!runtime.planBuilder) await inspectTrustedRuntimeEnvironment(state, runtime);
          const { observedAt: completedAt } = await passRegistryGate(plan, revalidateLease);
          const receiptBody = { ...requestBody, schema: schemaForAction(args.action).receipt, requestDigest,
            startedAt: firstNow.toISOString(), completedAt: completedAt.toISOString(), status: 'pass',
            executionOutputDigest: sha256(execution?.stdout || ''),
            readbackOutputDigest: sha256(readback?.stdout || priorProofOutput || ''),
            verification: { ...(executionVerification ? { execution: executionVerification } : {}), runtime: verification,
              ...(artifactVerification ? { artifacts: artifactVerification } : {}),
              adoption: { mode: notApplied ? 'prior-pending-proven-not-applied-and-retried' : 'prior-pending-proven-applied-read-only',
                priorReceiptMode,
                priorProofDigest: priorProof?.proofDigest || notApplied.previousProofDigest,
                priorFencingEpoch: priorResource.highestAcceptedFencingEpoch,
                priorRequestDigest: priorResource.pendingAction.requestDigest } },
            resources: priorResources.map((resource) => ({ resourceId: resource.resourceId,
              highestAcceptedFencingEpoch: state.fencingEpoch, previousReceiptDigest: resource.receiptChainHead })) };
          const receipt = { ...receiptBody, receiptDigest: sha256(receiptBody) };
          revalidateLease();
          await writeExecutorReceipt(statePath, receipt);
          if (runtime.afterIngressPassWrite) await runtime.afterIngressPassWrite();
          if (notApplied) {
            const mutationAt = revalidateLease().observedAt;
            for (const lock of locks) await completeResourceAction(lock, { environment: state.environment, project: state.project,
              resourceId: lock.resourceId, fencingEpoch: state.fencingEpoch, operationId: state.operationId,
              actionId: args['action-id'], requestDigest, now: mutationAt.toISOString() }, receipt.receiptDigest);
          } else {
            const mutationAt = revalidateLease().observedAt;
            for (let index = 0; index < locks.length; index += 1) {
              const resource = priorPendingResources.find((item) => item.resourceId === locks[index].resourceId);
              await adoptPriorEpochPendingAction(locks[index], { fencingEpoch: resource.highestAcceptedFencingEpoch,
                pendingAction: structuredClone(resource.pendingAction), receiptChainHead: resource.receiptChainHead }, {
                environment: state.environment, project: state.project, resourceId: resource.resourceId,
                fencingEpoch: state.fencingEpoch, operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest,
                now: mutationAt.toISOString() }, receipt.receiptDigest);
              if (runtime.afterIngressResourceAdopt) await runtime.afterIngressResourceAdopt({ adoptedCount: index + 1, resourceId: resource.resourceId });
            }
          }
          return receipt;
        }
      }
      const allowedPreviousManifestDigest = spec.kind === 'failed-active-runtime-restore'
        ? state.candidate?.manifestDigest
        : spec.identity === 'rollback' && state.phase === 'ROLLBACK_PENDING'
        ? (state.candidate || state.active)?.manifestDigest
        : args.action === 'preprod-prepare-telegram-egress' && state.phase === 'ROLLED_BACK'
        ? state.active?.manifestDigest
        : (['preprod-stage', 'preprod-transfer-singletons', 'preprod-switch-ingress'].includes(args.action) && state.candidate &&
          state.active.manifestDigest !== state.candidate.manifestDigest ? state.active.manifestDigest : null);
      const resourceStatesBeforeAction = [];
      if (TAKEOVER_ADOPTABLE_ACTIONS.has(args.action) && state.fencingEpoch >= 2) {
        if (args.action === 'preprod-restore-active-runtime') {
          for (const lock of locks) resourceStatesBeforeAction.push(await readRecoveryResourceState(statePath, state, lock.resourceId, false,
            [state.resources.edgeNetwork, state.resources.ingressRef].includes(lock.resourceId)));
          if (resourceStatesBeforeAction.some((resource) => resource.missingVirgin)) resourceStatesBeforeAction.length = 0;
        } else {
          for (const lock of locks) resourceStatesBeforeAction.push(await inspectLockedResourceState(lock, {
            environment: state.environment, project: state.project, resourceId: lock.resourceId,
          }));
        }
      }
      const priorPartialRecovery = resourceStatesBeforeAction.length
        ? await recoverPriorActionByDesiredReadback({ statePath, state, args, releaseIdentity, resourceIds,
          resourceStates: resourceStatesBeforeAction, locks, requestBody, requestDigest, plan,
          runner, runtime, revalidateLease })
        : null;
      if (priorPartialRecovery) return priorPartialRecovery;
      const adoption = resourceStatesBeforeAction.length
        ? (args.action === 'preprod-restore-active-runtime' && resourceStatesBeforeAction.some((resource) =>
          resource.manifestDigest !== releaseIdentity.manifestDigest)
          ? null
          : await takeoverAdoption(statePath, state, args, releaseIdentity, resourceIds, resourceStatesBeforeAction))
        : null;
      if (adoption) {
        await passRegistryGate(plan, revalidateLease);
        const accepted = [];
        for (const lock of locks) {
          const mutationAt = revalidateLease().observedAt;
          accepted.push(await acceptResourceEpoch(lock, {
            environment: state.environment, project: state.project, resourceId: lock.resourceId, fencingEpoch: state.fencingEpoch,
            operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest, allowedPreviousManifestDigest,
            action: args.action, actionId: args['action-id'], requestDigest, approvalId: state.approvalId,
            leaseId: state.lease.leaseId, holderId: state.lease.holderId, generation: state.generation,
            commandDigest: requestBody.commandDigest, now: mutationAt.toISOString(),
          }));
        }
        let replay;
        try {
          replay = await verifyCurrentExternalState(plan, { runner, env: plan.env || runtime.env || process.env,
            revalidateLease, statePath,
            adoptionReceipt: adoption.receipt });
          if (!runtime.planBuilder) await inspectTrustedRuntimeEnvironment(state, runtime);
          await passRegistryGate(plan, revalidateLease);
        } catch (error) {
          let failedAt;
          try { failedAt = revalidateLease(0).observedAt; } catch { throw error; }
          const failureBody = { ...requestBody, schema: schemaForAction(args.action).receipt, requestDigest,
            startedAt: firstNow.toISOString(), completedAt: failedAt.toISOString(),
            status: 'fail', executionOutputDigest: sha256(''), readbackOutputDigest: sha256(''),
            verification: { error: error instanceof ContractError ? error.message : 'takeover adoption readback failed' },
            resources: accepted.map((item) => ({ resourceId: item.resourceId, highestAcceptedFencingEpoch: item.highestAcceptedFencingEpoch,
              previousReceiptDigest: item.receiptChainHead })) };
          revalidateLease(0);
          await writeExecutorReceipt(statePath, { ...failureBody, receiptDigest: sha256(failureBody) });
          throw error;
        }
        const completedAt = revalidateLease().observedAt;
        const receiptBody = { ...requestBody, schema: schemaForAction(args.action).receipt, requestDigest,
          startedAt: firstNow.toISOString(), completedAt: completedAt.toISOString(), status: 'pass', executionOutputDigest: sha256(''),
          readbackOutputDigest: replay.readbackOutputDigest,
          verification: { ...replay.verification, adoption: { priorReceiptDigest: adoption.acceptedReceipt.receiptDigest,
            priorFencingEpoch: adoption.receipt.fencingEpoch, mode: 'independent-readback' } },
          resources: accepted.map((item) => ({ resourceId: item.resourceId, highestAcceptedFencingEpoch: item.highestAcceptedFencingEpoch,
            previousReceiptDigest: item.receiptChainHead })) };
        const receipt = { ...receiptBody, receiptDigest: sha256(receiptBody) };
        revalidateLease();
        await writeExecutorReceipt(statePath, receipt);
        for (const lock of locks) {
          const mutationAt = revalidateLease().observedAt;
          await completeResourceAction(lock, { environment: state.environment, project: state.project, resourceId: lock.resourceId,
            fencingEpoch: state.fencingEpoch, operationId: state.operationId, actionId: args['action-id'], requestDigest,
            now: mutationAt.toISOString() }, receipt.receiptDigest);
        }
        return receipt;
      }
      let preflightArtifactEvidence = null;
      let preflightVerification = null;
      if (plan.preflight) {
        const leaseWindow = await passRegistryGate(plan, revalidateLease, 1_000);
        const preflight = await runner(plan.preflight.executable, plan.preflight.argv, { cwd: plan.cwd, env: plan.env || runtime.env || process.env,
          timeoutMs: leaseWindow.timeoutMs });
        assertResult(preflight, EXIT.IDENTITY);
        preflightVerification = plan.preflight.verify(preflight.stdout);
      }
      if (plan.preflightArtifacts) {
        const leaseWindow = revalidateLease(1_000);
        preflightArtifactEvidence = await plan.preflightArtifacts({ runner, env: plan.env || runtime.env || process.env,
          timeoutMs: leaseWindow.timeoutMs, revalidateLease, statePath });
      }
      await passRegistryGate(plan, revalidateLease);
      const accepted = failedDatabaseContinuity?.accepted ? [...failedDatabaseContinuity.accepted]
        : (probeContinuity?.accepted ? [...probeContinuity.accepted] : (resumeUnstartedGroup ? [...resumeUnstartedGroup.resources] : []));
      let actionGroupBinding = null;
      if (!failedDatabaseContinuity?.accepted && !probeContinuity?.accepted) {
        const mutationAt = revalidateLease().observedAt;
        actionGroupBinding = {
          environment: state.environment, project: state.project, fencingEpoch: state.fencingEpoch,
          operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest, allowedPreviousManifestDigest,
          action: args.action, actionId: args['action-id'], requestDigest, approvalId: state.approvalId,
          leaseId: state.lease.leaseId, holderId: state.lease.holderId, generation: state.generation,
          commandDigest: requestBody.commandDigest, now: mutationAt.toISOString(),
        };
        if (!resumeUnstartedGroup) {
          const group = await acceptResourceActionGroup(statePath, locks, actionGroupBinding);
          accepted.push(...group.states);
        }
      }
      let execution;
      let readback;
      let verification;
      let completedAt;
      try {
        let leaseWindow = await passRegistryGate(plan, revalidateLease, 1_000);
        if (actionGroupBinding) {
          actionGroupBinding.now = revalidateLease().observedAt.toISOString();
          if (!resumeUnstartedGroup) await markResourceActionGroupMutating(statePath, actionGroupBinding, resourceIds);
          actionGroupBinding.now = revalidateLease().observedAt.toISOString();
          await markResourceActionGroupExecuting(statePath, actionGroupBinding, resourceIds);
        }
        execution = await runner(plan.executable, plan.argv, { cwd: plan.cwd, env: plan.env || runtime.env || process.env,
          timeoutMs: leaseWindow.timeoutMs });
        assertResult(execution, spec.kind === 'compose-migrate' || spec.kind === 'compose-baseline' ? EXIT.DATABASE : spec.kind.includes('webhook') || spec.kind.includes('ingress') ? EXIT.INGRESS : EXIT.SWITCH);
        const executionVerification = plan.verifyExecution ? plan.verifyExecution(execution.stdout) : null;
        readback = execution;
        if (plan.readback) {
          leaseWindow = await passRegistryGate(plan, revalidateLease);
          readback = await runner(plan.readback.executable, plan.readback.argv, { cwd: plan.cwd,
            env: plan.env || runtime.env || process.env, timeoutMs: leaseWindow.timeoutMs });
          assertResult(readback, spec.kind === 'compose-migrate' ? EXIT.DATABASE : spec.kind.includes('ingress') ? EXIT.INGRESS : EXIT.READINESS);
        }
        verification = { ...(preflightVerification ? { preflight: preflightVerification } : {}),
          ...(executionVerification ? { execution: executionVerification } : {}), runtime: (plan.readback?.verify || plan.verify)(readback.stdout) };
        if (probeContinuity?.verification) verification.retry = probeContinuity.verification;
        if (failedDatabaseContinuity?.verification) verification.continuity = failedDatabaseContinuity.verification;
        if (plan.verifyArtifacts) {
          leaseWindow = await passRegistryGate(plan, revalidateLease);
          verification.artifacts = await plan.verifyArtifacts({ runner, env: plan.env || runtime.env || process.env,
            timeoutMs: leaseWindow.timeoutMs, statePath, revalidateLease, preflightEvidence: preflightArtifactEvidence });
        }
        if (!runtime.planBuilder) await inspectTrustedRuntimeEnvironment(state, runtime);
        completedAt = (await passRegistryGate(plan, revalidateLease)).observedAt;
      } catch (error) {
        let failedAt;
        try { failedAt = revalidateLease(0).observedAt; } catch { throw error; }
        const failureBody = { ...requestBody, schema: schemaForAction(args.action).receipt, requestDigest, startedAt: firstNow.toISOString(),
          completedAt: failedAt.toISOString(), status: 'fail',
          executionOutputDigest: sha256(execution?.stdout || ''), readbackOutputDigest: sha256(readback?.stdout || ''),
          verification: { error: error instanceof ContractError ? error.message : 'external action failed' },
          resources: accepted.map((item) => ({ resourceId: item.resourceId, highestAcceptedFencingEpoch: item.highestAcceptedFencingEpoch, previousReceiptDigest: item.receiptChainHead })) };
        const failureReceipt = { ...failureBody, receiptDigest: sha256(failureBody) };
        revalidateLease(0);
        await writeExecutorReceipt(statePath, failureReceipt);
        if (actionGroupBinding) {
          actionGroupBinding.now = revalidateLease(0).observedAt.toISOString();
          await markResourceActionGroupReceipt(statePath, actionGroupBinding, resourceIds, failureReceipt.receiptDigest, 'fail');
        }
        throw error;
      }
      const receiptBody = { ...requestBody, schema: schemaForAction(args.action).receipt, requestDigest, startedAt: firstNow.toISOString(), completedAt: completedAt.toISOString(),
        status: 'pass', executionOutputDigest: sha256(execution.stdout), readbackOutputDigest: sha256(readback.stdout), verification,
        resources: accepted.map((item) => ({ resourceId: item.resourceId, highestAcceptedFencingEpoch: item.highestAcceptedFencingEpoch, previousReceiptDigest: item.receiptChainHead })) };
      const receipt = { ...receiptBody, receiptDigest: sha256(receiptBody) };
      revalidateLease();
      await writeExecutorReceipt(statePath, receipt);
      if (actionGroupBinding) {
        actionGroupBinding.now = revalidateLease().observedAt.toISOString();
        await markResourceActionGroupReceipt(statePath, actionGroupBinding, resourceIds, receipt.receiptDigest, 'pass');
        await completeResourceActionGroup(statePath, locks, actionGroupBinding, receipt.receiptDigest);
      } else {
        for (const lock of locks) {
          const mutationAt = revalidateLease().observedAt;
          await completeResourceAction(lock, { environment: state.environment, project: state.project, resourceId: lock.resourceId,
            fencingEpoch: state.fencingEpoch, operationId: state.operationId, actionId: args['action-id'], requestDigest, now: mutationAt.toISOString() },
          receipt.receiptDigest);
        }
      }
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
