import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ContractError, EXIT, canonicalJson, sha256 } from './contracts.mjs';
import { schemaForAction } from './external-action-contract.mjs';
import { validateDeployState } from './state-machine.mjs';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CONTROL_CONTAINER_NAME = 'booking-preprod-control-plane';
function validateExecutorReceiptVersion(receipt) {
  if (receipt?.schema !== schemaForAction(receipt?.action).receipt) {
    throw new ContractError('executor receipt schema does not match its action contract', EXIT.IDENTITY);
  }
  return receipt;
}

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
      if (Object.hasOwn(value.pendingAction, 'groupDigest') && !DIGEST.test(value.pendingAction.groupDigest || '')) {
        throw new ContractError('resource pending action group identity is invalid', EXIT.SWITCH);
      }
    }
  }
  return value;
}

export function resourceDirectory(statePath, resourceId) {
  return join(dirname(statePath), 'executor', 'resources', sha256(resourceId).slice('sha256:'.length));
}

function actionGroupPath(statePath, binding) {
  const name = `${String(binding.fencingEpoch).padStart(12, '0')}-${binding.action}-${binding.actionId}.json`;
  return join(dirname(statePath), 'executor', 'action-groups', name);
}

function actionGroupIdentity(binding, resourceIds) {
  return {
    schema: 'booking.resource-action-group/v1', environment: binding.environment, project: binding.project,
    dispatchProtocol: 'durable-executing/v1',
    operationId: binding.operationId, generation: binding.generation, fencingEpoch: binding.fencingEpoch,
    action: binding.action, actionId: binding.actionId, requestDigest: binding.requestDigest,
    manifestDigest: binding.manifestDigest, resourceIds: [...new Set(resourceIds)].sort(),
  };
}

function validateActionGroup(value, identity) {
  const allowedKeys = new Set(['schema', 'identity', 'groupDigest', 'phase', 'acceptedResourceIds',
    'completedResourceIds', 'receiptDigest', 'receiptFromPhase', 'updatedAt', 'supersededReceiptDigests']);
  const requiredKeys = ['schema', 'identity', 'groupDigest', 'phase', 'acceptedResourceIds',
    'completedResourceIds', 'receiptDigest', 'updatedAt'];
  if (!value || Object.keys(value).some((key) => !allowedKeys.has(key)) || requiredKeys.some((key) => !Object.hasOwn(value, key)) ||
      value.schema !== identity.schema || canonicalJson(value.identity) !== canonicalJson(identity) ||
      value.groupDigest !== sha256(identity) || !['ACCEPTING', 'ACCEPTED', 'MUTATING', 'EXECUTING', 'RECEIPT_WRITTEN', 'COMPLETED'].includes(value.phase) ||
      !Array.isArray(value.acceptedResourceIds) || !Array.isArray(value.completedResourceIds) ||
      !Number.isFinite(Date.parse(value.updatedAt)) ||
      (value.receiptDigest !== null && !DIGEST.test(value.receiptDigest || '')) ||
      (value.supersededReceiptDigests !== undefined && (!Array.isArray(value.supersededReceiptDigests) ||
        new Set(value.supersededReceiptDigests).size !== value.supersededReceiptDigests.length ||
        value.supersededReceiptDigests.some((digest) => !DIGEST.test(digest || ''))))) {
    throw new ContractError('resource action group journal is invalid or has drifted', EXIT.IDENTITY);
  }
  const allowed = new Set(identity.resourceIds);
  for (const list of [value.acceptedResourceIds, value.completedResourceIds]) {
    if (new Set(list).size !== list.length || list.some((item) => !allowed.has(item)) ||
        canonicalJson(list) !== canonicalJson([...list].sort())) {
      throw new ContractError('resource action group journal resource set is invalid', EXIT.IDENTITY);
    }
  }
  const allAccepted = value.acceptedResourceIds.length === identity.resourceIds.length;
  const allCompleted = value.completedResourceIds.length === identity.resourceIds.length;
  const hasReceipt = value.receiptDigest !== null;
  const hasReceiptOrigin = ['ACCEPTED', 'MUTATING', 'EXECUTING', 'RECEIPT_WRITTEN', 'RECOVERY'].includes(value.receiptFromPhase);
  const phaseValid = value.phase === 'ACCEPTING'
    ? value.completedResourceIds.length === 0 && !hasReceipt && value.receiptFromPhase === undefined
    : value.phase === 'ACCEPTED'
      ? allAccepted && value.completedResourceIds.length === 0 && !hasReceipt && value.receiptFromPhase === undefined
      : ['MUTATING', 'EXECUTING'].includes(value.phase)
        ? allAccepted && value.completedResourceIds.length === 0 && !hasReceipt && value.receiptFromPhase === undefined
        : value.phase === 'RECEIPT_WRITTEN'
          ? allAccepted && hasReceipt && hasReceiptOrigin
          : allAccepted && allCompleted && hasReceipt && hasReceiptOrigin;
  if (!phaseValid || value.completedResourceIds.some((item) => !value.acceptedResourceIds.includes(item))) {
    throw new ContractError('resource action group phase invariants are invalid', EXIT.IDENTITY);
  }
  return value;
}

async function writeActionGroup(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await atomicWrite(path, value);
}

export async function beginResourceActionGroup(statePath, locks, binding) {
  const identity = actionGroupIdentity(binding, locks.map((lock) => lock.resourceId));
  const path = actionGroupPath(statePath, binding);
  let value;
  try { value = validateActionGroup(JSON.parse(await readFile(path, 'utf8')), identity); }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    value = { schema: identity.schema, identity, groupDigest: sha256(identity), phase: 'ACCEPTING',
      acceptedResourceIds: [], completedResourceIds: [], receiptDigest: null, updatedAt: binding.now };
    await writeActionGroup(path, value);
  }
  return { path, value, identity };
}

export async function readResourceActionGroup(statePath, binding, resourceIds) {
  const identity = actionGroupIdentity(binding, resourceIds);
  const path = actionGroupPath(statePath, binding);
  try { return { path, value: validateActionGroup(JSON.parse(await readFile(path, 'utf8')), identity), identity }; }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

function pendingMatchesGroup(resource, binding, groupDigest) {
  const pending = resource?.pendingAction;
  return resource?.highestAcceptedFencingEpoch === binding.fencingEpoch && resource.operationId === binding.operationId &&
    resource.manifestDigest === binding.manifestDigest && pending?.action === binding.action &&
    pending.actionId === binding.actionId && pending.requestDigest === binding.requestDigest &&
    pending.approvalId === binding.approvalId && pending.leaseId === binding.leaseId && pending.holderId === binding.holderId &&
    pending.generation === binding.generation && pending.fencingEpoch === binding.fencingEpoch &&
    pending.commandDigest === binding.commandDigest && (!pending.groupDigest || pending.groupDigest === groupDigest);
}

/** Accept every resource under a durable group journal. Retrying a crash in
 * the accept loop reuses only exact same-request pending states. */
export async function acceptResourceActionGroup(statePath, locks, binding) {
  const group = await beginResourceActionGroup(statePath, locks, binding);
  if (!['ACCEPTING', 'ACCEPTED'].includes(group.value.phase)) {
    throw new ContractError('resource action group has crossed the mutation boundary', EXIT.SINGLETON);
  }
  let value = group.value;
  const resumed = value.acceptedResourceIds.length > 0;
  for (const lock of locks) {
    let current = null;
    const resourceBinding = { ...binding, resourceId: lock.resourceId };
    try { current = await inspectLockedResourceState(lock, resourceBinding); }
    catch (error) { if (!/has no fencing state/.test(error?.message || '')) throw error; }
    let accepted;
    if (pendingMatchesGroup(current, binding, value.groupDigest)) {
      accepted = current;
    } else {
      accepted = await acceptResourceEpoch(lock, { ...resourceBinding, groupDigest: value.groupDigest });
    }
    if (!value.acceptedResourceIds.includes(lock.resourceId)) {
      value = { ...value, acceptedResourceIds: [...value.acceptedResourceIds, lock.resourceId].sort(), updatedAt: binding.now };
      await writeActionGroup(group.path, value);
    }
  }
  value = { ...value, phase: 'ACCEPTED', updatedAt: binding.now };
  await writeActionGroup(group.path, value);
  const states = [];
  for (const lock of locks) states.push(await inspectLockedResourceState(lock, { ...binding, resourceId: lock.resourceId }));
  return { states, journal: value, resumed };
}

export async function markResourceActionGroupMutating(statePath, binding, resourceIds) {
  const identity = actionGroupIdentity(binding, resourceIds);
  const path = actionGroupPath(statePath, binding);
  const value = validateActionGroup(JSON.parse(await readFile(path, 'utf8')), identity);
  if (value.phase !== 'ACCEPTED' || value.acceptedResourceIds.length !== identity.resourceIds.length) {
    throw new ContractError('resource action group is not fully accepted', EXIT.SINGLETON);
  }
  const next = { ...value, phase: 'MUTATING', updatedAt: binding.now };
  await writeActionGroup(path, next);
  return next;
}

/** The durable dispatch boundary. A journal left at MUTATING proves that no
 * command dispatch was recorded and may be resumed once; EXECUTING remains
 * ambiguous and therefore requires desired-state adoption or freezes. */
export async function markResourceActionGroupExecuting(statePath, binding, resourceIds) {
  const identity = actionGroupIdentity(binding, resourceIds);
  const path = actionGroupPath(statePath, binding);
  const value = validateActionGroup(JSON.parse(await readFile(path, 'utf8')), identity);
  if (value.phase !== 'MUTATING') {
    throw new ContractError('resource action group has no unconsumed mutation dispatch', EXIT.SINGLETON);
  }
  const next = { ...value, phase: 'EXECUTING', updatedAt: binding.now };
  await writeActionGroup(path, next);
  return next;
}

export async function markResourceActionGroupReceipt(statePath, binding, resourceIds, receiptDigest, receiptStatus = null) {
  if (!DIGEST.test(receiptDigest || '')) throw new ContractError('resource action group receipt digest is invalid', EXIT.IDENTITY);
  const identity = actionGroupIdentity(binding, resourceIds);
  const path = actionGroupPath(statePath, binding);
  const value = validateActionGroup(JSON.parse(await readFile(path, 'utf8')), identity);
  if ((!['MUTATING', 'EXECUTING', 'RECEIPT_WRITTEN'].includes(value.phase) &&
      !(value.phase === 'ACCEPTED' && receiptStatus === 'fail')) ||
      (receiptStatus !== null && !['pass', 'fail'].includes(receiptStatus)) ||
      (value.receiptDigest && value.receiptDigest !== receiptDigest)) {
    throw new ContractError('resource action group receipt transition is invalid', EXIT.SINGLETON);
  }
  const next = { ...value, phase: 'RECEIPT_WRITTEN', receiptDigest,
    receiptFromPhase: value.receiptFromPhase || value.phase, updatedAt: binding.now };
  await writeActionGroup(path, next);
  return next;
}

export async function reconcileResourceActionGroupReceipt(statePath, binding, resourceIds, receiptDigest) {
  if (!DIGEST.test(receiptDigest || '')) throw new ContractError('resource action group reconcile receipt digest is invalid', EXIT.IDENTITY);
  const identity = actionGroupIdentity(binding, resourceIds);
  const path = actionGroupPath(statePath, binding);
  const value = validateActionGroup(JSON.parse(await readFile(path, 'utf8')), identity);
  if (!['MUTATING', 'EXECUTING', 'RECEIPT_WRITTEN'].includes(value.phase)) {
    throw new ContractError('resource action group is not at an ambiguous mutation boundary', EXIT.SINGLETON);
  }
  const superseded = [...new Set([...(value.supersededReceiptDigests || []), ...(value.receiptDigest ? [value.receiptDigest] : [])])];
  const next = { ...value, phase: 'RECEIPT_WRITTEN', receiptDigest,
    receiptFromPhase: value.receiptFromPhase || 'RECOVERY',
    supersededReceiptDigests: superseded, updatedAt: binding.now };
  await writeActionGroup(path, next);
  return next;
}

export async function completeResourceActionGroup(statePath, locks, binding, receiptDigest) {
  const identity = actionGroupIdentity(binding, locks.map((lock) => lock.resourceId));
  const path = actionGroupPath(statePath, binding);
  let value = validateActionGroup(JSON.parse(await readFile(path, 'utf8')), identity);
  if (value.phase !== 'RECEIPT_WRITTEN' || value.receiptDigest !== receiptDigest) {
    throw new ContractError('resource action group has no matching durable receipt', EXIT.SINGLETON);
  }
  for (const lock of locks) {
    const resourceBinding = { ...binding, resourceId: lock.resourceId };
    const current = await inspectLockedResourceState(lock, resourceBinding);
    if (pendingMatchesGroup(current, binding, value.groupDigest)) {
      await completeResourceAction(lock, resourceBinding, receiptDigest);
    } else if (!(current.highestAcceptedFencingEpoch === binding.fencingEpoch && current.operationId === binding.operationId &&
        current.manifestDigest === binding.manifestDigest && current.pendingAction === null && current.receiptChainHead === receiptDigest)) {
      throw new ContractError(`resource ${lock.resourceId} cannot complete the action group`, EXIT.SINGLETON);
    }
    if (!value.completedResourceIds.includes(lock.resourceId)) {
      value = { ...value, completedResourceIds: [...value.completedResourceIds, lock.resourceId].sort(), updatedAt: binding.now };
      await writeActionGroup(path, value);
    }
  }
  value = { ...value, phase: 'COMPLETED', updatedAt: binding.now };
  await writeActionGroup(path, value);
  return value;
}

export async function resumeResourceActionGroupBeforeDispatch(statePath, binding, resourceIds, failedReceiptDigest) {
  if (!DIGEST.test(failedReceiptDigest || '')) throw new ContractError('resource action group failed receipt digest is invalid', EXIT.IDENTITY);
  const identity = actionGroupIdentity(binding, resourceIds);
  const path = actionGroupPath(statePath, binding);
  const value = validateActionGroup(JSON.parse(await readFile(path, 'utf8')), identity);
  if (value.phase !== 'RECEIPT_WRITTEN' || value.receiptDigest !== failedReceiptDigest ||
      !['ACCEPTED', 'MUTATING'].includes(value.receiptFromPhase)) {
    throw new ContractError('resource action group failure crossed the dispatch boundary', EXIT.SINGLETON);
  }
  const superseded = [...new Set([...(value.supersededReceiptDigests || []), failedReceiptDigest])];
  const next = { ...value, phase: 'MUTATING', receiptDigest: null, supersededReceiptDigests: superseded,
    updatedAt: binding.now };
  delete next.receiptFromPhase;
  await writeActionGroup(path, next);
  return next;
}

/** Close a journal after a canonical pass/recovery receipt has already closed
 * every resource. This is deliberately stricter than a phase-only rewrite. */
export async function finalizeRecoveredResourceActionGroup(statePath, locks, binding, receiptDigest) {
  if (!DIGEST.test(receiptDigest || '')) throw new ContractError('resource action group recovery receipt digest is invalid', EXIT.IDENTITY);
  const identity = actionGroupIdentity(binding, locks.map((lock) => lock.resourceId));
  const path = actionGroupPath(statePath, binding);
  let value;
  try { value = validateActionGroup(JSON.parse(await readFile(path, 'utf8')), identity); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  for (const lock of locks) {
    const current = await inspectLockedResourceState(lock, { ...binding, resourceId: lock.resourceId });
    if (current.highestAcceptedFencingEpoch !== binding.fencingEpoch || current.operationId !== binding.operationId ||
        current.manifestDigest !== binding.manifestDigest || current.pendingAction !== null ||
        current.receiptChainHead !== receiptDigest) {
      throw new ContractError(`resource ${lock.resourceId} cannot finalize the recovered action group`, EXIT.SINGLETON);
    }
  }
  const superseded = [...new Set([...(value.supersededReceiptDigests || []),
    ...(value.receiptDigest && value.receiptDigest !== receiptDigest ? [value.receiptDigest] : [])])];
  value = { ...value, phase: 'COMPLETED', acceptedResourceIds: [...identity.resourceIds],
    completedResourceIds: [...identity.resourceIds], receiptDigest,
    receiptFromPhase: value.receiptFromPhase || 'RECOVERY',
    ...(superseded.length ? { supersededReceiptDigests: superseded } : {}), updatedAt: binding.now };
  await writeActionGroup(path, value);
  return value;
}

/** Explicit resource-lock recovery paired with a previously recovered or
 * otherwise expired deployment lease. Missing locks are accepted only when a
 * matching immutable recovery receipt already exists (crash continuation). */
export async function recoverStaleResourceLocks(statePath, recoveries, {
  expectedStateDigest, nowMs = Date.now(), ownerContainerProbe,
} = {}) {
  if (!DIGEST.test(expectedStateDigest || '') || !Array.isArray(recoveries) || recoveries.length === 0 || !Number.isFinite(nowMs)) {
    throw new ContractError('resource lock recovery requires exact lock/state digests and trusted time', EXIT.IDENTITY);
  }
  const stateBytes = await readFile(statePath, 'utf8');
  if (sha256(stateBytes) !== expectedStateDigest) throw new ContractError('resource lock recovery state digest mismatch', EXIT.IDENTITY);
  const state = validateDeployState(JSON.parse(stateBytes));
  if (!state.lease || Date.parse(state.lease.expiresAt) >= nowMs) throw new ContractError('deployment lease is not expired', EXIT.SINGLETON);
  const normalized = [...recoveries].map((item) => {
    if (!item || !IDENTIFIER.test(item.resourceId || '') || !DIGEST.test(item.lockDigest || '')) {
      throw new ContractError('resource lock recovery identity is invalid', EXIT.IDENTITY);
    }
    return { resourceId: item.resourceId, lockDigest: item.lockDigest };
  }).sort((a, b) => a.resourceId.localeCompare(b.resourceId));
  if (new Set(normalized.map((item) => item.resourceId)).size !== normalized.length) {
    throw new ContractError('resource lock recovery contains duplicates', EXIT.IDENTITY);
  }
  const observed = [];
  for (const item of normalized) {
    const path = join(resourceDirectory(statePath, item.resourceId), 'resource-state.lock');
    const bytes = await readFile(path, 'utf8').catch(() => null);
    if (bytes === null) { observed.push({ ...item, path, missing: true }); continue; }
    if (sha256(bytes) !== item.lockDigest) throw new ContractError(`resource ${item.resourceId} lock digest mismatch`, EXIT.IDENTITY);
    let lock;
    try { lock = JSON.parse(bytes); } catch { throw new ContractError(`resource ${item.resourceId} lock is not valid JSON`, EXIT.IDENTITY); }
    if (Object.keys(lock || {}).sort().join(',') !== ['acquiredAt', 'nonce', 'ownerContainerId', 'ownerContainerName', 'pid'].sort().join(',') ||
        !Number.isSafeInteger(lock.pid) || lock.pid < 1 || !Number.isFinite(Date.parse(lock.acquiredAt)) || !IDENTIFIER.test(lock.nonce || '') ||
        !/^[0-9a-f]{12,64}$/.test(lock.ownerContainerId || '') || lock.ownerContainerName !== CONTROL_CONTAINER_NAME ||
        typeof ownerContainerProbe !== 'function') {
      throw new ContractError(`resource ${item.resourceId} lock identity is invalid`, EXIT.IDENTITY);
    }
    const alive = await ownerContainerProbe(lock.ownerContainerId, lock.ownerContainerName);
    if (alive !== false) throw new ContractError(alive === true ? `resource ${item.resourceId} lock owner is still alive` :
      `resource ${item.resourceId} lock process liveness is indeterminate`, EXIT.SINGLETON);
    observed.push({ ...item, path, bytes, pid: lock.pid, ownerContainerId: lock.ownerContainerId,
      ownerContainerName: lock.ownerContainerName, missing: false });
  }
  const body = { schema: 'booking.lock-recovery/v1', kind: 'resource-group', environment: state.environment,
    project: state.project, operationId: state.operationId, generation: state.generation, fencingEpoch: state.fencingEpoch,
    stateDigest: expectedStateDigest, resources: normalized, leaseExpiredAt: state.lease.expiresAt,
    recoveredAt: new Date(nowMs).toISOString() };
  const receipt = { ...body, receiptDigest: sha256(body) };
  const directory = join(dirname(statePath), 'executor', 'lock-recoveries');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const receiptPath = join(directory, `resources-${receipt.receiptDigest.slice(7)}.json`);
  if (observed.some((item) => item.missing)) {
    let existing;
    try { existing = JSON.parse(await readFile(receiptPath, 'utf8')); }
    catch { throw new ContractError('missing resource lock has no matching immutable recovery receipt', EXIT.IDENTITY); }
    if (canonicalJson(existing) !== canonicalJson(receipt)) {
      throw new ContractError('missing resource lock recovery receipt does not match this exact decision', EXIT.IDENTITY);
    }
  }
  await immutableWrite(receiptPath, receipt);
  for (const item of observed) {
    if (item.missing) continue;
    if (sha256(await readFile(item.path, 'utf8')) !== item.lockDigest) {
      throw new ContractError(`resource ${item.resourceId} lock changed before recovery unlink`, EXIT.SINGLETON);
    }
    await unlink(item.path);
    await syncDirectory(dirname(item.path));
  }
  return receipt;
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
        const ownerContainerId = /^[0-9a-f]{12,64}$/.test(process.env.HOSTNAME || '') ? process.env.HOSTNAME : null;
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, ownerContainerId, ownerContainerName: CONTROL_CONTAINER_NAME,
          acquiredAt: new Date().toISOString(), nonce: randomUUID() })}\n`);
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
        commandDigest: binding.commandDigest, ...(binding.groupDigest ? { groupDigest: binding.groupDigest } : {}) } : {}),
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
      canonicalJson(current.pendingAction) !== canonicalJson(prior.pendingAction) ||
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
      canonicalJson(current.pendingAction) !== canonicalJson(prior.pendingAction) ||
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
  validateExecutorReceiptVersion(receipt);
  const directory = join(dirname(statePath), 'executor', 'receipts');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const safeName = `${String(receipt.fencingEpoch).padStart(12, '0')}-${receipt.action}-${receipt.actionId}.json`;
  const path = join(directory, safeName);
  try {
    await immutableWrite(path, receipt);
  } catch (error) {
    if (!/immutable executor receipt collision/.test(error?.message || '')) throw error;
    const existing = validateExecutorReceiptVersion(JSON.parse(await readFile(path, 'utf8')));
    if (existing.fencingEpoch !== receipt.fencingEpoch || existing.action !== receipt.action || existing.actionId !== receipt.actionId ||
        existing.requestDigest !== receipt.requestDigest || existing.status !== 'fail') {
      throw error;
    }
    const retryDirectory = join(dirname(statePath), 'executor', 'action-retries');
    await mkdir(retryDirectory, { recursive: true, mode: 0o700 });
    await immutableWrite(join(retryDirectory, `${receipt.receiptDigest.slice(7)}.json`), receipt);
    await syncDirectory(retryDirectory);
  }
  await syncDirectory(directory);
  return path;
}

export async function readExecutorReceipt(statePath, fencingEpoch, action, actionId) {
  const directory = join(dirname(statePath), 'executor', 'receipts');
  const path = join(directory, `${String(fencingEpoch).padStart(12, '0')}-${action}-${actionId}.json`);
  const attempts = [];
  try {
    const receipt = JSON.parse(await readFile(path, 'utf8'));
    const { receiptDigest, ...body } = receipt || {};
    if (!DIGEST.test(receiptDigest || '') || receiptDigest !== sha256(body)) throw new ContractError(`executor receipt integrity check failed: ${path}`, EXIT.IDENTITY);
    attempts.push(validateExecutorReceiptVersion(receipt));
  }
  catch (error) {
    if (error?.code !== 'ENOENT') {
      if (error instanceof ContractError) throw error;
      throw new ContractError(`cannot read executor receipt: ${path}`, EXIT.SWITCH);
    }
  }
  {
    const retryDirectory = join(dirname(statePath), 'executor', 'action-retries');
    let names = [];
    try { names = await readdir(retryDirectory); }
    catch (error) { if (error?.code !== 'ENOENT') throw new ContractError('cannot enumerate action retry receipts', EXIT.SWITCH); }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      let receipt;
      try { receipt = JSON.parse(await readFile(join(retryDirectory, name), 'utf8')); }
      catch { throw new ContractError(`action retry receipt is unreadable: ${name}`, EXIT.IDENTITY); }
      if (receipt?.fencingEpoch !== fencingEpoch || receipt?.action !== action || receipt?.actionId !== actionId) continue;
      const { receiptDigest, ...body } = receipt || {};
      if (!DIGEST.test(receiptDigest || '') || receiptDigest !== sha256(body) || name !== `${receiptDigest.slice(7)}.json`) {
        throw new ContractError(`action retry receipt integrity check failed: ${name}`, EXIT.IDENTITY);
      }
      attempts.push(validateExecutorReceiptVersion(receipt));
    }
  }
  if (attempts.length === 0) return null;
  if (new Set(attempts.map((receipt) => receipt.requestDigest)).size !== 1) {
    throw new ContractError('action retry receipts do not share one immutable request', EXIT.IDENTITY);
  }
  const passed = attempts.filter((receipt) => receipt.status === 'pass');
  if (passed.length > 1) throw new ContractError('action retry receipts contain ambiguous pass attempts', EXIT.IDENTITY);
  if (passed.length === 1) return passed[0];
  return attempts.sort((left, right) => left.completedAt.localeCompare(right.completedAt) || left.receiptDigest.localeCompare(right.receiptDigest)).at(-1);
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

async function scanImmutableReceiptDirectory(directory, receiptDigest, label, validateActionVersion = false) {
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
      match = validateActionVersion ? validateExecutorReceiptVersion(value) : value;
    }
  }
  return match;
}

export async function readCanonicalExecutorReceiptByDigest(statePath, receiptDigest) {
  if (!DIGEST.test(receiptDigest || '')) throw new ContractError('executor receipt digest is invalid', EXIT.IDENTITY);
  const executorRoot = join(dirname(statePath), 'executor');
  const findDirect = async (digest) => {
    const primary = await scanImmutableReceiptDirectory(join(executorRoot, 'receipts'), digest, 'executor', true);
    const retry = await scanImmutableReceiptDirectory(join(executorRoot, 'action-retries'), digest, 'action retry', true);
    if (primary && retry) throw new ContractError('executor receipt digest is ambiguous across canonical stores', EXIT.IDENTITY);
    return primary || retry;
  };
  const direct = await findDirect(receiptDigest);
  const recovery = direct ? null : await scanImmutableReceiptDirectory(join(executorRoot, 'recoveries'), receiptDigest, 'executor recovery');
  if (!direct && !recovery) throw new ContractError('executor receipt digest is not present in the canonical store', EXIT.IDENTITY);
  const receipt = direct || await findDirect(recovery.originalReceiptDigest);
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
      throw new ContractError(`resource ${resourceId} does not prove completed executor receipt ` +
        `(pending=${resource.pendingAction !== null};epoch=${resource.highestAcceptedFencingEpoch};` +
        `head=${resource.receiptChainHead || 'null'};expected=${acceptedDigest})`, EXIT.IDENTITY);
    }
  }
  return { receipt, acceptedReceipt };
}
