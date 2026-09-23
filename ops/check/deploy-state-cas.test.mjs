import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { ContractError, EXIT, sha256 } from '../release/lib/contracts.mjs';
import { canonicalStatePath, initializeStateFile, mutateStateFile, recoverStaleDeployStateLock } from '../release/lib/deploy-state-store.mjs';
import { MIN_LEASE_DURATION_MS, runManageDeployState } from '../release/manage-deploy-state.mjs';
import { acquireLease, initialDeployState, takeoverExpiredLease, transitionDeployState, validateDeployState } from '../release/lib/state-machine.mjs';
import { runFencedAction } from '../release/execute-fenced-action.mjs';
import { recoverStaleResourceLocks, resourceDirectory } from '../release/lib/fenced-resource-store.mjs';
import { LEGACY_OLD_BINDING } from '../release/lib/legacy-preprod.mjs';
import { runStaleFencingLockRecovery } from '../release/recover-stale-fencing-lock.mjs';

const ACTIVE = { slot: 'blue', releaseId: 'booking-20260907T150000Z-abcdef0', gitSha: 'a'.repeat(40), manifestDigest: `sha256:${'6'.repeat(64)}` };
const CANDIDATE = { slot: 'green', releaseId: 'booking-20260907T160000Z-0123456', gitSha: 'b'.repeat(40), manifestDigest: `sha256:${'7'.repeat(64)}` };
const CHAIN_CANDIDATE = { ...CANDIDATE, slot: 'blue' };
const D = (digit) => `sha256:${digit.repeat(64)}`;
const RUNTIME_ENV_CONTENT = 'FIXTURE_ONLY=true\n';
const DEPLOYMENT = {
  environment: 'preprod', project: 'booking-preprod',
  resources: { edgeNetwork: 'booking-preprod-edge', dataNetwork: 'booking-preprod-data', databaseRef: 'database:booking-preprod', ingressRef: 'ingress:booking-preprod' },
  active: ACTIVE, runtimeEnvDigest: sha256(RUNTIME_ENV_CONTENT), observationWindowMinutes: 1,
};

function acquired() {
  return acquireLease(initialDeployState(DEPLOYMENT, '2026-09-07T15:00:00.000Z'), {
    expectedGeneration: 0, expectedFencingEpoch: 0, operationId: 'op-1', approvalId: 'approval-1',
    leaseId: 'lease-1', holderId: 'owner-1', now: '2026-09-07T15:01:00.000Z', expiresAt: '2026-09-07T16:00:00.000Z', candidate: CANDIDATE,
  });
}

function step(state, to, extra = {}) {
  return transitionDeployState(state, {
    expectedGeneration: state.generation, expectedFencingEpoch: state.fencingEpoch,
    leaseId: state.lease.leaseId, holderId: state.lease.holderId, now: '2026-09-07T15:30:00.000Z',
    to, manifestDigest: CANDIDATE.manifestDigest, ...extra,
  });
}

test('full switch and rollback lifecycle preserves immutable rollback identity', () => {
  let state = acquired();
  state = step(state, 'MANIFEST_VERIFIED');
  state = step(state, 'STAGED');
  state = step(state, 'EXPAND_MIGRATED', { expandMigrationReceiptDigest: D('e') });
  state = step(state, 'CANDIDATE_STARTED', { telegramEgressReceiptDigest: D('6'), stageReceiptDigest: D('7') });
  assert.throws(() => step(state, 'CANDIDATE_READY'), (error) => error.exitCode === EXIT.READINESS);
  state = step(state, 'CANDIDATE_READY', { candidateProbeDigest: D('8') });
  assert.throws(() => step(state, 'SINGLETON_TRANSFERRED', { rollbackPreSwitchProbeDigest: D('9') }), (error) => error.exitCode === EXIT.SINGLETON);
  state = step(state, 'SINGLETON_TRANSFERRED', { rollbackPreSwitchProbeDigest: D('9'), singletonTransferReceiptDigest: D('4') });
  assert.throws(() => step(state, 'SWITCHED'), (error) => error.exitCode === EXIT.SWITCH);
  state = step(state, 'SWITCHED', { switchReceiptDigest: D('1') });
  assert.deepEqual(state.active, CANDIDATE);
  assert.deepEqual(state.rollback, ACTIVE);
  state = step(state, 'OBSERVING', { webhookReceiptDigest: D('6') });
  state = step(state, 'ROLLBACK_PENDING');
  assert.throws(() => step(state, 'ROLLED_BACK', { rollbackSingletonTransferReceiptDigest: D('5'), rolledBackProbeDigest: D('3') }),
    /post-switch rollback requires.*ingress receipt/);
  assert.throws(() => step(state, 'ROLLED_BACK', { rollbackReceiptDigest: D('2'), rolledBackProbeDigest: D('3') }), (error) => error.exitCode === EXIT.ROLLBACK);
  state = step(state, 'ROLLED_BACK', { now: '2026-09-07T15:31:00.000Z', rollbackReceiptDigest: D('2'), rollbackSingletonTransferReceiptDigest: D('5'), rolledBackProbeDigest: D('3') });
  assert.deepEqual(state.active, ACTIVE);
  assert.equal(state.rollbackRehearsalCompleted, true);
  state = step(state, 'IDLE');
  assert.equal(state.lease, null);
  assert.equal(state.rollback, null);
  assert.equal(state.generation, 12);
  assert.equal(state.rollbackRehearsalCompleted, false);
});

test('FAILED preserves distinct pre-switch and post-switch rollback identities', () => {
  let state = acquired();
  state = step(state, 'MANIFEST_VERIFIED');
  const preSwitchFailed = step(state, 'FAILED');
  assert.deepEqual(validateDeployState(preSwitchFailed).active, ACTIVE);
  assert.deepEqual(preSwitchFailed.candidate, CANDIDATE);
  assert.equal(preSwitchFailed.evidence.switchReceiptDigest, null);

  state = step(state, 'STAGED');
  state = step(state, 'EXPAND_MIGRATED', { expandMigrationReceiptDigest: D('e') });
  state = step(state, 'CANDIDATE_STARTED', { telegramEgressReceiptDigest: D('6'), stageReceiptDigest: D('7') });
  state = step(state, 'CANDIDATE_READY', { candidateProbeDigest: D('8') });
  state = step(state, 'SINGLETON_TRANSFERRED', { rollbackPreSwitchProbeDigest: D('9'), singletonTransferReceiptDigest: D('4') });
  state = step(state, 'SWITCHED', { switchReceiptDigest: D('1') });
  const rollbackPending = step(state, 'ROLLBACK_PENDING');
  const postSwitchFailed = step(rollbackPending, 'FAILED');
  assert.deepEqual(validateDeployState(postSwitchFailed).active, CANDIDATE);
  assert.deepEqual(postSwitchFailed.rollback, ACTIVE);
  assert.equal(postSwitchFailed.candidate, null);
  assert.equal(postSwitchFailed.evidence.switchReceiptDigest, D('1'));

  const rollbackForbidden = step(state, 'AUTOMATIC_ROLLBACK_FORBIDDEN');
  assert.equal(step(rollbackForbidden, 'FAILED').phase, 'FAILED');

  assert.throws(() => validateDeployState({ ...postSwitchFailed, evidence: { ...postSwitchFailed.evidence, switchReceiptDigest: null } }),
    /failed state must retain a valid pre-switch or post-switch rollback identity/);
  assert.throws(() => validateDeployState({ ...postSwitchFailed, candidate: ACTIVE }),
    /failed state must retain a valid pre-switch or post-switch rollback identity/);
  assert.throws(() => validateDeployState({ ...postSwitchFailed, rollback: CANDIDATE }),
    /failed state must retain a valid pre-switch or post-switch rollback identity/);
  assert.throws(() => validateDeployState({ ...postSwitchFailed, rollback: null }),
    /failed state must retain a valid pre-switch or post-switch rollback identity/);
  assert.throws(() => validateDeployState({ ...preSwitchFailed, evidence: { ...preSwitchFailed.evidence, switchReceiptDigest: D('1') } }),
    /failed state must retain a valid pre-switch or post-switch rollback identity/);
  assert.throws(() => validateDeployState({ ...postSwitchFailed, phase: 'FAILED_RECOVERED' }),
    /pre-switch rollback identity must equal active identity/);
});

test('stale generation, stale fence, wrong lease, and expired lease all fail closed', () => {
  const state = acquired();
  const base = { expectedGeneration: state.generation, expectedFencingEpoch: state.fencingEpoch, leaseId: 'lease-1', holderId: 'owner-1', now: '2026-09-07T15:30:00.000Z', to: 'MANIFEST_VERIFIED', manifestDigest: CANDIDATE.manifestDigest };
  assert.throws(() => transitionDeployState(state, { ...base, expectedGeneration: 0 }), (error) => error.exitCode === EXIT.SWITCH);
  assert.throws(() => transitionDeployState(state, { ...base, expectedFencingEpoch: 0 }), (error) => error.exitCode === EXIT.SWITCH);
  assert.throws(() => transitionDeployState(state, { ...base, leaseId: 'stale' }), (error) => error.exitCode === EXIT.SINGLETON);
  assert.throws(() => transitionDeployState(state, { ...base, now: state.lease.expiresAt }), (error) => error.exitCode === EXIT.SINGLETON);
});

test('rollback before ingress switch restores the old singleton while retaining the inactive failed candidate identity', () => {
  let state = acquired();
  state = step(state, 'MANIFEST_VERIFIED');
  state = step(state, 'STAGED');
  state = step(state, 'EXPAND_MIGRATED', { expandMigrationReceiptDigest: D('e') });
  state = step(state, 'CANDIDATE_STARTED', { telegramEgressReceiptDigest: D('6'), stageReceiptDigest: D('7') });
  state = step(state, 'CANDIDATE_READY', { candidateProbeDigest: D('8') });
  state = step(state, 'SINGLETON_TRANSFERRED', { rollbackPreSwitchProbeDigest: D('9'), singletonTransferReceiptDigest: D('4') });
  state = step(state, 'ROLLBACK_PENDING');
  assert.throws(() => step(state, 'ROLLED_BACK', { rollbackReceiptDigest: D('2'), rollbackSingletonTransferReceiptDigest: D('5'), rolledBackProbeDigest: D('3') }),
    /without ingress mutation evidence/);
  state = step(state, 'ROLLED_BACK', { rollbackSingletonTransferReceiptDigest: D('5'), rolledBackProbeDigest: D('3') });
  assert.deepEqual(state.active, ACTIVE);
  assert.deepEqual(state.candidate, CANDIDATE);
  assert.equal(state.evidence.rollbackReceiptDigest, null);
  assert.equal(state.rollbackRehearsalCompleted, false);
});

test('expired lease takeover increments fence and permanently rejects the old holder', () => {
  const state = acquired();
  const takeover = takeoverExpiredLease(state, {
    expectedGeneration: 1, expectedFencingEpoch: 1, approvalId: 'approval-2', leaseId: 'lease-2', holderId: 'owner-2',
    now: '2026-09-07T16:00:00.000Z', expiresAt: '2026-09-07T17:00:00.000Z',
  });
  assert.equal(takeover.fencingEpoch, 2);
  assert.equal(takeover.generation, 2);
  assert.throws(() => transitionDeployState(takeover, {
    expectedGeneration: 2, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-07T16:01:00.000Z', to: 'MANIFEST_VERIFIED', manifestDigest: CANDIDATE.manifestDigest,
  }), ContractError);
});

test('expand migration remains rollback-compatible while a real contract migration blocks automatic rollback', () => {
  let state = acquired();
  state = step(state, 'MANIFEST_VERIFIED');
  state = step(state, 'STAGED');
  state = step(state, 'EXPAND_MIGRATED', { expandMigrationReceiptDigest: D('6') });
  state = step(state, 'CANDIDATE_STARTED', { telegramEgressReceiptDigest: D('6'), stageReceiptDigest: D('7') });
  state = step(state, 'CANDIDATE_READY', { candidateProbeDigest: D('8') });
  assert.equal(state.contractMigrationApplied, false);
  state = step(state, 'SINGLETON_TRANSFERRED', { rollbackPreSwitchProbeDigest: D('9'), singletonTransferReceiptDigest: D('4') });
  state = step(state, 'SWITCHED', { switchReceiptDigest: D('1') });
  const observingWithoutRehearsal = step(state, 'OBSERVING', { webhookReceiptDigest: D('a') });
  assert.throws(() => step(observingWithoutRehearsal, 'COMMITTED', { observationReceiptDigest: D('b') }),
    /completed rollback rehearsal/);
  const rollbackPending = step(state, 'ROLLBACK_PENDING');
  assert.equal(rollbackPending.phase, 'ROLLBACK_PENDING');
  const afterContract = { ...state, contractMigrationApplied: true };
  validateDeployState(afterContract);
  assert.throws(() => step(afterContract, 'ROLLBACK_PENDING'), (error) => error.exitCode === EXIT.ROLLBACK);
});

test('observation timing never blocks emergency rollback but only a completed window qualifies rehearsal and commit', () => {
  const reachObserving = () => {
    let state = acquired();
    state = step(state, 'MANIFEST_VERIFIED');
    state = step(state, 'STAGED');
    state = step(state, 'EXPAND_MIGRATED', { expandMigrationReceiptDigest: D('e') });
    state = step(state, 'CANDIDATE_STARTED', { telegramEgressReceiptDigest: D('6'), stageReceiptDigest: D('7') });
    state = step(state, 'CANDIDATE_READY', { candidateProbeDigest: D('8') });
    state = step(state, 'SINGLETON_TRANSFERRED', { rollbackPreSwitchProbeDigest: D('9'), singletonTransferReceiptDigest: D('4') });
    state = step(state, 'SWITCHED', { switchReceiptDigest: D('1') });
    return step(state, 'OBSERVING', { now: '2026-09-07T15:30:00.000Z', webhookReceiptDigest: D('6') });
  };

  let emergency = reachObserving();
  emergency = step(emergency, 'ROLLBACK_PENDING', { now: '2026-09-07T15:30:10.000Z' });
  emergency = step(emergency, 'ROLLED_BACK', { now: '2026-09-07T15:30:20.000Z', rollbackReceiptDigest: D('2'),
    rollbackSingletonTransferReceiptDigest: D('5'), rolledBackProbeDigest: D('3') });
  assert.equal(emergency.rollbackRehearsalCompleted, false, 'an immediate safety rollback must remain available without qualifying as rehearsal');

  let qualified = reachObserving();
  qualified = step(qualified, 'ROLLBACK_PENDING', { now: '2026-09-07T15:30:10.000Z' });
  qualified = step(qualified, 'ROLLED_BACK', { now: '2026-09-07T15:31:00.000Z', rollbackReceiptDigest: D('2'),
    rollbackSingletonTransferReceiptDigest: D('5'), rolledBackProbeDigest: D('3') });
  assert.equal(qualified.rollbackRehearsalCompleted, true);

  qualified = step(qualified, 'CANDIDATE_STARTED', { telegramEgressReceiptDigest: D('6'), stageReceiptDigest: D('7'), now: '2026-09-07T15:32:00.000Z' });
  qualified = step(qualified, 'CANDIDATE_READY', { candidateProbeDigest: D('8'), now: '2026-09-07T15:33:00.000Z' });
  qualified = step(qualified, 'SINGLETON_TRANSFERRED', { rollbackPreSwitchProbeDigest: D('9'), singletonTransferReceiptDigest: D('4'), now: '2026-09-07T15:34:00.000Z' });
  qualified = step(qualified, 'SWITCHED', { switchReceiptDigest: D('1'), now: '2026-09-07T15:35:00.000Z' });
  qualified = step(qualified, 'OBSERVING', { webhookReceiptDigest: D('6'), now: '2026-09-07T15:36:00.000Z' });
  assert.throws(() => step(qualified, 'COMMITTED', { observationReceiptDigest: D('b'), now: '2026-09-07T15:36:59.999Z' }),
    /observation window/);
  qualified = step(qualified, 'COMMITTED', { observationReceiptDigest: D('b'), now: '2026-09-07T15:37:00.000Z' });
  assert.equal(qualified.phase, 'COMMITTED');
});

test('atomic file store serializes writers and leaves parseable state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-state-'));
  const path = join(directory, 'deploy-state.json');
  try {
    await initializeStateFile(path, initialDeployState(DEPLOYMENT, '2026-09-07T15:00:00.000Z'));
    const mutate = () => mutateStateFile(path, (state) => acquireLease(state, {
      expectedGeneration: 0, expectedFencingEpoch: 0, operationId: 'op-1', approvalId: 'approval-1', leaseId: 'lease-1', holderId: 'owner-1',
      now: '2026-09-07T15:01:00.000Z', expiresAt: '2026-09-07T16:00:00.000Z', candidate: CANDIDATE,
    }));
    const results = await Promise.allSettled([mutate(), mutate()]);
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(results.filter((item) => item.status === 'rejected').length, 1);
    validateDeployState(JSON.parse(await readFile(path, 'utf8')));
    assert.equal(JSON.parse(await readFile(path, 'utf8')).generation, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('pre-existing filesystem lock is fail-closed and never overwritten', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-state-lock-'));
  const path = join(directory, 'deploy-state.json');
  try {
    await writeFile(`${path}.lock`, 'forensic-lock');
    await assert.rejects(initializeStateFile(path, initialDeployState(DEPLOYMENT, '2026-09-07T15:00:00.000Z')), (error) => error.exitCode === EXIT.SINGLETON);
    assert.equal(await readFile(`${path}.lock`, 'utf8'), 'forensic-lock');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('even a stale-looking lock requires explicit forensic recovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-state-stale-lock-'));
  const path = join(directory, 'deploy-state.json');
  const nowMs = Date.parse('2026-09-07T15:00:00.000Z');
  try {
    const lock = JSON.stringify({ pid: 2147483647, acquiredAt: new Date(nowMs - 86_400_000).toISOString(), nonce: 'stale' });
    await writeFile(`${path}.lock`, lock);
    await assert.rejects(initializeStateFile(path, initialDeployState(DEPLOYMENT, new Date(nowMs).toISOString()), { nowMs }), /explicit forensic recovery/);
    assert.equal(await readFile(`${path}.lock`, 'utf8'), lock);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('all existing lock identities are fail-closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-state-lock-conditions-'));
  const nowMs = Date.parse('2026-09-07T15:00:00.000Z');
  try {
    const recentPath = join(directory, 'recent.json');
    await writeFile(`${recentPath}.lock`, JSON.stringify({ pid: 2147483647, acquiredAt: new Date(nowMs - 1_000).toISOString(), nonce: 'recent' }));
    await assert.rejects(initializeStateFile(recentPath, initialDeployState(DEPLOYMENT, new Date(nowMs).toISOString()), { nowMs }), (error) => error.exitCode === EXIT.SINGLETON);

    const livePath = join(directory, 'live.json');
    await writeFile(`${livePath}.lock`, JSON.stringify({ pid: process.pid, acquiredAt: new Date(nowMs - 86_400_000).toISOString(), nonce: 'live' }));
    await assert.rejects(initializeStateFile(livePath, initialDeployState(DEPLOYMENT, new Date(nowMs).toISOString()), { nowMs }), (error) => error.exitCode === EXIT.SINGLETON);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('explicit deployment lock recovery requires expired lease, dead PID, and exact immutable byte digests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-state-lock-recovery-'));
  const path = join(directory, 'deploy-state.json');
  const nowMs = Date.parse('2026-09-07T16:00:01.000Z');
  try {
    const stateBytes = `${JSON.stringify(acquired(), null, 2)}\n`;
    const lockBytes = `${JSON.stringify({ pid: 1, ownerContainerId: 'a'.repeat(12), ownerContainerName: 'booking-preprod-control-plane',
      acquiredAt: '2026-09-07T15:00:00.000Z', nonce: 'dead-lock-1' })}\n`;
    await writeFile(path, stateBytes);
    await writeFile(`${path}.lock`, lockBytes);
    const dead = async () => false;
    await assert.rejects(recoverStaleDeployStateLock(path, {
      expectedLockDigest: D('f'), expectedStateDigest: sha256(stateBytes), nowMs, ownerContainerProbe: dead,
    }), /digest mismatch/);
    assert.equal(await readFile(`${path}.lock`, 'utf8'), lockBytes);
    await assert.rejects(recoverStaleDeployStateLock(path, {
      expectedLockDigest: sha256(lockBytes), expectedStateDigest: sha256(stateBytes), nowMs, ownerContainerProbe: async () => true,
    }), /still alive/);
    const receipt = await recoverStaleDeployStateLock(path, {
      expectedLockDigest: sha256(lockBytes), expectedStateDigest: sha256(stateBytes), nowMs, ownerContainerProbe: dead,
    });
    assert.equal(receipt.kind, 'deployment');
    assert.equal(receipt.lockDigest, sha256(lockBytes));
    await assert.rejects(readFile(`${path}.lock`, 'utf8'), /ENOENT/);
    const names = await readdir(join(directory, 'executor', 'lock-recoveries'));
    assert.deepEqual(names, [`deploy-${receipt.receiptDigest.slice(7)}.json`]);
    const replay = await recoverStaleDeployStateLock(path, {
      expectedLockDigest: sha256(lockBytes), expectedStateDigest: sha256(stateBytes), nowMs, ownerContainerProbe: dead,
    });
    assert.equal(replay.receiptDigest, receipt.receiptDigest);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('explicit resource lock group recovery is all-digests-bound and crash-continuable only from its receipt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-resource-lock-recovery-'));
  const path = join(directory, 'deploy-state.json');
  const nowMs = Date.parse('2026-09-07T16:00:01.000Z');
  try {
    const stateBytes = `${JSON.stringify(acquired(), null, 2)}\n`;
    await writeFile(path, stateBytes);
    const ids = ['booking-preprod-edge', 'booking-preprod-data'];
    const recoveries = [];
    for (const [index, resourceId] of ids.entries()) {
      const resourceRoot = resourceDirectory(path, resourceId);
      await mkdir(resourceRoot, { recursive: true });
      const bytes = `${JSON.stringify({ pid: 1, ownerContainerId: `${index + 1}`.repeat(12), ownerContainerName: 'booking-preprod-control-plane',
        acquiredAt: '2026-09-07T15:00:00.000Z', nonce: `dead-resource-${index}` })}\n`;
      await writeFile(join(resourceRoot, 'resource-state.lock'), bytes);
      recoveries.push({ resourceId, lockDigest: sha256(bytes) });
    }
    const dead = async () => false;
    await assert.rejects(recoverStaleResourceLocks(path, [{ ...recoveries[0], lockDigest: D('f') }, recoveries[1]], {
      expectedStateDigest: sha256(stateBytes), nowMs, ownerContainerProbe: dead,
    }), /digest mismatch/);
    const receipt = await recoverStaleResourceLocks(path, recoveries, {
      expectedStateDigest: sha256(stateBytes), nowMs, ownerContainerProbe: dead,
    });
    assert.equal(receipt.kind, 'resource-group');
    for (const resourceId of ids) await assert.rejects(readFile(join(resourceDirectory(path, resourceId), 'resource-state.lock')), /ENOENT/);
    const replay = await recoverStaleResourceLocks(path, recoveries, {
      expectedStateDigest: sha256(stateBytes), nowMs, ownerContainerProbe: dead,
    });
    assert.equal(replay.receiptDigest, receipt.receiptDigest);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('strict stale-lock CLI proves the recorded control container is absent through a live Docker daemon', async () => {
  const root = await mkdtemp(join(tmpdir(), 'booking-lock-cli-'));
  try {
    const statePath = await canonicalStatePath({ environment: 'preprod', project: 'booking-preprod', deployStateRoot: root });
    const stateBytes = `${JSON.stringify(acquired(), null, 2)}\n`;
    const lockBytes = `${JSON.stringify({ pid: 1, ownerContainerId: 'b'.repeat(12), ownerContainerName: 'booking-preprod-control-plane',
      acquiredAt: '2026-09-07T15:00:00.000Z', nonce: 'cli-dead-lock' })}\n`;
    await writeFile(statePath, stateBytes);
    await writeFile(`${statePath}.lock`, lockBytes);
    const calls = [];
    const receipt = await runStaleFencingLockRecovery({ action: 'recover-deploy-lock', execute: 'true',
      environment: 'preprod', project: 'booking-preprod', 'expected-state-digest': sha256(stateBytes),
      'expected-lock-digest': sha256(lockBytes) }, { deployStateRoot: root,
      nowMs: Date.parse('2026-09-07T16:00:01.000Z'), commandRunner: async (_file, argv) => {
        calls.push(argv);
        return argv[0] === 'info' ? { exitCode: 0, stdout: '24.0.2\n', stderr: '' }
          : { exitCode: 1, stdout: '', stderr: 'not found' };
      } });
    assert.equal(receipt.kind, 'deployment');
    assert.deepEqual(calls.map((argv) => argv[0]), ['container', 'info', 'container', 'container']);
    await assert.rejects(runStaleFencingLockRecovery({ action: 'recover-deploy-lock', execute: 'true',
      environment: 'production', project: 'booking-prod', 'expected-state-digest': sha256(stateBytes),
      'expected-lock-digest': sha256(lockBytes) }), /outside preproduction/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('stale-lock CLI distinguishes stopped owners, daemon restart, name-ID mismatch, and PID reuse', async (t) => {
  const runCase = async (label, lockOverrides, commandRunner, expected) => t.test(label, async () => {
    const root = await mkdtemp(join(tmpdir(), 'booking-lock-owner-proof-'));
    try {
      const statePath = await canonicalStatePath({ environment: 'preprod', project: 'booking-preprod', deployStateRoot: root });
      const stateBytes = `${JSON.stringify(acquired(), null, 2)}\n`;
      const lock = { pid: 1, ownerContainerId: 'b'.repeat(12), ownerContainerName: 'booking-preprod-control-plane', acquiredAt: '2026-09-07T15:00:00.000Z',
        nonce: `owner-${label.replaceAll(' ', '-')}`, ...lockOverrides };
      const lockBytes = `${JSON.stringify(lock)}\n`;
      await writeFile(statePath, stateBytes);
      await writeFile(`${statePath}.lock`, lockBytes);
      const promise = runStaleFencingLockRecovery({ action: 'recover-deploy-lock', execute: 'true', environment: 'preprod',
        project: 'booking-preprod', 'expected-state-digest': sha256(stateBytes), 'expected-lock-digest': sha256(lockBytes) }, {
        deployStateRoot: root, nowMs: Date.parse('2026-09-07T16:00:01.000Z'), commandRunner,
      });
      if (expected instanceof RegExp) await assert.rejects(promise, expected);
      else assert.equal((await promise).kind, expected);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  const inspectValue = (id, name = 'booking-preprod-control-plane', running = false) => ({ exitCode: 0, stderr: '',
    stdout: JSON.stringify({ Id: id, Name: `/${name}`, Running: running }) });
  await runCase('stopped owner', {}, async () => inspectValue('b'.repeat(64), undefined, false), 'deployment');
  await runCase('running owner', {}, async () => inspectValue('b'.repeat(64), undefined, true), /still alive/);
  await runCase('name ID mismatch', {}, async () => inspectValue('c'.repeat(64)), /recorded HOSTNAME ID/);
  await runCase('wrong owner name', {}, async () => inspectValue('b'.repeat(64), 'foreign-control'), /fixed control-plane identity/);
  await runCase('wrong recorded owner name', { ownerContainerName: 'foreign-control' }, async () => inspectValue('b'.repeat(64)),
  /lock identity is invalid/);
  await runCase('missing recorded owner name', { ownerContainerName: undefined }, async () => inspectValue('b'.repeat(64)),
  /lock identity is invalid/);
  await runCase('daemon restart unavailable', {}, async (_file, argv) => argv[0] === 'info'
    ? { exitCode: 1, stdout: '', stderr: 'restarting' } : { exitCode: 1, stdout: '', stderr: 'not found' },
  /daemon cannot prove/);
  await runCase('PID namespace reuse', { pid: process.pid }, async (_file, argv) => argv[0] === 'info'
    ? { exitCode: 0, stdout: '24.0.2\n', stderr: '' } : { exitCode: 1, stdout: '', stderr: 'not found' }, 'deployment');
});

test('canonical CLI derives path and time, and rejects caller path/time or unbounded lease', async () => {
  const root = await mkdtemp(join(tmpdir(), 'booking-canonical-root-'));
  const runtimeEnvFile = join(root, '.runtime.env');
  const legacyActive = { slot: 'green', releaseId: LEGACY_OLD_BINDING.releaseId, gitSha: LEGACY_OLD_BINDING.gitSha,
    manifestDigest: LEGACY_OLD_BINDING.manifestRawDigest };
  const common = {
    action: 'init', execute: 'true', environment: 'preprod', project: 'booking-preprod', 'approval-id': 'approval-1',
    'expected-generation': '0', 'expected-fencing-epoch': '0', 'manifest-digest': legacyActive.manifestDigest,
    'active-slot': legacyActive.slot, 'active-release': legacyActive.releaseId, 'active-git-sha': legacyActive.gitSha, 'active-manifest-digest': legacyActive.manifestDigest,
    'edge-network': 'booking-preprod-edge', 'data-network': 'booking-preprod-data', 'database-ref': 'database:booking-preprod', 'ingress-ref': 'ingress:booking-preprod',
    'observation-window-minutes': '1',
  };
  try {
    await writeFile(runtimeEnvFile, RUNTIME_ENV_CONTENT, { mode: 0o600 });
    const runtimeBase = { deployStateRoot: root, runtimeEnvFile, allowInsecureTestPaths: true };
    await runManageDeployState(common, { ...runtimeBase, nowMs: Date.parse('2026-09-07T15:00:00.000Z') });
    const path = await canonicalStatePath({ environment: 'preprod', project: 'booking-preprod', deployStateRoot: root });
    assert.equal(JSON.parse(await readFile(path, 'utf8')).updatedAt, '2026-09-07T15:00:00.000Z');
    assert.equal(JSON.parse(await readFile(path, 'utf8')).runtimeEnvDigest, sha256(RUNTIME_ENV_CONTENT));
    await assert.rejects(runManageDeployState({ ...common, state: join(root, 'other.json') }, runtimeBase), /--state is forbidden/);
    await assert.rejects(runManageDeployState({ ...common, now: '2099-01-01T00:00:00.000Z' }, runtimeBase), /--now is forbidden/);
    const acquire = {
      action: 'acquire', execute: 'true', environment: 'preprod', project: 'booking-preprod', 'approval-id': 'approval-1',
      'expected-generation': '0', 'expected-fencing-epoch': '0', 'manifest-digest': CANDIDATE.manifestDigest,
      'candidate-slot': CANDIDATE.slot, 'candidate-release': CANDIDATE.releaseId, 'candidate-git-sha': CANDIDATE.gitSha, 'candidate-manifest-digest': CANDIDATE.manifestDigest,
      'operation-id': 'op-1', 'lease-id': 'lease-1', 'holder-id': 'owner-1', 'lease-duration-ms': String(MIN_LEASE_DURATION_MS - 1),
      'observation-window-minutes': '1',
    };
    await assert.rejects(runManageDeployState(acquire, { ...runtimeBase, nowMs: Date.parse('2026-09-07T15:01:00.000Z') }), /lease-duration-ms must be between/);
    const changedRuntime = 'FIXTURE_ONLY=changed\n';
    await writeFile(runtimeEnvFile, changedRuntime, { mode: 0o600 });
    const locked = await runManageDeployState({ ...acquire, 'lease-duration-ms': String(MIN_LEASE_DURATION_MS),
      'candidate-slot': CHAIN_CANDIDATE.slot, 'candidate-release': CHAIN_CANDIDATE.releaseId,
      'candidate-git-sha': CHAIN_CANDIDATE.gitSha, 'candidate-manifest-digest': CHAIN_CANDIDATE.manifestDigest,
      'manifest-digest': CHAIN_CANDIDATE.manifestDigest }, { ...runtimeBase, nowMs: Date.parse('2026-09-07T15:01:00.000Z') });
    assert.equal(locked.runtimeEnvDigest, sha256(changedRuntime));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('absent-state bootstrap rejects every active identity except the exact fixed legacy binding', async () => {
  const cases = [
    { ...LEGACY_OLD_BINDING, slot: 'blue' },
    { ...LEGACY_OLD_BINDING, releaseId: ACTIVE.releaseId, slot: 'green' },
    { ...LEGACY_OLD_BINDING, gitSha: ACTIVE.gitSha, slot: 'green' },
    { ...LEGACY_OLD_BINDING, manifestRawDigest: ACTIVE.manifestDigest, slot: 'green' },
  ];
  for (const active of cases) {
    const root = await mkdtemp(join(tmpdir(), 'booking-bootstrap-reject-'));
    const runtimeEnvFile = join(root, '.runtime.env');
    await writeFile(runtimeEnvFile, RUNTIME_ENV_CONTENT, { mode: 0o600 });
    try {
      await assert.rejects(runManageDeployState({ action: 'init', execute: 'true', environment: 'preprod', project: 'booking-preprod',
        'approval-id': 'approval-1', 'expected-generation': '0', 'expected-fencing-epoch': '0',
        'manifest-digest': active.manifestRawDigest, 'active-slot': active.slot, 'active-release': active.releaseId,
        'active-git-sha': active.gitSha, 'active-manifest-digest': active.manifestRawDigest,
        'edge-network': 'booking-preprod-edge', 'data-network': 'booking-preprod-data', 'database-ref': 'database:booking-preprod',
        'ingress-ref': 'ingress:booking-preprod', 'observation-window-minutes': '1' }, { deployStateRoot: root, runtimeEnvFile, allowInsecureTestPaths: true,
        nowMs: Date.parse('2026-09-09T10:00:00.000Z') }), /exact fixed legacy release/);
      const statePath = await canonicalStatePath({ environment: 'preprod', project: 'booking-preprod', deployStateRoot: root });
      await assert.rejects(readFile(statePath), /ENOENT/);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('legacy baseline and expand migration form one canonical predecessor chain before EXPAND_MIGRATED', async () => {
  const root = await mkdtemp(join(tmpdir(), 'booking-baseline-expand-chain-'));
  const legacyActive = { slot: 'green', releaseId: LEGACY_OLD_BINDING.releaseId, gitSha: LEGACY_OLD_BINDING.gitSha,
    manifestDigest: LEGACY_OLD_BINDING.manifestRawDigest };
  const base = { execute: 'true', environment: 'preprod', project: 'booking-preprod', 'approval-id': 'approval-1' };
  const actionBase = { ...base, 'expected-generation': '3', 'expected-fencing-epoch': '1', 'manifest-digest': CHAIN_CANDIDATE.manifestDigest,
    'operation-id': 'op-1', 'lease-id': 'lease-1', 'holder-id': 'owner-1', 'resource-id': 'database:booking-preprod' };
  const runner = async () => ({ exitCode: 0, signal: null, overflow: false, stdout: '{}', stderr: '' });
  const planBuilder = (_state, action) => ({ executable: '/trusted/action', argv: [action.action], cwd: '/trusted/release',
    readback: { executable: '/trusted/action', argv: ['readback', action.action], verify: () => ({ exact: true }) } });
  try {
    const runtimeEnvFile = join(root, '.runtime.env');
    await writeFile(runtimeEnvFile, RUNTIME_ENV_CONTENT, { mode: 0o600 });
    const managerRuntime = (nowMs) => ({ deployStateRoot: root, runtimeEnvFile, allowInsecureTestPaths: true, nowMs });
    const init = await runManageDeployState({ ...base, action: 'init', 'expected-generation': '0', 'expected-fencing-epoch': '0',
      'manifest-digest': legacyActive.manifestDigest, 'active-slot': legacyActive.slot, 'active-release': legacyActive.releaseId,
      'active-git-sha': legacyActive.gitSha, 'active-manifest-digest': legacyActive.manifestDigest,
      'edge-network': 'booking-preprod-edge', 'data-network': 'booking-preprod-data', 'database-ref': 'database:booking-preprod',
      'ingress-ref': 'ingress:booking-preprod', 'observation-window-minutes': '1' }, managerRuntime(Date.parse('2026-09-09T10:00:00.000Z')));
    assert.equal(init.phase, 'IDLE');
    const locked = await runManageDeployState({ ...base, action: 'acquire', 'expected-generation': '0', 'expected-fencing-epoch': '0',
      'manifest-digest': CHAIN_CANDIDATE.manifestDigest, 'candidate-slot': CHAIN_CANDIDATE.slot, 'candidate-release': CHAIN_CANDIDATE.releaseId,
      'candidate-git-sha': CHAIN_CANDIDATE.gitSha, 'candidate-manifest-digest': CHAIN_CANDIDATE.manifestDigest, 'operation-id': 'op-1',
      'lease-id': 'lease-1', 'holder-id': 'owner-1', 'lease-duration-ms': '1800000', 'observation-window-minutes': '1' },
    managerRuntime(Date.parse('2026-09-09T10:01:00.000Z')));
    assert.equal(locked.phase, 'LOCKED');
    const transition = async (generation, to, extra = {}) => runManageDeployState({ ...base, action: 'transition',
      'expected-generation': String(generation), 'expected-fencing-epoch': '1', 'manifest-digest': CHAIN_CANDIDATE.manifestDigest,
      'operation-id': 'op-1', 'lease-id': 'lease-1', 'holder-id': 'owner-1', to, ...extra },
    managerRuntime(Date.parse(`2026-09-09T10:0${generation + 1}:00.000Z`)));
    assert.equal((await transition(1, 'MANIFEST_VERIFIED')).phase, 'MANIFEST_VERIFIED');
    assert.equal((await transition(2, 'STAGED')).phase, 'STAGED');
    const execute = (action, actionId) => runFencedAction({ ...actionBase, action, 'action-id': actionId }, { deployStateRoot: root,
      now: () => new Date('2026-09-09T10:04:00.000Z'), planBuilder, commandRunner: runner });
    const baseline = await execute('preprod-baseline-ledger', 'baseline-1');
    const expand = await execute('preprod-expand-migrate', 'expand-1');
    assert.ok(expand.resources.every((resource) => resource.previousReceiptDigest === baseline.receiptDigest));
    const taken = await runManageDeployState({ ...base, action: 'takeover', 'approval-id': 'approval-2',
      'expected-generation': '3', 'expected-fencing-epoch': '1', 'manifest-digest': CHAIN_CANDIDATE.manifestDigest,
      'operation-id': 'op-1', 'lease-id': 'lease-2', 'holder-id': 'owner-2', 'lease-duration-ms': '1800000' },
    managerRuntime(Date.parse('2026-09-09T10:32:00.000Z')));
    const adoptedExpand = await runFencedAction({ ...actionBase, action: 'preprod-expand-migrate',
      'approval-id': 'approval-2', 'expected-generation': String(taken.generation), 'expected-fencing-epoch': '2',
      'lease-id': 'lease-2', 'holder-id': 'owner-2', 'action-id': 'expand-adopted' }, { deployStateRoot: root,
      now: () => new Date('2026-09-09T10:33:00.000Z'), planBuilder, commandRunner: runner });
    assert.equal(adoptedExpand.verification.adoption.priorReceiptDigest, expand.receiptDigest);
    assert.ok(adoptedExpand.resources.every((resource) => resource.previousReceiptDigest === expand.receiptDigest));
    const transitionAfterTakeover = (baselineDigest) => runManageDeployState({ ...base, action: 'transition', 'approval-id': 'approval-2',
      'expected-generation': String(taken.generation), 'expected-fencing-epoch': '2', 'manifest-digest': CHAIN_CANDIDATE.manifestDigest,
      'operation-id': 'op-1', 'lease-id': 'lease-2', 'holder-id': 'owner-2', to: 'EXPAND_MIGRATED',
      'baseline-receipt-digest': baselineDigest, 'expand-migration-receipt-digest': adoptedExpand.receiptDigest },
    managerRuntime(Date.parse('2026-09-09T10:34:00.000Z')));
    await assert.rejects(transitionAfterTakeover(D('f')), /not present in the canonical store/);
    const migrated = await transitionAfterTakeover(baseline.receiptDigest);
    assert.equal(migrated.phase, 'EXPAND_MIGRATED');
    assert.equal(migrated.evidence.baselineReceiptDigest, baseline.receiptDigest);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('EXPAND_MIGRATED rejects a canonical baseline receipt that is not the expand receipt predecessor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'booking-wrong-baseline-predecessor-'));
  const runtimeEnvFile = join(root, '.runtime.env');
  await writeFile(runtimeEnvFile, RUNTIME_ENV_CONTENT, { mode: 0o600 });
  let state = initialDeployState({ ...DEPLOYMENT, active: { slot: 'green', releaseId: LEGACY_OLD_BINDING.releaseId,
    gitSha: LEGACY_OLD_BINDING.gitSha, manifestDigest: LEGACY_OLD_BINDING.manifestRawDigest } }, '2026-09-09T10:00:00.000Z');
  state = acquireLease(state, { expectedGeneration: 0, expectedFencingEpoch: 0, candidate: CHAIN_CANDIDATE, operationId: 'op-1', approvalId: 'approval-1',
    leaseId: 'lease-1', holderId: 'owner-1', now: '2026-09-09T10:01:00.000Z', expiresAt: '2026-09-09T11:00:00.000Z' });
  state = step(state, 'MANIFEST_VERIFIED');
  state = step(state, 'STAGED');
  const statePath = await canonicalStatePath({ environment: 'preprod', project: 'booking-preprod', deployStateRoot: root });
  const commonAction = { execute: 'true', environment: 'preprod', project: 'booking-preprod', 'approval-id': 'approval-1',
    'expected-generation': '3', 'expected-fencing-epoch': '1', 'manifest-digest': CANDIDATE.manifestDigest, 'operation-id': 'op-1',
    'lease-id': 'lease-1', 'holder-id': 'owner-1', 'resource-id': 'database:booking-preprod' };
  const runtime = { deployStateRoot: root, now: () => new Date('2026-09-09T10:04:00.000Z'),
    planBuilder: (_state, action) => ({ executable: '/trusted/action', argv: [action.action], cwd: '/trusted/release',
      readback: { executable: '/trusted/action', argv: ['readback'], verify: () => ({ exact: true }) } }),
    commandRunner: async () => ({ exitCode: 0, signal: null, overflow: false, stdout: '{}', stderr: '' }) };
  try {
    await initializeStateFile(statePath, state);
    const first = await runFencedAction({ ...commonAction, action: 'preprod-baseline-ledger', 'action-id': 'baseline-first' }, runtime);
    const current = await runFencedAction({ ...commonAction, action: 'preprod-baseline-ledger', 'action-id': 'baseline-current' }, runtime);
    const expand = await runFencedAction({ ...commonAction, action: 'preprod-expand-migrate', 'action-id': 'expand-1' }, runtime);
    assert.ok(expand.resources.every((resource) => resource.previousReceiptDigest === current.receiptDigest));
    await assert.rejects(runManageDeployState({ action: 'transition', execute: 'true', environment: 'preprod', project: 'booking-preprod',
      'approval-id': 'approval-1', 'expected-generation': '4', 'expected-fencing-epoch': '1', 'manifest-digest': CANDIDATE.manifestDigest,
      'operation-id': 'op-1', 'lease-id': 'lease-1', 'holder-id': 'owner-1', to: 'EXPAND_MIGRATED',
      'baseline-receipt-digest': first.receiptDigest, 'expand-migration-receipt-digest': expand.receiptDigest },
    { deployStateRoot: root, runtimeEnvFile, allowInsecureTestPaths: true, nowMs: Date.parse('2026-09-09T10:05:00.000Z') }), /exact baseline predecessor chain/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('terminal transition persists immutable hash-chain receipt before clearing operation state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-state-receipt-'));
  const path = join(directory, 'deploy-state.json');
  try {
    let state = acquired();
    state.phase = 'COMMITTED';
    state.generation = 2;
    state.active = structuredClone(CANDIDATE);
    state.candidate = null;
    state.rollback = structuredClone(ACTIVE);
    state.updatedAt = '2026-09-07T15:20:00.000Z';
    validateDeployState(state);
    await initializeStateFile(path, state);
    await mutateStateFile(path, (current) => transitionDeployState(current, {
      expectedGeneration: 2, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
      now: '2026-09-07T15:30:00.000Z', to: 'IDLE', manifestDigest: CANDIDATE.manifestDigest,
    }));
    const finalState = JSON.parse(await readFile(path, 'utf8'));
    assert.match(finalState.receiptChainHead, /^sha256:[0-9a-f]{64}$/);
    assert.equal(finalState.operationId, null);
    const receiptFiles = await readdir(join(directory, 'receipts'));
    assert.deepEqual(receiptFiles, ['000000000003.json']);
    const receipt = JSON.parse(await readFile(join(directory, 'receipts', receiptFiles[0]), 'utf8'));
    assert.equal(receipt.receiptDigest, finalState.receiptChainHead);
    const { receiptDigest, ...receiptBody } = receipt;
    assert.equal(receiptDigest, sha256(receiptBody));
    assert.equal(receipt.operationId, 'op-1');
    assert.equal(receipt.terminalPhase, 'COMMITTED');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('managed singleton transition consumes only a completed canonical executor receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'booking-state-executor-binding-'));
  const runtimeEnvFile = join(root, '.runtime.env');
  await writeFile(runtimeEnvFile, RUNTIME_ENV_CONTENT, { mode: 0o600 });
  const managerRuntime = (nowMs) => ({ deployStateRoot: root, runtimeEnvFile, allowInsecureTestPaths: true, nowMs,
    stageTransitionPlanBuilder: () => ({ executable: '/trusted/action', argv: ['mutate'], cwd: '/trusted/release',
      readback: { executable: '/trusted/action', argv: ['readback'], verify: () => ({ exactIdentity: true }) } }),
    stageTransitionCommandRunner: async () => ({ exitCode: 0, signal: null, overflow: false, stdout: '{}', stderr: '' }) });
  let state = acquired();
  state = step(state, 'MANIFEST_VERIFIED');
  state = step(state, 'STAGED');
  state = step(state, 'EXPAND_MIGRATED', { expandMigrationReceiptDigest: D('e') });
  const statePath = await canonicalStatePath({ environment: 'preprod', project: 'booking-preprod', deployStateRoot: root });
  const transitionArgs = (overrides = {}) => ({
    action: 'transition', execute: 'true', environment: 'preprod', project: 'booking-preprod', 'approval-id': 'approval-1',
    'expected-generation': '6', 'expected-fencing-epoch': '1', 'manifest-digest': CANDIDATE.manifestDigest,
    'operation-id': 'op-1', 'lease-id': 'lease-1', 'holder-id': 'owner-1', to: 'SINGLETON_TRANSFERRED',
    'rollback-pre-switch-probe-digest': D('9'), ...overrides,
  });
  try {
    await initializeStateFile(statePath, state);
    const bootstrapArgs = { action: 'preprod-prepare-telegram-egress', execute: 'true', environment: 'preprod', project: 'booking-preprod',
      'approval-id': 'approval-1', 'expected-generation': '4', 'expected-fencing-epoch': '1', 'manifest-digest': CANDIDATE.manifestDigest,
      'operation-id': 'op-1', 'lease-id': 'lease-1', 'holder-id': 'owner-1', 'resource-id': 'telegram:booking-preprod',
      'action-id': 'egress-stage-1' };
    const executorRuntime = { deployStateRoot: root, now: () => new Date('2026-09-07T15:34:00.000Z'),
      planBuilder: () => ({ executable: '/trusted/action', argv: ['mutate'], cwd: '/trusted/release',
        readback: { executable: '/trusted/action', argv: ['readback'], verify: () => ({ exactIdentity: true }) } }),
      commandRunner: async () => ({ exitCode: 0, signal: null, overflow: false, stdout: '{}', stderr: '' }) };
    const telegramEgressReceipt = await runFencedAction(bootstrapArgs, executorRuntime);
    const stageReceipt = await runFencedAction({ ...bootstrapArgs, action: 'preprod-stage',
      'resource-id': 'booking-preprod-edge', 'action-id': 'stage-1' }, executorRuntime);
    state = step(state, 'CANDIDATE_STARTED', { telegramEgressReceiptDigest: telegramEgressReceipt.receiptDigest,
      stageReceiptDigest: stageReceipt.receiptDigest });
    state = step(state, 'CANDIDATE_READY', { candidateProbeDigest: D('8') });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    await assert.rejects(runManageDeployState(transitionArgs({ 'singleton-transfer-receipt-digest': D('4') }), {
      ...managerRuntime(Date.parse('2026-09-07T15:35:00.000Z')),
    }), /not present in the canonical store/);

    const actionArgs = {
      action: 'preprod-transfer-singletons', execute: 'true', environment: 'preprod', project: 'booking-preprod', 'approval-id': 'approval-1',
      'expected-generation': '6', 'expected-fencing-epoch': '1', 'manifest-digest': CANDIDATE.manifestDigest,
      'operation-id': 'op-1', 'lease-id': 'lease-1', 'holder-id': 'owner-1', 'resource-id': 'booking-preprod-edge', 'action-id': 'singletons-1',
    };
    const receipt = await runFencedAction(actionArgs, { deployStateRoot: root, now: () => new Date('2026-09-07T15:36:00.000Z'),
      planBuilder: () => ({ executable: '/trusted/singletons', argv: ['transfer'], cwd: '/trusted/release',
        readback: { executable: '/trusted/singletons', argv: ['readback'], verify: () => ({ exactlyOne: true }) } }),
      commandRunner: async () => ({ exitCode: 0, signal: null, overflow: false, stdout: '{}', stderr: '' }) });
    const activeProbeReceipt = await runFencedAction({ ...actionArgs, action: 'preprod-probe-active', 'manifest-digest': ACTIVE.manifestDigest,
      'resource-id': 'probe:booking-preprod:active', 'action-id': 'active-probe-1' }, { deployStateRoot: root,
      now: () => new Date('2026-09-07T15:36:30.000Z'),
      planBuilder: () => ({ executable: '/trusted/probe', argv: ['active'], cwd: '/trusted/release',
        readback: { executable: '/trusted/probe', argv: ['active-readback'], verify: () => ({ exactIdentity: true }) } }),
      commandRunner: async () => ({ exitCode: 0, signal: null, overflow: false, stdout: '{}', stderr: '' }) });

    await assert.rejects(runManageDeployState(transitionArgs({ to: 'SWITCHED', 'switch-receipt-digest': receipt.receiptDigest }), {
      ...managerRuntime(Date.parse('2026-09-07T15:37:00.000Z')),
    }), /does not match the canonical transition identity/);

    const wrongIdentity = { ...state, candidate: { ...CANDIDATE, releaseId: 'booking-20260907T160000Z-deadbee', gitSha: 'd'.repeat(40), manifestDigest: D('d') } };
    validateDeployState(wrongIdentity);
    await writeFile(statePath, `${JSON.stringify(wrongIdentity, null, 2)}\n`);
    await assert.rejects(runManageDeployState(transitionArgs({ 'manifest-digest': D('d'), 'rollback-pre-switch-probe-digest': activeProbeReceipt.receiptDigest,
      'singleton-transfer-receipt-digest': receipt.receiptDigest }), {
      ...managerRuntime(Date.parse('2026-09-07T15:38:00.000Z')),
    }), /does not match the canonical transition identity/);

    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    const transitioned = await runManageDeployState(transitionArgs({ 'rollback-pre-switch-probe-digest': activeProbeReceipt.receiptDigest,
      'singleton-transfer-receipt-digest': receipt.receiptDigest }), {
      ...managerRuntime(Date.parse('2026-09-07T15:39:00.000Z')),
    });
    assert.equal(transitioned.phase, 'SINGLETON_TRANSFERRED');
    assert.equal(transitioned.evidence.singletonTransferReceiptDigest, receipt.receiptDigest);

    const execute = (action, resourceId, actionId, generation, manifestDigest, at) => runFencedAction({ ...actionArgs,
      action, 'resource-id': resourceId, 'action-id': actionId, 'expected-generation': String(generation), 'manifest-digest': manifestDigest,
    }, { deployStateRoot: root, now: () => new Date(at),
      planBuilder: () => ({ executable: '/trusted/action', argv: [action], cwd: '/trusted/release',
        readback: { executable: '/trusted/action', argv: ['readback', action], verify: () => ({ exactIdentity: true }) } }),
      commandRunner: async () => ({ exitCode: 0, signal: null, overflow: false, stdout: '{}', stderr: '' }) });
    const manage = (to, generation, at, overrides = {}) => runManageDeployState(transitionArgs({
      to, 'expected-generation': String(generation), ...overrides,
    }), managerRuntime(Date.parse(at)));

    const switchReceipt = await execute('preprod-switch-ingress', 'ingress:booking-preprod', 'switch-1', 7,
      CANDIDATE.manifestDigest, '2026-09-07T15:40:00.000Z');
    const switched = await manage('SWITCHED', 7, '2026-09-07T15:41:00.000Z', { 'switch-receipt-digest': switchReceipt.receiptDigest });
    assert.equal(switched.evidence.switchReceiptDigest, switchReceipt.receiptDigest);
    await assert.rejects(execute('preprod-rollback-ingress', 'ingress:booking-preprod', 'rollback-too-early', 8,
      ACTIVE.manifestDigest, '2026-09-07T15:41:30.000Z'), /not allowed from phase SWITCHED/);
    const webhookReceipt = await execute('preprod-set-webhook', 'telegram:booking-preprod', 'webhook-1', 8,
      CANDIDATE.manifestDigest, '2026-09-07T15:41:45.000Z');
    await manage('OBSERVING', 8, '2026-09-07T15:42:00.000Z', { 'webhook-receipt-digest': webhookReceipt.receiptDigest });
    await manage('ROLLBACK_PENDING', 9, '2026-09-07T15:43:00.000Z');
    await assert.rejects(execute('preprod-rollback-ingress', 'ingress:booking-preprod', 'rollback-wrong-target', 10,
      CANDIDATE.manifestDigest, '2026-09-07T15:43:30.000Z'), /release manifest identity mismatch/);
    const rollbackIngress = await execute('preprod-rollback-ingress', 'ingress:booking-preprod', 'rollback-ingress-1', 10,
      ACTIVE.manifestDigest, '2026-09-07T15:44:00.000Z');
    const rollbackSingletons = await execute('preprod-rollback-singletons', 'booking-preprod-edge', 'rollback-singletons-1', 10,
      ACTIVE.manifestDigest, '2026-09-07T15:45:00.000Z');
    const rollbackProbe = await execute('preprod-probe-rollback', 'probe:booking-preprod:rollback', 'rollback-probe-1', 10,
      ACTIVE.manifestDigest, '2026-09-07T15:45:30.000Z');
    const rolledBack = await manage('ROLLED_BACK', 10, '2026-09-07T15:46:00.000Z', {
      'rollback-receipt-digest': rollbackIngress.receiptDigest,
      'rollback-singleton-transfer-receipt-digest': rollbackSingletons.receiptDigest,
      'rolled-back-probe-digest': rollbackProbe.receiptDigest,
    });
    assert.deepEqual(rolledBack.active, ACTIVE);
    assert.equal(rolledBack.rollbackRehearsalCompleted, true);
    assert.equal(rolledBack.evidence.rollbackReceiptDigest, rollbackIngress.receiptDigest);
    assert.equal(rolledBack.evidence.rollbackSingletonTransferReceiptDigest, rollbackSingletons.receiptDigest);

    const restageEgress = await execute('preprod-prepare-telegram-egress', 'telegram:booking-preprod', 'restage-egress-1', 11,
      CANDIDATE.manifestDigest, '2026-09-07T15:46:30.000Z');
    const restage = await execute('preprod-stage', 'booking-preprod-edge', 'restage-1', 11,
      CANDIDATE.manifestDigest, '2026-09-07T15:47:00.000Z');
    assert.match(restage.resources.find((resource) => resource.resourceId === 'booking-preprod-edge').previousReceiptDigest, /^sha256:/,
      'ROLLED_BACK re-promotion preserves the existing edge predecessor chain');
    assert.equal(restage.resources.find((resource) => resource.resourceId === 'telegram:booking-preprod').previousReceiptDigest,
      restageEgress.receiptDigest, 'stage binds the fresh re-promotion egress receipt');
    const restageReceiptPath = join(dirname(statePath), 'executor', 'receipts', '000000000001-preprod-stage-restage-1.json');
    const edgeStatePath = join(resourceDirectory(statePath, 'booking-preprod-edge'), 'resource-state.json');
    const telegramStatePath = join(resourceDirectory(statePath, 'telegram:booking-preprod'), 'resource-state.json');
    const forgedBody = { ...restage, resources: restage.resources.map((resource) => resource.resourceId === 'booking-preprod-edge'
      ? { ...resource, previousReceiptDigest: D('f') } : resource) };
    delete forgedBody.receiptDigest;
    const forged = { ...forgedBody, receiptDigest: sha256(forgedBody) };
    const edgeState = JSON.parse(await readFile(edgeStatePath, 'utf8'));
    const telegramState = JSON.parse(await readFile(telegramStatePath, 'utf8'));
    await writeFile(restageReceiptPath, `${JSON.stringify(forged)}\n`);
    await writeFile(edgeStatePath, `${JSON.stringify({ ...edgeState, receiptChainHead: forged.receiptDigest })}\n`);
    await writeFile(telegramStatePath, `${JSON.stringify({ ...telegramState, receiptChainHead: forged.receiptDigest })}\n`);
    await assert.rejects(manage('CANDIDATE_STARTED', 11, '2026-09-07T15:47:30.000Z', {
      'stage-receipt-digest': forged.receiptDigest }), /Telegram egress predecessor is not current and canonical/);
    await writeFile(restageReceiptPath, `${JSON.stringify(restage)}\n`);
    await writeFile(edgeStatePath, `${JSON.stringify(edgeState)}\n`);
    await writeFile(telegramStatePath, `${JSON.stringify(telegramState)}\n`);
    const restarted = await manage('CANDIDATE_STARTED', 11, '2026-09-07T15:48:00.000Z', {
      'stage-receipt-digest': restage.receiptDigest });
    assert.equal(restarted.evidence.expandMigrationReceiptDigest, D('e'), 'expand migration evidence survives the rehearsal rollback');
    assert.equal(restarted.evidence.rollbackReceiptDigest, rollbackIngress.receiptDigest,
      'first-pass rollback evidence remains rooted until terminal resource closure');
    assert.equal(restarted.rollbackRehearsalCompleted, true, 'durable rehearsal marker survives re-staging and proves the second switch cycle');
    const candidateProbe2 = await execute('preprod-probe-candidate', 'probe:booking-preprod:candidate', 'candidate-probe-2', 12,
      CANDIDATE.manifestDigest, '2026-09-07T15:49:00.000Z');
    await manage('CANDIDATE_READY', 12, '2026-09-07T15:50:00.000Z', { 'candidate-probe-digest': candidateProbe2.receiptDigest });
    const activeProbe2 = await execute('preprod-probe-active', 'probe:booking-preprod:active', 'active-probe-2', 13,
      ACTIVE.manifestDigest, '2026-09-07T15:51:00.000Z');
    const singleton2 = await execute('preprod-transfer-singletons', 'booking-preprod-edge', 'singletons-2', 13,
      CANDIDATE.manifestDigest, '2026-09-07T15:51:30.000Z');
    await manage('SINGLETON_TRANSFERRED', 13, '2026-09-07T15:52:00.000Z', {
      'rollback-pre-switch-probe-digest': activeProbe2.receiptDigest, 'singleton-transfer-receipt-digest': singleton2.receiptDigest,
    });
    const switch2 = await execute('preprod-switch-ingress', 'ingress:booking-preprod', 'switch-2', 14,
      CANDIDATE.manifestDigest, '2026-09-07T15:53:00.000Z');
    await manage('SWITCHED', 14, '2026-09-07T15:54:00.000Z', { 'switch-receipt-digest': switch2.receiptDigest });
    const webhook2 = await execute('preprod-set-webhook', 'telegram:booking-preprod', 'webhook-2', 15,
      CANDIDATE.manifestDigest, '2026-09-07T15:55:00.000Z');
    await manage('OBSERVING', 15, '2026-09-07T15:56:00.000Z', { 'webhook-receipt-digest': webhook2.receiptDigest });
    const observation = await execute('preprod-probe-observation', 'probe:booking-preprod:observation', 'observation-1', 16,
      CANDIDATE.manifestDigest, '2026-09-07T15:57:00.000Z');
    await writeFile(runtimeEnvFile, 'FIXTURE_ONLY=drifted-before-commit\n', { mode: 0o600 });
    await assert.rejects(manage('COMMITTED', 16, '2026-09-07T15:57:20.000Z', {
      'observation-receipt-digest': observation.receiptDigest,
    }), /runtime environment digest drifted/);
    await writeFile(runtimeEnvFile, RUNTIME_ENV_CONTENT, { mode: 0o600 });
    const telegramResourcePath = join(resourceDirectory(statePath, 'telegram:booking-preprod'), 'resource-state.json');
    const telegramResource = JSON.parse(await readFile(telegramResourcePath, 'utf8'));
    await writeFile(telegramResourcePath, `${JSON.stringify({ ...telegramResource,
      pendingAction: { actionId: 'unconsumed-webhook', requestDigest: D('f') } })}\n`);
    await assert.rejects(manage('COMMITTED', 16, '2026-09-07T15:57:30.000Z', {
      'observation-receipt-digest': observation.receiptDigest,
    }), /requires fenced resource .* explicitly consumed/);
    await writeFile(telegramResourcePath, `${JSON.stringify({ ...telegramResource, receiptChainHead: D('f') })}\n`);
    await assert.rejects(manage('COMMITTED', 16, '2026-09-07T15:57:40.000Z', {
      'observation-receipt-digest': observation.receiptDigest,
    }), /requires fenced resource .* explicitly consumed/);
    await writeFile(telegramResourcePath, `${JSON.stringify(telegramResource)}\n`);
    await rm(telegramResourcePath);
    await assert.rejects(manage('COMMITTED', 16, '2026-09-07T15:57:50.000Z', {
      'observation-receipt-digest': observation.receiptDigest,
    }), /resource telegram:booking-preprod completion state is missing or unreadable/);
    await writeFile(telegramResourcePath, `${JSON.stringify(telegramResource)}\n`);
    const committed = await manage('COMMITTED', 16, '2026-09-07T15:58:00.000Z', { 'observation-receipt-digest': observation.receiptDigest });
    assert.deepEqual(committed.active, CANDIDATE);
    assert.deepEqual(committed.rollback, ACTIVE);
    assert.equal(committed.rollbackRehearsalCompleted, false, 'successful commit closes the rehearsal cycle marker');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('managed pre-switch rollback consumes singleton and probe receipts without accepting ingress evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'booking-managed-pre-switch-rollback-'));
  const runtimeEnvFile = join(root, '.runtime.env');
  await writeFile(runtimeEnvFile, RUNTIME_ENV_CONTENT, { mode: 0o600 });
  let state = acquired();
  state = step(state, 'MANIFEST_VERIFIED');
  state = step(state, 'STAGED');
  state = step(state, 'EXPAND_MIGRATED', { expandMigrationReceiptDigest: D('e') });
  state = step(state, 'CANDIDATE_STARTED', { telegramEgressReceiptDigest: D('6'), stageReceiptDigest: D('7') });
  state = step(state, 'CANDIDATE_READY', { candidateProbeDigest: D('8') });
  state = step(state, 'SINGLETON_TRANSFERRED', { rollbackPreSwitchProbeDigest: D('9'), singletonTransferReceiptDigest: D('4') });
  state = step(state, 'ROLLBACK_PENDING');
  const statePath = await canonicalStatePath({ environment: 'preprod', project: 'booking-preprod', deployStateRoot: root });
  const actionBase = { execute: 'true', environment: 'preprod', project: 'booking-preprod', 'approval-id': 'approval-1',
    'expected-generation': '8', 'expected-fencing-epoch': '1', 'manifest-digest': ACTIVE.manifestDigest,
    'operation-id': 'op-1', 'lease-id': 'lease-1', 'holder-id': 'owner-1' };
  const actionRuntime = { deployStateRoot: root, now: () => new Date('2026-09-07T15:40:00.000Z'),
    planBuilder: (_state, action) => ({ executable: '/trusted/action', argv: [action.action], cwd: '/trusted/release',
      readback: { executable: '/trusted/action', argv: ['readback', action.action], verify: () => ({ exactIdentity: true }) } }),
    commandRunner: async () => ({ exitCode: 0, signal: null, overflow: false, stdout: '{}', stderr: '' }) };
  const managerRuntime = { deployStateRoot: root, runtimeEnvFile, allowInsecureTestPaths: true,
    nowMs: Date.parse('2026-09-07T15:41:00.000Z') };
  try {
    await initializeStateFile(statePath, state);
    const singleton = await runFencedAction({ ...actionBase, action: 'preprod-rollback-singletons',
      'resource-id': 'booking-preprod-edge', 'action-id': 'rollback-singletons-pre-switch' }, actionRuntime);
    const probe = await runFencedAction({ ...actionBase, action: 'preprod-probe-rollback',
      'resource-id': 'probe:booking-preprod:rollback', 'action-id': 'rollback-probe-pre-switch' }, actionRuntime);
    const transition = { action: 'transition', execute: 'true', environment: 'preprod', project: 'booking-preprod',
      'approval-id': 'approval-1', 'expected-generation': '8', 'expected-fencing-epoch': '1',
      'manifest-digest': CANDIDATE.manifestDigest, 'operation-id': 'op-1', 'lease-id': 'lease-1', 'holder-id': 'owner-1',
      to: 'ROLLED_BACK', 'rollback-singleton-transfer-receipt-digest': singleton.receiptDigest,
      'rolled-back-probe-digest': probe.receiptDigest };
    await assert.rejects(runManageDeployState({ ...transition, 'rollback-receipt-digest': D('f') }, managerRuntime),
      /pre-switch rollback must not consume ingress mutation evidence/);
    const rolledBack = await runManageDeployState(transition, managerRuntime);
    assert.equal(rolledBack.phase, 'ROLLED_BACK');
    assert.deepEqual(rolledBack.active, ACTIVE);
    assert.deepEqual(rolledBack.candidate, CANDIDATE);
    assert.equal(rolledBack.evidence.rollbackReceiptDigest, null);
    assert.equal(rolledBack.rollbackRehearsalCompleted, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
