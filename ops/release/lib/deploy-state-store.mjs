import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ContractError, EXIT, canonicalJson, sha256 } from './contracts.mjs';
import { validateDeployState } from './state-machine.mjs';

async function acquireFileLock(statePath, { nowMs = Date.now() } = {}) {
  const lockPath = `${statePath}.lock`;
  let createdHandle;
  try {
    createdHandle = await open(lockPath, 'wx', 0o600);
    await createdHandle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date(nowMs).toISOString(), nonce: randomUUID() })}\n`);
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
    schema: 'booking.deploy-receipt/v1', environment: current.environment, project: current.project,
    generation: next.generation, fencingEpoch: current.fencingEpoch, operationId: current.operationId,
    approvalId: current.approvalId, terminalPhase: current.phase, previousReceiptDigest: current.receiptChainHead,
    terminalStateDigest: sha256(current), activeIdentity: structuredClone(next.active), evidence: structuredClone(current.evidence),
  };
  const receipt = { ...receiptBody, receiptDigest: sha256(receiptBody) };
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
    if (next.phase === 'IDLE' && current.phase !== 'IDLE') next.receiptChainHead = await persistTerminalReceipt(statePath, current, next);
    await atomicWriteJson(statePath, next);
    return next;
  }, options);
}
