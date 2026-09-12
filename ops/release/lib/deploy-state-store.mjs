import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ContractError, EXIT, canonicalJson, sha256 } from './contracts.mjs';

const CONTROL_CONTAINER_NAME = 'booking-preprod-control-plane';
import { validateDeployState } from './state-machine.mjs';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RELEASE_ID = /^booking-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const EVIDENCE_KEYS = new Set(['baselineReceiptDigest', 'expandMigrationReceiptDigest', 'stageReceiptDigest', 'candidateProbeDigest',
  'rollbackPreSwitchProbeDigest', 'singletonTransferReceiptDigest', 'switchReceiptDigest', 'webhookReceiptDigest',
  'observationReceiptDigest', 'rollbackReceiptDigest', 'rollbackSingletonTransferReceiptDigest', 'rolledBackProbeDigest']);
const RECOVERY_KEYS = new Set(['databaseRestoreReceiptDigest', 'telegramAbortReceiptDigest', 'activeRuntimeRestoreReceiptDigest',
  'activeProbeDigest', 'priorFailedStateDigest']);
const RECEIPT_KEYS = new Set(['schema', 'environment', 'project', 'generation', 'fencingEpoch', 'operationId', 'approvalId',
  'terminalPhase', 'previousReceiptDigest', 'terminalStateDigest', 'activeIdentity', 'evidence', 'receiptDigest']);

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError(`${label} must be an object`, EXIT.IDENTITY);
  for (const key of expected) if (!Object.hasOwn(value, key)) throw new ContractError(`${label}.${key} is required`, EXIT.IDENTITY);
  for (const key of Object.keys(value)) if (!expected.has(key)) throw new ContractError(`${label}.${key} is not allowed`, EXIT.IDENTITY);
}

function validateReleaseIdentity(identity) {
  const keys = new Set(['slot', 'releaseId', 'gitSha', 'manifestDigest']);
  exactKeys(identity, keys, 'deployment receipt activeIdentity');
  if (!['blue', 'green'].includes(identity.slot) || !RELEASE_ID.test(identity.releaseId || '') ||
      !GIT_SHA.test(identity.gitSha || '') || !DIGEST.test(identity.manifestDigest || '')) {
    throw new ContractError('deployment receipt activeIdentity is invalid', EXIT.IDENTITY);
  }
}

function validateDigestObject(value, keys, label, nullable = false) {
  exactKeys(value, keys, label);
  for (const [key, digest] of Object.entries(value)) {
    if ((!nullable || digest !== null) && !DIGEST.test(digest || '')) {
      throw new ContractError(`${label}.${key} is invalid`, EXIT.IDENTITY);
    }
  }
}

export function validateDeployReceipt(receipt) {
  const isV1 = receipt?.schema === 'booking.deploy-receipt/v1';
  const isV2 = receipt?.schema === 'booking.deploy-receipt/v2';
  if (!isV1 && !isV2) throw new ContractError('deployment receipt schema is unsupported', EXIT.IDENTITY);
  exactKeys(receipt, isV2 ? new Set([...RECEIPT_KEYS, 'recovery']) : RECEIPT_KEYS, 'deployment receipt');
  const expectedProject = receipt.environment === 'preprod' ? 'booking-preprod'
    : receipt.environment === 'production' ? 'booking-prod' : null;
  if (!expectedProject || receipt.project !== expectedProject) throw new ContractError('deployment receipt environment/project is invalid', EXIT.IDENTITY);
  if (!Number.isInteger(receipt.generation) || receipt.generation < 1 ||
      !Number.isInteger(receipt.fencingEpoch) || receipt.fencingEpoch < 1) {
    throw new ContractError('deployment receipt generation or fencing epoch is invalid', EXIT.IDENTITY);
  }
  if (!IDENTIFIER.test(receipt.operationId || '') || !IDENTIFIER.test(receipt.approvalId || '')) {
    throw new ContractError('deployment receipt operation identity is invalid', EXIT.IDENTITY);
  }
  if ((isV1 && !['COMMITTED', 'ROLLED_BACK'].includes(receipt.terminalPhase)) ||
      (isV2 && receipt.terminalPhase !== 'FAILED_RECOVERED')) {
    throw new ContractError('deployment receipt schema and terminal phase do not match', EXIT.IDENTITY);
  }
  if ((receipt.previousReceiptDigest !== null && !DIGEST.test(receipt.previousReceiptDigest || '')) ||
      !DIGEST.test(receipt.terminalStateDigest || '') || !DIGEST.test(receipt.receiptDigest || '')) {
    throw new ContractError('deployment receipt digest field is invalid', EXIT.IDENTITY);
  }
  validateReleaseIdentity(receipt.activeIdentity);
  validateDigestObject(receipt.evidence, EVIDENCE_KEYS, 'deployment receipt evidence', true);
  if (isV2) validateDigestObject(receipt.recovery, RECOVERY_KEYS, 'deployment receipt recovery');
  const { receiptDigest, ...body } = receipt;
  if (sha256(body) !== receiptDigest) throw new ContractError('deployment receipt integrity check failed', EXIT.IDENTITY);
  return receipt;
}

function sameIdentity(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

/** Verify only the canonical chain reachable from state.receiptChainHead.
 * Orphan files are deliberately ignored because a crash after immutable
 * receipt creation but before the state CAS may leave the exact retry receipt.
 */
export async function verifyCanonicalDeployReceiptChain(statePath, state, { mode, nextGeneration } = {}) {
  if (state.receiptChainHead === null) {
    if (mode === 'acquire' && (state.phase !== 'IDLE' || state.generation !== 0 || state.fencingEpoch !== 0)) {
      throw new ContractError('non-genesis idle deployment state requires a receipt chain head', EXIT.IDENTITY);
    }
    return [];
  }
  if (!DIGEST.test(state.receiptChainHead || '')) throw new ContractError('deployment receipt chain head is invalid', EXIT.IDENTITY);
  const receiptDirectory = join(dirname(statePath), 'receipts');
  let names;
  try { names = await readdir(receiptDirectory); }
  catch (error) {
    if (error?.code === 'ENOENT') throw new ContractError('deployment receipt chain directory is missing', EXIT.IDENTITY);
    throw new ContractError('deployment receipt chain directory is unreadable', EXIT.IDENTITY);
  }
  const parsed = [];
  for (const name of names) {
    if (!/^\d{12}\.json$/.test(name)) continue;
    try { parsed.push({ name, receipt: JSON.parse(await readFile(join(receiptDirectory, name), 'utf8')) }); }
    catch { /* An unreachable crash orphan is not part of the canonical chain. */ }
  }
  const chain = [];
  const visited = new Set();
  let digest = state.receiptChainHead;
  let upperGeneration = mode === 'acquire' ? state.generation + 1 : nextGeneration;
  while (digest !== null) {
    if (visited.has(digest)) throw new ContractError('deployment receipt chain contains a cycle', EXIT.IDENTITY);
    visited.add(digest);
    const candidates = parsed.filter(({ receipt }) => receipt?.receiptDigest === digest);
    const canonical = candidates.find(({ name, receipt }) => name === `${String(receipt?.generation).padStart(12, '0')}.json`);
    if (!canonical) throw new ContractError(`deployment receipt is not present at its canonical generation filename: ${digest}`, EXIT.IDENTITY);
    const receipt = validateDeployReceipt(canonical.receipt);
    if (receipt.environment !== state.environment || receipt.project !== state.project) {
      throw new ContractError('deployment receipt chain environment/project mismatch', EXIT.IDENTITY);
    }
    if (!Number.isInteger(upperGeneration) || receipt.generation >= upperGeneration) {
      throw new ContractError('deployment receipt chain generations are not strictly decreasing', EXIT.IDENTITY);
    }
    if (chain.length === 0 && mode === 'acquire') {
      if (receipt.generation !== state.generation || !sameIdentity(receipt.activeIdentity, state.active)) {
        throw new ContractError('idle deployment state is not bound to its terminal receipt head', EXIT.IDENTITY);
      }
    }
    chain.push(receipt);
    upperGeneration = receipt.generation;
    digest = receipt.previousReceiptDigest;
  }
  return chain;
}

async function acquireFileLock(statePath, { nowMs = Date.now() } = {}) {
  const lockPath = `${statePath}.lock`;
  let createdHandle;
  try {
    createdHandle = await open(lockPath, 'wx', 0o600);
    const ownerContainerId = /^[0-9a-f]{12,64}$/.test(process.env.HOSTNAME || '') ? process.env.HOSTNAME : null;
    await createdHandle.writeFile(`${JSON.stringify({ pid: process.pid, ownerContainerId, ownerContainerName: CONTROL_CONTAINER_NAME,
      acquiredAt: new Date(nowMs).toISOString(), nonce: randomUUID() })}\n`);
    await createdHandle.sync();
    return { handle: createdHandle, lockPath };
  } catch (error) {
    if (createdHandle) {
      await createdHandle.close().catch(() => {});
      await unlink(lockPath).catch(() => {});
    }
    if (error?.code === 'EEXIST') throw new ContractError(`deployment state lock exists and requires explicit forensic recovery: ${lockPath}`, EXIT.SINGLETON);
    throw new ContractError(`cannot acquire state lock: ${lockPath}`, EXIT.SINGLETON);
  }
}

async function assertDeadOwner(lock, ownerContainerProbe) {
  if (!Number.isSafeInteger(lock.pid) || lock.pid < 1 || !/^[0-9a-f]{12,64}$/.test(lock.ownerContainerId || '') ||
      lock.ownerContainerName !== CONTROL_CONTAINER_NAME ||
      typeof ownerContainerProbe !== 'function') {
    throw new ContractError('stale deployment lock lacks a verifiable Docker owner identity', EXIT.IDENTITY);
  }
  const alive = await ownerContainerProbe(lock.ownerContainerId, lock.ownerContainerName);
  if (alive !== false) throw new ContractError(alive === true ? 'deployment state lock owner is still alive' :
    'stale deployment lock owner liveness is indeterminate', EXIT.SINGLETON);
}

function parseRecoverableLock(bytes, label) {
  let value;
  try { value = JSON.parse(bytes); } catch { throw new ContractError(`${label} lock is not valid JSON`, EXIT.IDENTITY); }
  const keys = Object.keys(value || {}).sort();
  if (keys.join(',') !== ['acquiredAt', 'nonce', 'ownerContainerId', 'ownerContainerName', 'pid'].sort().join(',') ||
      !Number.isFinite(Date.parse(value.acquiredAt)) || !IDENTIFIER.test(value.nonce || '') ||
      !/^[0-9a-f]{12,64}$/.test(value.ownerContainerId || '') || value.ownerContainerName !== CONTROL_CONTAINER_NAME) {
    throw new ContractError(`${label} lock identity is invalid`, EXIT.IDENTITY);
  }
  return value;
}

/**
 * Explicitly remove one abandoned deployment lock. This is deliberately not
 * called by normal lock acquisition: the caller must bind the exact lock and
 * state bytes, prove the recorded lease expired, and prove the PID is dead.
 */
export async function recoverStaleDeployStateLock(statePath, {
  expectedLockDigest, expectedStateDigest, nowMs = Date.now(), ownerContainerProbe,
} = {}) {
  if (!DIGEST.test(expectedLockDigest || '') || !DIGEST.test(expectedStateDigest || '') || !Number.isFinite(nowMs)) {
    throw new ContractError('stale deployment lock recovery requires exact lock/state digests and trusted time', EXIT.IDENTITY);
  }
  const lockPath = `${statePath}.lock`;
  const stateBytes = await readFile(statePath, 'utf8').catch(() => {
    throw new ContractError('deployment state is unavailable for lock recovery', EXIT.SWITCH);
  });
  const lockBytes = await readFile(lockPath, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (sha256(stateBytes) !== expectedStateDigest) {
    throw new ContractError('stale deployment lock recovery digest mismatch', EXIT.IDENTITY);
  }
  const state = validateDeployState(JSON.parse(stateBytes));
  if (!state.lease || !Number.isFinite(Date.parse(state.lease.expiresAt)) || Date.parse(state.lease.expiresAt) >= nowMs) {
    throw new ContractError('deployment lease is not expired', EXIT.SINGLETON);
  }
  const directory = join(dirname(statePath), 'executor', 'lock-recoveries');
  if (lockBytes === null) {
    let names = [];
    try { names = await readdir(directory); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const matches = [];
    for (const name of names.filter((item) => /^deploy-[0-9a-f]{64}\.json$/.test(item))) {
      let receipt;
      try { receipt = JSON.parse(await readFile(join(directory, name), 'utf8')); } catch { continue; }
      const { receiptDigest, ...body } = receipt || {};
      if (receipt?.schema === 'booking.lock-recovery/v1' && receipt.kind === 'deployment' &&
          receipt.lockDigest === expectedLockDigest && receipt.stateDigest === expectedStateDigest &&
          receipt.environment === state.environment && receipt.project === state.project &&
          receipt.operationId === state.operationId && receipt.generation === state.generation &&
          receipt.fencingEpoch === state.fencingEpoch && receiptDigest === sha256(body) &&
          name === `deploy-${receiptDigest.slice(7)}.json`) matches.push(receipt);
    }
    if (matches.length !== 1) throw new ContractError('missing deployment lock has no unique immutable recovery receipt', EXIT.IDENTITY);
    return matches[0];
  }
  if (sha256(lockBytes) !== expectedLockDigest) {
    throw new ContractError('stale deployment lock recovery digest mismatch', EXIT.IDENTITY);
  }
  const lock = parseRecoverableLock(lockBytes, 'deployment');
  await assertDeadOwner(lock, ownerContainerProbe);
  const body = {
    schema: 'booking.lock-recovery/v1', kind: 'deployment', environment: state.environment, project: state.project,
    operationId: state.operationId, generation: state.generation, fencingEpoch: state.fencingEpoch,
    lockDigest: expectedLockDigest, stateDigest: expectedStateDigest, deadPid: lock.pid,
    deadOwnerContainerId: lock.ownerContainerId, deadOwnerContainerName: lock.ownerContainerName,
    leaseExpiredAt: state.lease.expiresAt, recoveredAt: new Date(nowMs).toISOString(),
  };
  const receipt = { ...body, receiptDigest: sha256(body) };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeImmutableJson(join(directory, `deploy-${receipt.receiptDigest.slice(7)}.json`), receipt);
  // Re-read immediately before unlink so a replacement or edited lock can
  // never be removed under an earlier forensic decision.
  if (sha256(await readFile(lockPath, 'utf8')) !== expectedLockDigest) {
    throw new ContractError('deployment lock changed before recovery unlink', EXIT.SINGLETON);
  }
  await unlink(lockPath);
  await syncDirectory(dirname(lockPath));
  return receipt;
}

async function releaseFileLock(lock) {
  try { await lock.handle.close(); } finally { await unlink(lock.lockPath).catch(() => {}); }
}

export async function withDeployStateLock(statePath, callback, options) {
  const lock = await acquireFileLock(statePath, options);
  try {
    let state;
    try { state = JSON.parse(await readFile(statePath, 'utf8')); }
    catch { throw new ContractError(`cannot read valid deployment state: ${statePath}`, EXIT.SWITCH); }
    validateDeployState(state);
    return await callback(structuredClone(state));
  } finally {
    await releaseFileLock(lock);
  }
}

async function syncDirectory(path) {
  let handle;
  try { handle = await open(path, 'r'); await handle.sync(); }
  catch (error) { if (!['EINVAL', 'EPERM', 'EISDIR'].includes(error?.code)) throw error; }
  finally { await handle?.close(); }
}

async function writeImmutableJson(path, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    return;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code !== 'EEXIST') throw error;
  }
  let existing;
  try { existing = JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new ContractError(`existing immutable receipt is unreadable: ${path}`, EXIT.SWITCH); }
  if (canonicalJson(existing) !== canonicalJson(value)) throw new ContractError(`immutable receipt collision: ${path}`, EXIT.SWITCH);
}

async function atomicWriteJson(statePath, state, mustNotExist = false) {
  validateDeployState(state);
  const directory = dirname(statePath);
  const temporary = join(directory, `.${basename(statePath)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    if (mustNotExist) {
      try { await readFile(statePath); throw new ContractError(`state already exists: ${statePath}`, EXIT.SWITCH); }
      catch (error) { if (error instanceof ContractError) throw error; if (error?.code !== 'ENOENT') throw error; }
    }
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, statePath);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    if (error instanceof ContractError) throw error;
    throw new ContractError(`atomic state write failed: ${error.message}`, EXIT.SWITCH);
  }
}

async function persistTerminalReceipt(statePath, current, next) {
  const receiptBody = {
    schema: current.recovery ? 'booking.deploy-receipt/v2' : 'booking.deploy-receipt/v1', environment: current.environment, project: current.project,
    generation: next.generation, fencingEpoch: current.fencingEpoch, operationId: current.operationId,
    approvalId: current.approvalId, terminalPhase: current.phase, previousReceiptDigest: current.receiptChainHead,
    terminalStateDigest: sha256(current), activeIdentity: structuredClone(next.active), evidence: structuredClone(current.evidence),
    ...(current.recovery ? { recovery: structuredClone(current.recovery) } : {}),
  };
  const receipt = validateDeployReceipt({ ...receiptBody, receiptDigest: sha256(receiptBody) });
  const receiptDirectory = join(dirname(statePath), 'receipts');
  await mkdir(receiptDirectory, { recursive: true, mode: 0o700 });
  const receiptPath = join(receiptDirectory, `${String(next.generation).padStart(12, '0')}.json`);
  await writeImmutableJson(receiptPath, receipt);
  await syncDirectory(receiptDirectory);
  return receipt.receiptDigest;
}

export function trustedDeployStateRoot(platform = process.platform, environment = process.env) {
  if (platform === 'win32') {
    const programData = environment.ProgramData || environment.PROGRAMDATA;
    if (!programData || !isAbsolute(programData)) throw new ContractError('ProgramData must resolve the trusted deployment state root', EXIT.SWITCH);
    return resolve(programData, 'HappyBooking', 'deploy-state');
  }
  return '/var/lib/happybooking/deploy-state';
}

export async function canonicalStatePath({ environment, project, deployStateRoot = trustedDeployStateRoot() }) {
  if (!deployStateRoot || !isAbsolute(deployStateRoot)) throw new ContractError('trusted deployment state root must be an existing absolute directory', EXIT.SWITCH);
  const expectedProject = environment === 'preprod' ? 'booking-preprod' : environment === 'production' ? 'booking-prod' : null;
  if (!expectedProject || project !== expectedProject) throw new ContractError('environment/project mapping is invalid', EXIT.SWITCH);
  let root;
  try { root = await realpath(resolve(deployStateRoot)); } catch { throw new ContractError('BOOKING_DEPLOY_STATE_ROOT cannot be resolved', EXIT.SWITCH); }
  const directory = resolve(root, environment, project);
  const containment = relative(root, directory);
  if (!containment || containment.startsWith('..') || isAbsolute(containment)) throw new ContractError('canonical state directory escapes configured root', EXIT.SWITCH);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const canonicalDirectory = await realpath(directory);
  const canonicalContainment = relative(root, canonicalDirectory);
  if (!canonicalContainment || canonicalContainment.startsWith('..') || isAbsolute(canonicalContainment)) throw new ContractError('canonical state directory resolves outside configured root', EXIT.SWITCH);
  return join(canonicalDirectory, 'deploy-state.json');
}

export async function initializeStateFile(statePath, state, options) {
  const lock = await acquireFileLock(statePath, options);
  try { await atomicWriteJson(statePath, state, true); return state; }
  finally { await releaseFileLock(lock); }
}

export async function mutateStateFile(statePath, mutation, options) {
  return withDeployStateLock(statePath, async (current) => {
    const next = await mutation(structuredClone(current));
    validateDeployState(next);
    if (next.generation !== current.generation + 1) throw new ContractError('mutation must increment generation exactly once', EXIT.SWITCH);
    if (next.phase === 'IDLE' && current.phase !== 'IDLE') {
      await verifyCanonicalDeployReceiptChain(statePath, current, { mode: 'append', nextGeneration: next.generation });
      next.receiptChainHead = await persistTerminalReceipt(statePath, current, next);
    }
    await atomicWriteJson(statePath, next);
    return next;
  }, options);
}
