import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { sha256 } from '../release/lib/contracts.mjs';
import {
  acceptResourceActionGroup, acceptResourceEpoch, acquireResourceLocks, beginResourceActionGroup,
  completeResourceAction, completeResourceActionGroup, inspectLockedResourceState,
  markResourceActionGroupExecuting, markResourceActionGroupMutating, markResourceActionGroupReceipt,
  readResourceActionGroup, releaseResourceLocks,
} from '../release/lib/fenced-resource-store.mjs';

test('action-group journal resumes partial accept and partial complete without a second resource mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'booking-action-group-'));
  const statePath = join(root, 'preprod', 'booking-preprod', 'deploy-state.json');
  const resourceIds = ['booking-preprod-edge', 'booking-preprod-data'];
  const binding = {
    environment: 'preprod', project: 'booking-preprod', operationId: 'op-group-1', generation: 7, fencingEpoch: 2,
    action: 'preprod-transfer-singletons', actionId: 'group-crash-1', requestDigest: `sha256:${'1'.repeat(64)}`,
    manifestDigest: `sha256:${'2'.repeat(64)}`, approvalId: 'approval-2', leaseId: 'lease-2', holderId: 'owner-2',
    commandDigest: `sha256:${'3'.repeat(64)}`, allowedPreviousManifestDigest: null, now: '2026-09-13T10:00:00.000Z',
  };
  let locks = await acquireResourceLocks(statePath, resourceIds);
  try {
    const group = await beginResourceActionGroup(statePath, locks, binding);
    // Crash after the first resource CAS but before its journal progress write.
    await acceptResourceEpoch(locks[0], { ...binding, resourceId: locks[0].resourceId, groupDigest: group.value.groupDigest });
  } finally { await releaseResourceLocks(locks); }

  locks = await acquireResourceLocks(statePath, resourceIds);
  try {
    const accepted = await acceptResourceActionGroup(statePath, locks, { ...binding, now: '2026-09-13T10:00:01.000Z' });
    assert.equal(accepted.states.length, 2);
    assert.ok(accepted.states.every((state) => state.pendingAction.requestDigest === binding.requestDigest));
    await markResourceActionGroupMutating(statePath, { ...binding, now: '2026-09-13T10:00:02.000Z' }, resourceIds);
    const receiptDigest = sha256('durable-pass-receipt');
    await markResourceActionGroupReceipt(statePath, { ...binding, now: '2026-09-13T10:00:03.000Z' }, resourceIds, receiptDigest);
    // Crash after completing only one resource.
    await completeResourceAction(locks[0], { ...binding, resourceId: locks[0].resourceId,
      now: '2026-09-13T10:00:04.000Z' }, receiptDigest);
  } finally { await releaseResourceLocks(locks); }

  locks = await acquireResourceLocks(statePath, resourceIds);
  try {
    const completed = await completeResourceActionGroup(statePath, locks, { ...binding,
      now: '2026-09-13T10:00:05.000Z' }, sha256('durable-pass-receipt'));
    assert.equal(completed.phase, 'COMPLETED');
    assert.deepEqual(completed.completedResourceIds, [...resourceIds].sort());
    for (const lock of locks) {
      const state = await inspectLockedResourceState(lock, { ...binding, resourceId: lock.resourceId });
      assert.equal(state.pendingAction, null);
      assert.equal(state.receiptChainHead, sha256('durable-pass-receipt'));
    }
    const journals = join(dirname(statePath), 'executor', 'action-groups');
    const journal = JSON.parse(await readFile(join(journals, '000000000002-preprod-transfer-singletons-group-crash-1.json'), 'utf8'));
    assert.equal(journal.phase, 'COMPLETED');
  } finally {
    await releaseResourceLocks(locks);
    await rm(root, { recursive: true, force: true });
  }
});

test('action-group phase invariants reject empty COMPLETED journals and record the dispatch boundary once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'booking-action-group-invariants-'));
  const statePath = join(root, 'preprod', 'booking-preprod', 'deploy-state.json');
  const resourceIds = ['booking-preprod-edge'];
  const binding = { environment: 'preprod', project: 'booking-preprod', operationId: 'op-group-2', generation: 8, fencingEpoch: 3,
    action: 'preprod-stage', actionId: 'group-dispatch-1', requestDigest: `sha256:${'4'.repeat(64)}`,
    manifestDigest: `sha256:${'5'.repeat(64)}`, approvalId: 'approval-3', leaseId: 'lease-3', holderId: 'owner-3',
    commandDigest: `sha256:${'6'.repeat(64)}`, allowedPreviousManifestDigest: null, now: '2026-09-13T11:00:00.000Z' };
  const locks = await acquireResourceLocks(statePath, resourceIds);
  try {
    await acceptResourceActionGroup(statePath, locks, binding);
    await markResourceActionGroupMutating(statePath, { ...binding, now: '2026-09-13T11:00:01.000Z' }, resourceIds);
    const executing = await markResourceActionGroupExecuting(statePath, { ...binding, now: '2026-09-13T11:00:02.000Z' }, resourceIds);
    assert.equal(executing.phase, 'EXECUTING');
    await assert.rejects(markResourceActionGroupExecuting(statePath, { ...binding, now: '2026-09-13T11:00:03.000Z' }, resourceIds),
      /no unconsumed mutation dispatch/);
    const journal = await readResourceActionGroup(statePath, binding, resourceIds);
    const invalid = { ...journal.value, phase: 'COMPLETED', acceptedResourceIds: [], completedResourceIds: [], receiptDigest: null };
    await writeFile(journal.path, `${JSON.stringify(invalid)}\n`);
    await assert.rejects(readResourceActionGroup(statePath, binding, resourceIds), /phase invariants/);
  } finally {
    await releaseResourceLocks(locks);
    await rm(root, { recursive: true, force: true });
  }
});
