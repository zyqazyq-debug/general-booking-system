import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ContractError, EXIT, sha256 } from '../release/lib/contracts.mjs';
import { canonicalStatePath, initializeStateFile, mutateStateFile } from '../release/lib/deploy-state-store.mjs';
import { MIN_LEASE_DURATION_MS, runManageDeployState } from '../release/manage-deploy-state.mjs';
import { acquireLease, initialDeployState, takeoverExpiredLease, transitionDeployState, validateDeployState } from '../release/lib/state-machine.mjs';
import { runFencedAction } from '../release/execute-fenced-action.mjs';

const ACTIVE = { slot: 'blue', releaseId: 'booking-20260907T150000Z-abcdef0', gitSha: 'a'.repeat(40), manifestDigest: `sha256:${'6'.repeat(64)}` };
const CANDIDATE = { slot: 'green', releaseId: 'booking-20260907T160000Z-0123456', gitSha: 'b'.repeat(40), manifestDigest: `sha256:${'7'.repeat(64)}` };
const D = (digit) => `sha256:${digit.repeat(64)}`;
const DEPLOYMENT = {
  environment: 'preprod', project: 'booking-preprod',
  resources: { edgeNetwork: 'booking-preprod-edge', dataNetwork: 'booking-preprod-data', databaseRef: 'database:booking-preprod', ingressRef: 'ingress:booking-preprod' },
  active: ACTIVE,
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
  state = step(state, 'CANDIDATE_STARTED');
  assert.throws(() => step(state, 'CANDIDATE_READY'), (error) => error.exitCode === EXIT.READINESS);
  state = step(state, 'CANDIDATE_READY', { candidateProbeDigest: D('8') });
  assert.throws(() => step(state, 'SINGLETON_TRANSFERRED', { rollbackPreSwitchProbeDigest: D('9') }), (error) => error.exitCode === EXIT.SINGLETON);
  state = step(state, 'SINGLETON_TRANSFERRED', { rollbackPreSwitchProbeDigest: D('9'), singletonTransferReceiptDigest: D('4') });
  assert.throws(() => step(state, 'SWITCHED'), (error) => error.exitCode === EXIT.SWITCH);
  state = step(state, 'SWITCHED', { switchReceiptDigest: D('1') });
  assert.deepEqual(state.active, CANDIDATE);
  assert.deepEqual(state.rollback, ACTIVE);
  state = step(state, 'OBSERVING');
  state = step(state, 'ROLLBACK_PENDING');
  assert.throws(() => step(state, 'ROLLED_BACK', { rollbackReceiptDigest: D('2'), rolledBackProbeDigest: D('3') }), (error) => error.exitCode === EXIT.ROLLBACK);
  state = step(state, 'ROLLED_BACK', { rollbackReceiptDigest: D('2'), rollbackSingletonTransferReceiptDigest: D('5'), rolledBackProbeDigest: D('3') });
  assert.deepEqual(state.active, ACTIVE);
  state = step(state, 'IDLE');
  assert.equal(state.lease, null);
  assert.equal(state.rollback, null);
  assert.equal(state.generation, 11);
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
  state = step(state, 'CANDIDATE_STARTED');
  state = step(state, 'CANDIDATE_READY', { candidateProbeDigest: D('8') });
  state = step(state, 'SINGLETON_TRANSFERRED', { rollbackPreSwitchProbeDigest: D('9'), singletonTransferReceiptDigest: D('4') });
  state = step(state, 'ROLLBACK_PENDING');
  state = step(state, 'ROLLED_BACK', { rollbackReceiptDigest: D('2'), rollbackSingletonTransferReceiptDigest: D('5'), rolledBackProbeDigest: D('3') });
  assert.deepEqual(state.active, ACTIVE);
  assert.deepEqual(state.candidate, CANDIDATE);
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
  state = step(state, 'EXPAND_MIGRATED');
  state = step(state, 'CANDIDATE_STARTED');
  state = step(state, 'CANDIDATE_READY', { candidateProbeDigest: D('8') });
  assert.equal(state.contractMigrationApplied, false);
  state = step(state, 'SINGLETON_TRANSFERRED', { rollbackPreSwitchProbeDigest: D('9'), singletonTransferReceiptDigest: D('4') });
  state = step(state, 'SWITCHED', { switchReceiptDigest: D('1') });
  const rollbackPending = step(state, 'ROLLBACK_PENDING');
  assert.equal(rollbackPending.phase, 'ROLLBACK_PENDING');
  const afterContract = { ...state, contractMigrationApplied: true };
  validateDeployState(afterContract);
  assert.throws(() => step(afterContract, 'ROLLBACK_PENDING'), (error) => error.exitCode === EXIT.ROLLBACK);
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

test('canonical CLI derives path and time, and rejects caller path/time or unbounded lease', async () => {
  const root = await mkdtemp(join(tmpdir(), 'booking-canonical-root-'));
  const common = {
    action: 'init', execute: 'true', environment: 'preprod', project: 'booking-preprod', 'approval-id': 'approval-1',
    'expected-generation': '0', 'expected-fencing-epoch': '0', 'manifest-digest': ACTIVE.manifestDigest,
    'active-slot': ACTIVE.slot, 'active-release': ACTIVE.releaseId, 'active-git-sha': ACTIVE.gitSha, 'active-manifest-digest': ACTIVE.manifestDigest,
    'edge-network': 'booking-preprod-edge', 'data-network': 'booking-preprod-data', 'database-ref': 'database:booking-preprod', 'ingress-ref': 'ingress:booking-preprod',
  };
  try {
    await runManageDeployState(common, { deployStateRoot: root, nowMs: Date.parse('2026-09-07T15:00:00.000Z') });
    const path = await canonicalStatePath({ environment: 'preprod', project: 'booking-preprod', deployStateRoot: root });
    assert.equal(JSON.parse(await readFile(path, 'utf8')).updatedAt, '2026-09-07T15:00:00.000Z');
    await assert.rejects(runManageDeployState({ ...common, state: join(root, 'other.json') }, { deployStateRoot: root }), /--state is forbidden/);
    await assert.rejects(runManageDeployState({ ...common, now: '2099-01-01T00:00:00.000Z' }, { deployStateRoot: root }), /--now is forbidden/);
    const acquire = {
      action: 'acquire', execute: 'true', environment: 'preprod', project: 'booking-preprod', 'approval-id': 'approval-1',
      'expected-generation': '0', 'expected-fencing-epoch': '0', 'manifest-digest': CANDIDATE.manifestDigest,
      'candidate-slot': CANDIDATE.slot, 'candidate-release': CANDIDATE.releaseId, 'candidate-git-sha': CANDIDATE.gitSha, 'candidate-manifest-digest': CANDIDATE.manifestDigest,
      'operation-id': 'op-1', 'lease-id': 'lease-1', 'holder-id': 'owner-1', 'lease-duration-ms': String(MIN_LEASE_DURATION_MS - 1),
    };
    await assert.rejects(runManageDeployState(acquire, { deployStateRoot: root, nowMs: Date.parse('2026-09-07T15:01:00.000Z') }), /lease-duration-ms must be between/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('terminal transition persists immutable hash-chain receipt before clearing operation state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-state-receipt-'));
  const path = join(directory, 'deploy-state.json');
  try {
    let state = acquired();
    state.phase = 'ABORT_CANDIDATE';
    state.generation = 2;
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
    assert.equal(receipt.terminalPhase, 'ABORT_CANDIDATE');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('managed singleton transition consumes only a completed canonical executor receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'booking-state-executor-binding-'));
  let state = acquired();
  state = step(state, 'MANIFEST_VERIFIED');
  state = step(state, 'STAGED');
  state = step(state, 'CANDIDATE_STARTED');
  state = step(state, 'CANDIDATE_READY', { candidateProbeDigest: D('8') });
  const statePath = await canonicalStatePath({ environment: 'preprod', project: 'booking-preprod', deployStateRoot: root });
  const transitionArgs = (overrides = {}) => ({
    action: 'transition', execute: 'true', environment: 'preprod', project: 'booking-preprod', 'approval-id': 'approval-1',
    'expected-generation': '5', 'expected-fencing-epoch': '1', 'manifest-digest': CANDIDATE.manifestDigest,
    'lease-id': 'lease-1', 'holder-id': 'owner-1', to: 'SINGLETON_TRANSFERRED',
    'rollback-pre-switch-probe-digest': D('9'), ...overrides,
  });
  try {
    await initializeStateFile(statePath, state);
    await assert.rejects(runManageDeployState(transitionArgs({ 'singleton-transfer-receipt-digest': D('4') }), {
      deployStateRoot: root, nowMs: Date.parse('2026-09-07T15:35:00.000Z'),
    }), /not present in the canonical store/);

    const actionArgs = {
      action: 'preprod-transfer-singletons', execute: 'true', environment: 'preprod', project: 'booking-preprod', 'approval-id': 'approval-1',
      'expected-generation': '5', 'expected-fencing-epoch': '1', 'manifest-digest': CANDIDATE.manifestDigest,
      'operation-id': 'op-1', 'lease-id': 'lease-1', 'holder-id': 'owner-1', 'resource-id': 'booking-preprod-edge', 'action-id': 'singletons-1',
    };
    const receipt = await runFencedAction(actionArgs, { deployStateRoot: root, now: () => new Date('2026-09-07T15:36:00.000Z'),
      planBuilder: () => ({ executable: '/trusted/singletons', argv: ['transfer'], cwd: '/trusted/release',
        readback: { executable: '/trusted/singletons', argv: ['readback'], verify: () => ({ exactlyOne: true }) } }),
      commandRunner: async () => ({ exitCode: 0, signal: null, overflow: false, stdout: '{}', stderr: '' }) });

    await assert.rejects(runManageDeployState(transitionArgs({ to: 'SWITCHED', 'switch-receipt-digest': receipt.receiptDigest }), {
      deployStateRoot: root, nowMs: Date.parse('2026-09-07T15:37:00.000Z'),
    }), /does not match the canonical transition identity/);

    const wrongIdentity = { ...state, candidate: { ...CANDIDATE, releaseId: 'booking-20260907T160000Z-deadbee', gitSha: 'd'.repeat(40), manifestDigest: D('d') } };
    validateDeployState(wrongIdentity);
    await writeFile(statePath, `${JSON.stringify(wrongIdentity, null, 2)}\n`);
    await assert.rejects(runManageDeployState(transitionArgs({ 'manifest-digest': D('d'), 'singleton-transfer-receipt-digest': receipt.receiptDigest }), {
      deployStateRoot: root, nowMs: Date.parse('2026-09-07T15:38:00.000Z'),
    }), /does not match the canonical transition identity/);

    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    const transitioned = await runManageDeployState(transitionArgs({ 'singleton-transfer-receipt-digest': receipt.receiptDigest }), {
      deployStateRoot: root, nowMs: Date.parse('2026-09-07T15:39:00.000Z'),
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
    }), { deployStateRoot: root, nowMs: Date.parse(at) });

    const switchReceipt = await execute('preprod-switch-ingress', 'ingress:booking-preprod', 'switch-1', 6,
      CANDIDATE.manifestDigest, '2026-09-07T15:40:00.000Z');
    const switched = await manage('SWITCHED', 6, '2026-09-07T15:41:00.000Z', { 'switch-receipt-digest': switchReceipt.receiptDigest });
    assert.equal(switched.evidence.switchReceiptDigest, switchReceipt.receiptDigest);
    await assert.rejects(execute('preprod-rollback-ingress', 'ingress:booking-preprod', 'rollback-too-early', 7,
      ACTIVE.manifestDigest, '2026-09-07T15:41:30.000Z'), /not allowed from phase SWITCHED/);
    await manage('OBSERVING', 7, '2026-09-07T15:42:00.000Z');
    await manage('ROLLBACK_PENDING', 8, '2026-09-07T15:43:00.000Z');
    await assert.rejects(execute('preprod-rollback-ingress', 'ingress:booking-preprod', 'rollback-wrong-target', 9,
      CANDIDATE.manifestDigest, '2026-09-07T15:43:30.000Z'), /release manifest identity mismatch/);
    const rollbackIngress = await execute('preprod-rollback-ingress', 'ingress:booking-preprod', 'rollback-ingress-1', 9,
      ACTIVE.manifestDigest, '2026-09-07T15:44:00.000Z');
    const rollbackSingletons = await execute('preprod-rollback-singletons', 'booking-preprod-edge', 'rollback-singletons-1', 9,
      ACTIVE.manifestDigest, '2026-09-07T15:45:00.000Z');
    const rolledBack = await manage('ROLLED_BACK', 9, '2026-09-07T15:46:00.000Z', {
      'rollback-receipt-digest': rollbackIngress.receiptDigest,
      'rollback-singleton-transfer-receipt-digest': rollbackSingletons.receiptDigest,
      'rolled-back-probe-digest': D('3'),
    });
    assert.deepEqual(rolledBack.active, ACTIVE);
    assert.equal(rolledBack.evidence.rollbackReceiptDigest, rollbackIngress.receiptDigest);
    assert.equal(rolledBack.evidence.rollbackSingletonTransferReceiptDigest, rollbackSingletons.receiptDigest);
  } finally { await rm(root, { recursive: true, force: true }); }
});
