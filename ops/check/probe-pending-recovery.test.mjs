import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { canonicalJson, sha256 } from '../release/lib/contracts.mjs';
import { canonicalStatePath, initializeStateFile } from '../release/lib/deploy-state-store.mjs';
import { readCanonicalExecutorReceiptByDigest, resourceDirectory, writeExecutorReceipt } from '../release/lib/fenced-resource-store.mjs';
import { schemaForAction } from '../release/lib/external-action-contract.mjs';
import { acquireLease, initialDeployState, takeoverExpiredLease, transitionDeployState } from '../release/lib/state-machine.mjs';
import { runFencedAction } from '../release/execute-fenced-action.mjs';

const ACTIVE = { slot: 'green', releaseId: 'booking-20260912T120000Z-aaaaaaaa', gitSha: 'a'.repeat(40), manifestDigest: `sha256:${'a'.repeat(64)}` };
const CANDIDATE = { slot: 'blue', releaseId: 'booking-20260912T130000Z-bbbbbbbb', gitSha: 'b'.repeat(40), manifestDigest: `sha256:${'b'.repeat(64)}` };
const DEPLOYMENT = { environment: 'preprod', project: 'booking-preprod', active: ACTIVE,
  runtimeEnvDigest: sha256('PROBE_RECOVERY=true\n'), resources: {
    edgeNetwork: 'booking-preprod-edge', dataNetwork: 'booking-preprod-data', databaseRef: 'database:booking-preprod',
    ingressRef: 'ingress:booking-preprod',
  } };

const PLAN = { executable: '/trusted/probe', argv: ['fetch'], cwd: '/trusted',
  readback: { executable: '/trusted/probe', argv: ['fetch'], verify: () => ({ fresh: true }) } };

function commandDigest(plan = PLAN) {
  return sha256({ executable: plan.executable, argv: plan.argv, cwd: plan.cwd,
    preflight: null, readback: { executable: plan.readback.executable, argv: plan.readback.argv },
    readbackFromExecution: false, artifactBinding: null, environmentBinding: null, registrySupplyChainBinding: null });
}

function leasedState() {
  return acquireLease(initialDeployState(DEPLOYMENT, '2026-09-12T14:00:00.000Z'), {
    expectedGeneration: 0, expectedFencingEpoch: 0, candidate: CANDIDATE, operationId: 'op-probe-recovery',
    approvalId: 'approval-old', leaseId: 'lease-old', holderId: 'holder-old',
    now: '2026-09-12T14:01:00.000Z', expiresAt: '2026-09-12T14:10:00.000Z',
  });
}

function phaseState(action) {
  let state = leasedState();
  const move = (to, extra = {}) => {
    state = transitionDeployState(state, { expectedGeneration: state.generation, expectedFencingEpoch: state.fencingEpoch,
      leaseId: state.lease.leaseId, holderId: state.lease.holderId,
      now: `2026-09-12T14:0${Math.min(state.generation + 2, 9)}:00.000Z`, to, ...extra });
  };
  move('MANIFEST_VERIFIED', { manifestDigest: CANDIDATE.manifestDigest });
  move('STAGED');
  move('EXPAND_MIGRATED', { expandMigrationReceiptDigest: `sha256:${'1'.repeat(64)}` });
  if (action === 'preprod-probe-recovered-active') {
    move('FAILED');
    return state;
  }
  move('CANDIDATE_STARTED', { stageReceiptDigest: `sha256:${'2'.repeat(64)}` });
  if (action === 'preprod-probe-candidate') return state;
  move('CANDIDATE_READY', { candidateProbeDigest: `sha256:${'3'.repeat(64)}` });
  if (action === 'preprod-probe-active') return state;
  move('SINGLETON_TRANSFERRED', { rollbackPreSwitchProbeDigest: `sha256:${'4'.repeat(64)}`,
    singletonTransferReceiptDigest: `sha256:${'5'.repeat(64)}` });
  move('SWITCHED', { switchReceiptDigest: `sha256:${'6'.repeat(64)}` });
  move('OBSERVING', { webhookReceiptDigest: `sha256:${'7'.repeat(64)}` });
  if (action === 'preprod-probe-observation') return state;
  move('ROLLBACK_PENDING');
  return state;
}

const CASES = [
  ['preprod-probe-candidate', 'probe:booking-preprod:candidate', 'candidate'],
  ['preprod-probe-active', 'probe:booking-preprod:active', 'active'],
  ['preprod-probe-observation', 'probe:booking-preprod:observation', 'active'],
  ['preprod-probe-rollback', 'probe:booking-preprod:rollback', 'rollback'],
  ['preprod-probe-recovered-active', 'probe:booking-preprod:active', 'active'],
];

function identityFor(state, identity) {
  if (identity === 'active') return state.active;
  if (identity === 'rollback') return state.rollback;
  return state.candidate;
}

function actionArgs(state, action, resourceId, actionId, identity) {
  const release = identityFor(state, identity);
  return { action, execute: 'true', environment: 'preprod', project: 'booking-preprod',
    'approval-id': state.approvalId, 'expected-generation': String(state.generation),
    'expected-fencing-epoch': String(state.fencingEpoch), 'manifest-digest': release.manifestDigest,
    'operation-id': state.operationId, 'lease-id': state.lease.leaseId, 'holder-id': state.lease.holderId,
    'resource-id': resourceId, 'action-id': actionId };
}

async function fixture(state) {
  const root = await mkdtemp(join(tmpdir(), 'booking-probe-recovery-'));
  const statePath = await canonicalStatePath({ environment: 'preprod', project: 'booking-preprod', deployStateRoot: root });
  await initializeStateFile(statePath, state);
  return { root, statePath };
}

async function installPending(statePath, state, action, resourceId, actionId, identity, mode) {
  const releaseIdentity = identityFor(state, identity);
  const requestBody = { schema: schemaForAction(action).request, environment: state.environment, project: state.project,
    action, actionId, operationId: state.operationId, approvalId: state.approvalId, generation: state.generation,
    fencingEpoch: state.fencingEpoch, leaseId: state.lease.leaseId, holderId: state.lease.holderId,
    manifestDigest: releaseIdentity.manifestDigest, releaseIdentity, resourceIds: [resourceId],
    runtimeEnvDigest: state.runtimeEnvDigest, commandDigest: commandDigest() };
  const requestDigest = sha256(requestBody);
  const pendingAction = { actionId, requestDigest, action, approvalId: state.approvalId, leaseId: state.lease.leaseId,
    holderId: state.lease.holderId, generation: state.generation, fencingEpoch: state.fencingEpoch,
    commandDigest: requestBody.commandDigest };
  const path = join(resourceDirectory(statePath, resourceId), 'resource-state.json');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ schema: 'booking.fenced-resource/v1', environment: state.environment,
    project: state.project, resourceId, highestAcceptedFencingEpoch: state.fencingEpoch,
    operationId: state.operationId, manifestDigest: releaseIdentity.manifestDigest, pendingAction,
    receiptChainHead: null, updatedAt: '2026-09-12T14:09:00.000Z' })}\n`);
  let receipt = null;
  if (mode !== 'missing') {
    const body = { ...requestBody, schema: schemaForAction(action).receipt, requestDigest,
      startedAt: '2026-09-12T14:08:00.000Z', completedAt: '2026-09-12T14:09:00.000Z', status: mode,
      executionOutputDigest: sha256('prior execution'), readbackOutputDigest: sha256('prior readback'),
      verification: { fixture: true }, resources: [{ resourceId, highestAcceptedFencingEpoch: state.fencingEpoch,
        previousReceiptDigest: null }] };
    receipt = { ...body, receiptDigest: sha256(body) };
    await writeExecutorReceipt(statePath, receipt);
  }
  return { requestDigest, receipt };
}

for (const [action, resourceId, identity] of CASES) {
  for (const mode of ['missing', 'fail', 'pass']) {
    test(`${action} recovers ${mode} current-fence pending only through a fresh read-only fetch`, async (t) => {
      const state = phaseState(action);
      const { root, statePath } = await fixture(state);
      t.after(() => rm(root, { recursive: true, force: true }));
      const actionId = `${action.slice(8)}-${mode}-same`;
      const prior = await installPending(statePath, state, action, resourceId, actionId, identity, mode);
      let fetches = 0;
      const result = await runFencedAction(actionArgs(state, action, resourceId, actionId, identity), {
        deployStateRoot: root, now: () => new Date('2026-09-12T14:09:30.000Z'), planBuilder: () => PLAN,
        commandRunner: async () => { fetches += 1; return { exitCode: 0, signal: null, overflow: false, stdout: '{}', stderr: '' }; },
      });
      assert.equal(fetches, mode === 'pass' ? 1 : 2);
      assert.equal(result.status ?? 'pass', 'pass');
      const resource = JSON.parse(await readFile(join(resourceDirectory(statePath, resourceId), 'resource-state.json'), 'utf8'));
      assert.equal(resource.pendingAction, null);
      assert.equal(resource.receiptChainHead, result.receiptDigest);
      if (prior.receipt?.status === 'fail') {
        const canonicalFailure = await readCanonicalExecutorReceiptByDigest(statePath, prior.receipt.receiptDigest);
        assert.equal(canonicalFailure.receipt.status, 'fail', 'retry must not reinterpret the failure receipt as pass');
        assert.notEqual(result.receiptDigest, prior.receipt.receiptDigest);
      }
    });

    test(`${action} recovers ${mode} prior-fence pending by strict supersession and a fresh read-only fetch`, async (t) => {
      const oldState = phaseState(action);
      const { root, statePath } = await fixture(oldState);
      t.after(() => rm(root, { recursive: true, force: true }));
      const oldActionId = `${action.slice(8)}-${mode}-old`;
      const prior = await installPending(statePath, oldState, action, resourceId, oldActionId, identity, mode);
      const state = takeoverExpiredLease(oldState, { expectedGeneration: oldState.generation, expectedFencingEpoch: oldState.fencingEpoch,
        approvalId: 'approval-new', leaseId: 'lease-new', holderId: 'holder-new',
        now: '2026-09-12T14:11:00.000Z', expiresAt: '2026-09-12T15:00:00.000Z' });
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
      let fetches = 0;
      const result = await runFencedAction(actionArgs(state, action, resourceId, `${action.slice(8)}-${mode}-new`, identity), {
        deployStateRoot: root, now: () => new Date('2026-09-12T14:12:00.000Z'), planBuilder: () => PLAN,
        commandRunner: async () => { fetches += 1; return { exitCode: 0, signal: null, overflow: false, stdout: '{}', stderr: '' }; },
      });
      assert.equal(fetches, 2);
      assert.equal(result.status, 'pass');
      assert.equal(result.verification.retry.mode, `cross-fence-${mode}-superseded-and-retried`);
      const resource = JSON.parse(await readFile(join(resourceDirectory(statePath, resourceId), 'resource-state.json'), 'utf8'));
      assert.equal(resource.highestAcceptedFencingEpoch, state.fencingEpoch);
      assert.equal(resource.pendingAction, null);
      assert.equal(resource.receiptChainHead, result.receiptDigest);
      if (prior.receipt) {
        const canonicalPrior = await readCanonicalExecutorReceiptByDigest(statePath, prior.receipt.receiptDigest);
        assert.equal(canonicalJson(canonicalPrior.receipt), canonicalJson(prior.receipt));
        assert.equal(canonicalPrior.receipt.status, mode);
      }
    });
  }
}

for (const [label, mutate, message] of [
  ['action', (resource) => { resource.pendingAction.action = 'preprod-probe-active'; }, /pending action identity is inconsistent/],
  ['request', (resource) => { resource.pendingAction.requestDigest = `sha256:${'e'.repeat(64)}`; }, /pending action identity is inconsistent/],
  ['manifest identity', (resource) => { resource.manifestDigest = ACTIVE.manifestDigest; }, /pending action identity is inconsistent/],
  ['command', (resource) => { resource.pendingAction.commandDigest = `sha256:${'f'.repeat(64)}`; }, /pending action identity is inconsistent/],
  ['chain head', (resource) => { resource.receiptChainHead = `sha256:${'d'.repeat(64)}`; }, /not present in the canonical store/],
]) {
  test(`read-only probe recovery rejects ${label} drift before fetch`, async (t) => {
    const state = phaseState('preprod-probe-candidate');
    const { root, statePath } = await fixture(state);
    t.after(() => rm(root, { recursive: true, force: true }));
    const resourceId = 'probe:booking-preprod:candidate';
    await installPending(statePath, state, 'preprod-probe-candidate', resourceId, 'drift-old', 'candidate', 'missing');
    const path = join(resourceDirectory(statePath, resourceId), 'resource-state.json');
    const resource = JSON.parse(await readFile(path, 'utf8'));
    mutate(resource);
    await writeFile(path, `${JSON.stringify(resource)}\n`);
    let fetches = 0;
    await assert.rejects(runFencedAction(actionArgs(state, 'preprod-probe-candidate', resourceId, 'drift-old', 'candidate'), {
      deployStateRoot: root, now: () => new Date('2026-09-12T14:09:30.000Z'), planBuilder: () => PLAN,
      commandRunner: async () => { fetches += 1; return { exitCode: 0, signal: null, overflow: false, stdout: '{}', stderr: '' }; },
    }), message);
    assert.equal(fetches, 0);
  });
}
