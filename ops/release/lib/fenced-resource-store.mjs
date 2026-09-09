import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ContractError, EXIT, canonicalJson, sha256 } from './contracts.mjs';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

async function syncDirectory(path) {
  let handle;
  try { handle = await open(path, 'r'); await handle.sync(); }
  catch (error) { if (!['EINVAL', 'EPERM', 'EISDIR'].includes(error?.code)) throw error; }
  finally { await handle?.close(); }
}

async function atomicWrite(path, value) {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function immutableWrite(path, value) {
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    return;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code !== 'EEXIST') throw error;
  }
  let existing;
  try { existing = JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new ContractError(`existing executor receipt is unreadable: ${path}`, EXIT.SWITCH); }
  if (canonicalJson(existing) !== canonicalJson(value)) throw new ContractError(`immutable executor receipt collision: ${path}`, EXIT.SWITCH);
}

function validateResourceState(value, expected) {
  if (!value || value.schema !== 'booking.fenced-resource/v1') throw new ContractError('resource fencing state is invalid', EXIT.SWITCH);
  for (const key of ['environment', 'project', 'resourceId']) {
    if (value[key] !== expected[key]) throw new ContractError(`resource fencing ${key} mismatch`, EXIT.IDENTITY);
  }
  if (!Number.isInteger(value.highestAcceptedFencingEpoch) || value.highestAcceptedFencingEpoch < 0) throw new ContractError('resource fencing epoch is invalid', EXIT.SWITCH);
  if (value.receiptChainHead !== null && !DIGEST.test(value.receiptChainHead || '')) throw new ContractError('resource receipt chain head is invalid', EXIT.SWITCH);
  if (value.pendingAction !== null) {
    if (!value.pendingAction || !IDENTIFIER.test(value.pendingAction.actionId || '') || !DIGEST.test(value.pendingAction.requestDigest || '')) {
      throw new ContractError('resource has invalid pending action state', EXIT.SWITCH);
    }
    const recoveryFields = ['action', 'approvalId', 'leaseId', 'holderId', 'generation', 'fencingEpoch', 'commandDigest'];
    if (recoveryFields.some((key) => Object.hasOwn(value.pendingAction, key))) {
      if (recoveryFields.some((key) => !Object.hasOwn(value.pendingAction, key)) ||
          !/^preprod-[a-z-]+$/.test(value.pendingAction.action || '') ||
          ['approvalId', 'leaseId', 'holderId'].some((key) => !IDENTIFIER.test(value.pendingAction[key] || '')) ||
          !Number.isInteger(value.pendingAction.generation) || value.pendingAction.generation < 1 ||
          !Number.isInteger(value.pendingAction.fencingEpoch) || value.pendingAction.fencingEpoch < 1 ||
          !DIGEST.test(value.pendingAction.commandDigest || '')) {
        throw new ContractError('resource pending action recovery identity is invalid', EXIT.SWITCH);
      }
    }
  }
  return value;
}

export function resourceDirectory(statePath, resourceId) {
  return join(dirname(statePath), 'executor', 'resources', sha256(resourceId).slice('sha256:'.length));
}

export async function acquireResourceLocks(statePath, resourceIds) {
  const unique = [...new Set(resourceIds)].sort();
  const acquired = [];
  try {
    for (const resourceId of unique) {
      const directory = resourceDirectory(statePath, resourceId);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const lockPath = join(directory, 'resource-state.lock');
      let handle;
      try {
        handle = await open(lockPath, 'wx', 0o600);
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString(), nonce: randomUUID() })}\n`);
        await handle.sync();
      } catch (error) {
        await handle?.close().catch(() => {});
        if (error?.code === 'EEXIST') throw new ContractError(`resource fencing lock exists and requires explicit forensic recovery: ${lockPath}`, EXIT.SINGLETON);
        throw error;
      }
      acquired.push({ resourceId, directory, lockPath, handle });
    }
    return acquired;
  } catch (error) {
    await releaseResourceLocks(acquired);
    throw error;
  }
}

export async function releaseResourceLocks(locks) {
  for (const lock of [...locks].reverse()) {
    try { await lock.handle.close(); } finally { await unlink(lock.lockPath).catch(() => {}); }
  }
}

export async function acceptResourceEpoch(lock, binding) {
  const path = join(lock.directory, 'resource-state.json');
  let current;
  try { current = validateResourceState(JSON.parse(await readFile(path, 'utf8')), binding); }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    current = {
      schema: 'booking.fenced-resource/v1', environment: binding.environment, project: binding.project,
      resourceId: binding.resourceId, highestAcceptedFencingEpoch: 0, operationId: null,
      manifestDigest: null, pendingAction: null, receiptChainHead: null, updatedAt: binding.now,
    };
  }
  if (current.pendingAction !== null) throw new ContractError(`resource ${binding.resourceId} retains an unresolved pending action`, EXIT.SINGLETON);
  if (binding.fencingEpoch < current.highestAcceptedFencingEpoch) throw new ContractError(`resource ${binding.resourceId} rejected stale fencing epoch`, EXIT.SINGLETON);
  if (binding.fencingEpoch === current.highestAcceptedFencingEpoch && current.operationId !== null && current.operationId !== binding.operationId) {
    throw new ContractError(`resource ${binding.resourceId} rejected conflicting operation at accepted epoch`, EXIT.SINGLETON);
  }
  if (binding.fencingEpoch === current.highestAcceptedFencingEpoch && current.manifestDigest !== null && current.manifestDigest !== binding.manifestDigest &&
      current.manifestDigest !== binding.allowedPreviousManifestDigest) {
    throw new ContractError(`resource ${binding.resourceId} rejected conflicting manifest at accepted epoch`, EXIT.IDENTITY);
  }
  const next = {
    ...current, highestAcceptedFencingEpoch: binding.fencingEpoch, operationId: binding.operationId,
    manifestDigest: binding.manifestDigest, pendingAction: {
      actionId: binding.actionId, requestDigest: binding.requestDigest,
      ...(binding.action ? { action: binding.action, approvalId: binding.approvalId, leaseId: binding.leaseId,
        holderId: binding.holderId, generation: binding.generation, fencingEpoch: binding.fencingEpoch,
        commandDigest: binding.commandDigest } : {}),
    }, updatedAt: binding.now,
  };
  await atomicWrite(path, next);
  return next;
}

export async function completeResourceAction(lock, binding, receiptDigest) {
  const path = join(lock.directory, 'resource-state.json');
  const current = validateResourceState(JSON.parse(await readFile(path, 'utf8')), binding);
  if (current.highestAcceptedFencingEpoch !== binding.fencingEpoch || current.operationId !== binding.operationId ||
      current.pendingAction?.actionId !== binding.actionId || current.pendingAction?.requestDigest !== binding.requestDigest) {
    throw new ContractError(`resource ${binding.resourceId} pending action changed before completion`, EXIT.SINGLETON);
  }
  await atomicWrite(path, { ...current, pendingAction: null, receiptChainHead: receiptDigest, updatedAt: binding.now });
}

export async function inspectLockedResourceState(lock, binding) {
  const path = join(lock.directory, 'resource-state.json');
  try { return validateResourceState(JSON.parse(await readFile(path, 'utf8')), binding); }
  catch (error) {
    if (error?.code === 'ENOENT') throw new ContractError(`resource ${binding.resourceId} has no fencing state for receipt replay`, EXIT.SINGLETON);
    throw error;
  }
}

export async function recoverResourceAction(lock, binding, acceptedPriorReceiptDigests, recoveryReceiptDigest) {
  const path = join(lock.directory, 'resource-state.json');
  const current = await inspectLockedResourceState(lock, binding);
  const pendingMatches = current.pendingAction?.actionId === binding.actionId && current.pendingAction?.requestDigest === binding.requestDigest;
  const completedMatches = current.pendingAction === null && acceptedPriorReceiptDigests.includes(current.receiptChainHead);
  if (current.highestAcceptedFencingEpoch !== binding.fencingEpoch || current.operationId !== binding.operationId || (!pendingMatches && !completedMatches)) {
    throw new ContractError(`resource ${binding.resourceId} cannot recover the recorded action`, EXIT.SINGLETON);
  }
  await atomicWrite(path, { ...current, pendingAction: null, receiptChainHead: recoveryReceiptDigest, updatedAt: binding.now });
}

export async function adoptPriorEpochPendingAction(lock, prior, binding, receiptDigest) {
  const path = join(lock.directory, 'resource-state.json');
  const current = await inspectLockedResourceState(lock, binding);
  if (current.highestAcceptedFencingEpoch !== prior.fencingEpoch || current.highestAcceptedFencingEpoch >= binding.fencingEpoch ||
      current.operationId !== binding.operationId || current.manifestDigest !== binding.manifestDigest ||
      current.pendingAction?.actionId !== prior.actionId || current.pendingAction?.requestDigest !== prior.requestDigest ||
      current.receiptChainHead !== prior.receiptChainHead) {
    throw new ContractError(`resource ${binding.resourceId} prior-epoch pending action changed before adoption`, EXIT.SINGLETON);
  }
  await atomicWrite(path, { ...current, highestAcceptedFencingEpoch: binding.fencingEpoch,
    operationId: binding.operationId, manifestDigest: binding.manifestDigest, pendingAction: null,
    receiptChainHead: receiptDigest, updatedAt: binding.now });
}

export async function supersedePriorEpochPendingAction(lock, prior, binding) {
  const path = join(lock.directory, 'resource-state.json');
  const current = await inspectLockedResourceState(lock, binding);
  if (current.highestAcceptedFencingEpoch !== prior.fencingEpoch || current.highestAcceptedFencingEpoch >= binding.fencingEpoch ||
      current.operationId !== binding.operationId || current.manifestDigest !== binding.manifestDigest ||
      current.pendingAction?.actionId !== prior.actionId || current.pendingAction?.requestDigest !== prior.requestDigest ||
      current.receiptChainHead !== prior.receiptChainHead) {
    throw new ContractError(`resource ${binding.resourceId} prior-epoch pending action changed before supersession`, EXIT.SINGLETON);
  }
  await atomicWrite(path, { ...current, highestAcceptedFencingEpoch: binding.fencingEpoch,
    operationId: binding.operationId, manifestDigest: binding.manifestDigest,
    pendingAction: { actionId: binding.actionId, requestDigest: binding.requestDigest, action: binding.action,
      approvalId: binding.approvalId, leaseId: binding.leaseId, holderId: binding.holderId,
      generation: binding.generation, fencingEpoch: binding.fencingEpoch, commandDigest: binding.commandDigest },
    updatedAt: binding.now });
}

export async function writeExecutorReceipt(statePath, receipt) {
  const directory = join(dirname(statePath), 'executor', 'receipts');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const safeName = `${String(receipt.fencingEpoch).padStart(12, '0')}-${receipt.action}-${receipt.actionId}.json`;
  const path = join(directory, safeName);
  await immutableWrite(path, receipt);
  await syncDirectory(directory);
  return path;
}

export async function readExecutorReceipt(statePath, fencingEpoch, action, actionId) {
  const directory = join(dirname(statePath), 'executor', 'receipts');
  const path = join(directory, `${String(fencingEpoch).padStart(12, '0')}-${action}-${actionId}.json`);
  try {
    const receipt = JSON.parse(await readFile(path, 'utf8'));
    const { receiptDigest, ...body } = receipt || {};
    if (!DIGEST.test(receiptDigest || '') || receiptDigest !== sha256(body)) throw new ContractError(`executor receipt integrity check failed: ${path}`, EXIT.IDENTITY);
    return receipt;
  }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof ContractError) throw error;
    throw new ContractError(`cannot read executor receipt: ${path}`, EXIT.SWITCH);
  }
}

export async function writeExecutorRecoveryReceipt(statePath, receipt) {
  const directory = join(dirname(statePath), 'executor', 'recoveries');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${String(receipt.fencingEpoch).padStart(12, '0')}-${receipt.action}-${receipt.actionId}-${receipt.receiptDigest.slice(7, 19)}.json`);
  await immutableWrite(path, receipt);
  await syncDirectory(directory);
  return path;
}

export async function readExecutorRecoveryReceiptByDigest(statePath, receiptDigest) {
  const directory = join(dirname(statePath), 'executor', 'recoveries');
  let names;
  try { names = await readdir(directory); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw new ContractError('cannot enumerate executor recovery receipts', EXIT.SWITCH); }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let receipt;
    try { receipt = JSON.parse(await readFile(join(directory, name), 'utf8')); } catch { throw new ContractError(`executor recovery receipt is unreadable: ${name}`, EXIT.IDENTITY); }
    const { receiptDigest: observed, ...body } = receipt || {};
    if (!DIGEST.test(observed || '') || observed !== sha256(body)) throw new ContractError(`executor recovery receipt integrity check failed: ${name}`, EXIT.IDENTITY);
    if (observed === receiptDigest) return receipt;
  }
  return null;
}

async function scanImmutableReceiptDirectory(directory, receiptDigest, label) {
  let names;
  try { names = await readdir(directory); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new ContractError(`cannot enumerate ${label} receipts`, EXIT.SWITCH);
  }
  let match = null;
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let value;
    try { value = JSON.parse(await readFile(join(directory, name), 'utf8')); }
    catch { throw new ContractError(`${label} receipt is unreadable: ${name}`, EXIT.IDENTITY); }
    const { receiptDigest: observed, ...body } = value || {};
    if (!DIGEST.test(observed || '') || observed !== sha256(body)) {
      throw new ContractError(`${label} receipt integrity check failed: ${name}`, EXIT.IDENTITY);
    }
    if (observed === receiptDigest) {
      if (match) throw new ContractError(`${label} receipt digest is ambiguous`, EXIT.IDENTITY);
      match = value;
    }
  }
  return match;
}

export async function readCanonicalExecutorReceiptByDigest(statePath, receiptDigest) {
  if (!DIGEST.test(receiptDigest || '')) throw new ContractError('executor receipt digest is invalid', EXIT.IDENTITY);
  const executorRoot = join(dirname(statePath), 'executor');
  const direct = await scanImmutableReceiptDirectory(join(executorRoot, 'receipts'), receiptDigest, 'executor');
  const recovery = direct ? null : await scanImmutableReceiptDirectory(join(executorRoot, 'recoveries'), receiptDigest, 'executor recovery');
  if (!direct && !recovery) throw new ContractError('executor receipt digest is not present in the canonical store', EXIT.IDENTITY);
  const receipt = direct || await scanImmutableReceiptDirectory(join(executorRoot, 'receipts'), recovery.originalReceiptDigest, 'executor');
  if (!receipt || (recovery && (recovery.schema !== 'booking.external-action-recovery/v1' || recovery.originalReceiptDigest !== receipt.receiptDigest ||
      recovery.requestDigest !== receipt.requestDigest || recovery.action !== receipt.action || recovery.actionId !== receipt.actionId ||
      recovery.operationId !== receipt.operationId || recovery.fencingEpoch !== receipt.fencingEpoch ||
      recovery.manifestDigest !== receipt.manifestDigest || canonicalJson(recovery.releaseIdentity) !== canonicalJson(receipt.releaseIdentity)))) {
    throw new ContractError('executor recovery receipt is not bound to its original action receipt', EXIT.IDENTITY);
  }
  return { receipt, acceptedReceipt: recovery || receipt };
}

export async function readCompletedExecutorReceiptByDigest(statePath, receiptDigest) {
  const { receipt, acceptedReceipt } = await readCanonicalExecutorReceiptByDigest(statePath, receiptDigest);
  const acceptedDigest = acceptedReceipt.receiptDigest;
  for (const resourceId of receipt.resourceIds || []) {
    let resource;
    try { resource = JSON.parse(await readFile(join(resourceDirectory(statePath, resourceId), 'resource-state.json'), 'utf8')); }
    catch { throw new ContractError(`resource ${resourceId} completion state is unavailable`, EXIT.IDENTITY); }
    validateResourceState(resource, { environment: receipt.environment, project: receipt.project, resourceId });
    if (resource.pendingAction !== null || resource.receiptChainHead !== acceptedDigest ||
        resource.highestAcceptedFencingEpoch !== receipt.fencingEpoch || resource.operationId !== receipt.operationId ||
        resource.manifestDigest !== receipt.manifestDigest) {
      throw new ContractError(`resource ${resourceId} does not prove completed executor receipt`, EXIT.IDENTITY);
    }
  }
  return { receipt, acceptedReceipt };
}
