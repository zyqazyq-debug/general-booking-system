import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { sha256 } from '../release/lib/contracts.mjs';
import { canonicalStatePath, initializeStateFile, mutateStateFile } from '../release/lib/deploy-state-store.mjs';
import { resourceDirectory, writeExecutorReceipt } from '../release/lib/fenced-resource-store.mjs';
import { acquireLease, initialDeployState, takeoverExpiredLease, transitionDeployState } from '../release/lib/state-machine.mjs';
import { parseRootOwnedForensicManifest, runFencedAction } from '../release/execute-fenced-action.mjs';
import { runManageDeployState } from '../release/manage-deploy-state.mjs';

const ACTIVE = { slot: 'green', releaseId: 'booking-20260908T120000Z-aaaaaaa', gitSha: 'a'.repeat(40), manifestDigest: `sha256:${'a'.repeat(64)}` };
const CANDIDATE = { slot: 'blue', releaseId: 'booking-20260910T120000Z-bbbbbbb', gitSha: 'b'.repeat(40), manifestDigest: `sha256:${'b'.repeat(64)}` };
const RUNTIME_ENV = 'RECOVERY_FIXTURE=true\n';
const DEPLOYMENT = { environment: 'preprod', project: 'booking-preprod', active: ACTIVE, runtimeEnvDigest: sha256(RUNTIME_ENV), resources: {
  edgeNetwork: 'booking-preprod-edge', dataNetwork: 'booking-preprod-data', databaseRef: 'database:booking-preprod', ingressRef: 'ingress:booking-preprod',
} };

function failedAfterTakeover() {
  let state = initialDeployState(DEPLOYMENT, '2026-09-10T10:00:00.000Z');
  state = acquireLease(state, { expectedGeneration: 0, expectedFencingEpoch: 0, candidate: CANDIDATE,
    operationId: 'op-recovery', approvalId: 'approval-old', leaseId: 'lease-old', holderId: 'holder-old',
    now: '2026-09-10T10:01:00.000Z', expiresAt: '2026-09-10T10:02:00.000Z' });
  state = transitionDeployState(state, { expectedGeneration: 1, expectedFencingEpoch: 1, leaseId: 'lease-old', holderId: 'holder-old',
    now: '2026-09-10T10:01:10.000Z', to: 'MANIFEST_VERIFIED', manifestDigest: CANDIDATE.manifestDigest });
  state = transitionDeployState(state, { expectedGeneration: 2, expectedFencingEpoch: 1, leaseId: 'lease-old', holderId: 'holder-old',
    now: '2026-09-10T10:01:20.000Z', to: 'STAGED' });
  state = transitionDeployState(state, { expectedGeneration: 3, expectedFencingEpoch: 1, leaseId: 'lease-old', holderId: 'holder-old',
    now: '2026-09-10T10:01:30.000Z', to: 'EXPAND_MIGRATED', expandMigrationReceiptDigest: `sha256:${'e'.repeat(64)}` });
  state = transitionDeployState(state, { expectedGeneration: 4, expectedFencingEpoch: 1, leaseId: 'lease-old', holderId: 'holder-old',
    now: '2026-09-10T10:01:40.000Z', to: 'FAILED' });
  state = takeoverExpiredLease(state, { expectedGeneration: 5, expectedFencingEpoch: 1, approvalId: 'approval-recovery',
    leaseId: 'lease-recovery', holderId: 'holder-recovery', now: '2026-09-10T10:03:00.000Z', expiresAt: '2026-09-10T11:00:00.000Z' });
  return takeoverExpiredLease(state, { expectedGeneration: 6, expectedFencingEpoch: 2, approvalId: 'approval-recovery-next-day',
    leaseId: 'lease-recovery-next-day', holderId: 'holder-recovery', now: '2026-09-10T11:01:00.000Z', expiresAt: '2026-09-10T12:00:00.000Z' });
}

function actionArgs(state, action, resourceId, actionId) {
  return { action, execute: 'true', environment: 'preprod', project: 'booking-preprod', 'approval-id': state.approvalId,
    'expected-generation': String(state.generation), 'expected-fencing-epoch': String(state.fencingEpoch),
    'manifest-digest': CANDIDATE.manifestDigest, 'operation-id': state.operationId, 'lease-id': state.lease.leaseId,
    'holder-id': state.lease.holderId, 'resource-id': resourceId, 'action-id': actionId };
}

const planBuilder = () => ({ executable: '/trusted/readback', argv: ['verify'], cwd: '/trusted',
  readback: { executable: '/trusted/readback', argv: ['verify'], verify: () => ({ independentlyVerified: true }) } });
const registryBoundPlanBuilder = (state) => {
  const registrySupplyChainBinding = { schema: 'booking.registry-runtime-gate/v1',
    operationId: state.operationId, fencingEpoch: state.fencingEpoch,
    components: { backend: { digest: `sha256:${'c'.repeat(64)}` } } };
  return { ...planBuilder(), registrySupplyChainBinding,
    environmentBinding: { BOOKING_REGISTRY_SUPPLY_CHAIN_DIGEST: sha256(registrySupplyChainBinding) } };
};
const runner = async () => ({ exitCode: 0, signal: null, overflow: false, stdout: '', stderr: '' });
const databaseResourceIds = ['database:booking-preprod', 'booking-preprod-data'];

const ABORT_CONTAINER_ID = 'c'.repeat(64);
const abortPlan = () => ({ executable: '/trusted/docker', argv: ['container', 'rm', '--force', '<verified-container-id>'], cwd: '/trusted',
  preflight: { executable: '/trusted/docker', argv: ['container', 'inspect', 'booking-preprod-telegram-egress-1'],
    verify: (stdout) => JSON.parse(stdout) },
  verifyExecution: (stdout) => ({ removedContainerId: stdout.trim() }),
  readback: { executable: '/trusted/docker', argv: ['ps', '-a'], verify: (stdout) => {
    if (stdout.trim()) throw new Error('still present');
    return { containerAbsent: true };
  } } });

function planCommandDigest(plan = planBuilder()) {
  return sha256({ executable: plan.executable, argv: plan.argv, cwd: plan.cwd,
    preflight: plan.preflight ? { executable: plan.preflight.executable, argv: plan.preflight.argv } : null,
    readback: plan.readback ? { executable: plan.readback.executable, argv: plan.readback.argv } : null,
    readbackFromExecution: plan.readbackFromExecution === true, artifactBinding: plan.artifactBinding || null,
    environmentBinding: plan.environmentBinding || null, registrySupplyChainBinding: plan.registrySupplyChainBinding || null });
}

function databaseResourcePath(statePath, resourceId) {
  return join(resourceDirectory(statePath, resourceId), 'resource-state.json');
}

async function installPriorDatabasePending(fixture, receiptMode, requestOverrides = {}, builder = planBuilder) {
  const actionId = 'database-attest-f3';
  const commandDigest = planCommandDigest(builder(fixture.state));
  const request = { schema: 'booking.fenced-action-request/v2', environment: 'preprod', project: 'booking-preprod',
    action: 'preprod-attest-database-restore', actionId, operationId: fixture.state.operationId,
    approvalId: fixture.state.approvalId, generation: fixture.state.generation, fencingEpoch: fixture.state.fencingEpoch,
    leaseId: fixture.state.lease.leaseId, holderId: fixture.state.lease.holderId, manifestDigest: CANDIDATE.manifestDigest,
    releaseIdentity: CANDIDATE, resourceIds: databaseResourceIds, runtimeEnvDigest: fixture.state.runtimeEnvDigest,
    commandDigest, ...requestOverrides };
  request.requestDigest = sha256(request);
  const pending = { actionId, requestDigest: request.requestDigest, action: request.action, approvalId: request.approvalId,
    leaseId: request.leaseId, holderId: request.holderId, generation: request.generation, fencingEpoch: request.fencingEpoch,
    commandDigest: request.commandDigest };
  const previousReceiptDigest = fixture.expandReceipt.receiptDigest;
  for (const resourceId of databaseResourceIds) {
    await writeFile(databaseResourcePath(fixture.statePath, resourceId), `${JSON.stringify({
      schema: 'booking.fenced-resource/v1', environment: 'preprod', project: 'booking-preprod', resourceId,
      highestAcceptedFencingEpoch: 3, operationId: fixture.state.operationId, manifestDigest: CANDIDATE.manifestDigest,
      pendingAction: pending, receiptChainHead: previousReceiptDigest, updatedAt: '2026-09-10T11:02:00.000Z',
    })}\n`);
  }
  let receipt = null;
  if (receiptMode !== 'missing') {
    const { requestDigest, ...requestBody } = request;
    const receiptBody = { ...requestBody, schema: 'booking.external-action-receipt/v2', requestDigest,
      startedAt: '2026-09-10T11:02:00.000Z', completedAt: '2026-09-10T11:02:01.000Z', status: receiptMode,
      executionOutputDigest: sha256('execution'), readbackOutputDigest: sha256('readback'), verification: { fixture: true },
      resources: [...databaseResourceIds].sort().map((resourceId) => ({ resourceId, highestAcceptedFencingEpoch: 3,
        previousReceiptDigest })) };
    receipt = { ...receiptBody, receiptDigest: sha256(receiptBody) };
    await writeExecutorReceipt(fixture.statePath, receipt);
  }
  return { pending, receipt, previousReceiptDigest };
}

async function installTelegramFailureFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'booking-failed-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const statePath = await canonicalStatePath({ environment: 'preprod', project: 'booking-preprod', deployStateRoot: root });
  const state = failedAfterTakeover();
  // Mirror the deployed op06 contract exactly: v2 FAILED has no recovery key.
  // The successful FAILED -> FAILED_RECOVERED CAS is the migration boundary.
  state.schema = 'booking.deploy-state/v2';
  delete state.evidence.telegramEgressReceiptDigest;
  delete state.recovery;
  delete state.observationWindowMinutes;
  delete state.observationStartedAt;
  const databaseReceipt = (action, actionId, previousReceiptDigest) => {
    const request = { schema: 'booking.fenced-action-request/v1', environment: 'preprod', project: 'booking-preprod',
      action, actionId, operationId: state.operationId, approvalId: 'approval-old', generation: 3, fencingEpoch: 1,
      leaseId: 'lease-old', holderId: 'holder-old', manifestDigest: CANDIDATE.manifestDigest,
      releaseIdentity: CANDIDATE, resourceIds: databaseResourceIds, runtimeEnvDigest: state.runtimeEnvDigest,
      commandDigest: `sha256:${action === 'preprod-baseline-ledger' ? 'a' : 'b'}`.padEnd(71, action === 'preprod-baseline-ledger' ? 'a' : 'b') };
    const body = { ...request, schema: 'booking.external-action-receipt/v1', requestDigest: sha256(request),
      startedAt: '2026-09-10T10:01:20.000Z', completedAt: '2026-09-10T10:01:21.000Z', status: 'pass',
      executionOutputDigest: sha256(`${action}:execution`), readbackOutputDigest: sha256(`${action}:readback`),
      verification: { fixture: true }, resources: databaseResourceIds.map((resourceId) => ({ resourceId,
        highestAcceptedFencingEpoch: 1, previousReceiptDigest })) };
    return { ...body, receiptDigest: sha256(body) };
  };
  const baselineReceipt = databaseReceipt('preprod-baseline-ledger', 'baseline-f1', null);
  const expandReceipt = databaseReceipt('preprod-expand-migrate', 'expand-f1', baselineReceipt.receiptDigest);
  state.evidence.baselineReceiptDigest = baselineReceipt.receiptDigest;
  state.evidence.expandMigrationReceiptDigest = expandReceipt.receiptDigest;
  await initializeStateFile(statePath, state);
  await writeExecutorReceipt(statePath, baselineReceipt);
  await writeExecutorReceipt(statePath, expandReceipt);
  const runtimeEnvFile = join(root, 'runtime.env');
  await writeFile(runtimeEnvFile, RUNTIME_ENV);
  const priorPlan = { executable: '/trusted/prepare-egress', argv: ['up'], cwd: '/trusted', readback: null,
    readbackFromExecution: false, artifactBinding: null, environmentBinding: null, registrySupplyChainBinding: null };
  const priorRequest = { schema: 'booking.fenced-action-request/v1', environment: 'preprod', project: 'booking-preprod',
    action: 'preprod-prepare-telegram-egress', actionId: 'egress-old', operationId: state.operationId, approvalId: 'approval-old',
    generation: 4, fencingEpoch: 1, leaseId: 'lease-old', holderId: 'holder-old', manifestDigest: CANDIDATE.manifestDigest,
    releaseIdentity: CANDIDATE, resourceIds: ['telegram:booking-preprod'], runtimeEnvDigest: state.runtimeEnvDigest,
    commandDigest: sha256(priorPlan) };
  const priorFailureBody = { ...priorRequest, schema: 'booking.external-action-receipt/v1', requestDigest: sha256(priorRequest),
    startedAt: '2026-09-10T10:01:31.000Z', completedAt: '2026-09-10T10:01:32.000Z', status: 'fail',
    executionOutputDigest: sha256(''), readbackOutputDigest: sha256(''), verification: { error: 'fixture failure' },
    resources: [{ resourceId: 'telegram:booking-preprod', highestAcceptedFencingEpoch: 1, previousReceiptDigest: null }] };
  const priorFailure = { ...priorFailureBody, receiptDigest: sha256(priorFailureBody) };
  await writeExecutorReceipt(statePath, priorFailure);
  const resourceState = (resourceId, pendingAction, receiptChainHead = null) => ({ schema: 'booking.fenced-resource/v1',
    environment: 'preprod', project: 'booking-preprod', resourceId, highestAcceptedFencingEpoch: 1,
    operationId: state.operationId, manifestDigest: CANDIDATE.manifestDigest, pendingAction, receiptChainHead,
    updatedAt: '2026-09-10T10:01:32.000Z' });
  const telegramPath = join(resourceDirectory(statePath, 'telegram:booking-preprod'), 'resource-state.json');
  await mkdir(dirname(telegramPath), { recursive: true });
  await writeFile(telegramPath, `${JSON.stringify(resourceState('telegram:booking-preprod', {
    actionId: priorRequest.actionId, requestDigest: priorFailure.requestDigest, action: priorRequest.action,
    approvalId: priorRequest.approvalId, leaseId: priorRequest.leaseId, holderId: priorRequest.holderId,
    generation: priorRequest.generation, fencingEpoch: priorRequest.fencingEpoch, commandDigest: priorRequest.commandDigest,
  }))}\n`);
  for (const resourceId of ['database:booking-preprod', 'booking-preprod-data']) {
    const path = join(resourceDirectory(statePath, resourceId), 'resource-state.json');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(resourceState(resourceId, null, expandReceipt.receiptDigest))}\n`);
  }
  const recoveryBinding = { operationId: state.operationId, manifestDigest: CANDIDATE.manifestDigest,
    forensicFencingEpoch: 2, forensicApprovalId: 'approval-recovery',
    priorTelegramFencingEpoch: 1, priorTelegramActionId: priorRequest.actionId,
    priorTelegramFailureReceiptDigest: priorFailure.receiptDigest };
  return { root, statePath, state, runtimeEnvFile, telegramPath, priorFailure, recoveryBinding, baselineReceipt, expandReceipt };
}

async function takeoverToFenceFour(statePath) {
  return mutateStateFile(statePath, (current) => takeoverExpiredLease(current, {
    expectedGeneration: current.generation, expectedFencingEpoch: 3, approvalId: 'approval-recovery-f4',
    leaseId: 'lease-recovery-f4', holderId: 'holder-recovery', now: '2026-09-10T12:01:00.000Z',
    expiresAt: '2026-09-10T13:00:00.000Z',
  }));
}

test('forensic manifest parser accepts the real root|root staging format and rejects numeric ownership', () => {
  const digest = '1'.repeat(64);
  const parsed = parseRootOwnedForensicManifest(`restore-summary.txt|600|root|root|123|${digest}  /evidence/.incident.staging/restore-summary.txt\n`);
  assert.deepEqual(parsed.get('restore-summary.txt'), { mode: 0o600, uid: 0, gid: 0, size: 123, digest: `sha256:${digest}` });
  assert.throws(() => parseRootOwnedForensicManifest(`restore-summary.txt|600|0|0|123|${digest}  /evidence/restore-summary.txt\n`), /manifest entry/);
});

test('failed recovery after a second takeover closes prior resources and preserves the newer fence through IDLE', async (t) => {
  const { root, statePath, state, runtimeEnvFile, telegramPath, recoveryBinding } = await installTelegramFailureFixture(t);
  const now = () => new Date('2026-09-10T11:02:00.000Z');
  let rejectedRunnerCalls = 0;
  await assert.rejects(runFencedAction(actionArgs(state, 'preprod-abort-telegram-egress', 'telegram:booking-preprod', 'egress-abort'),
    { deployStateRoot: root, now, planBuilder, commandRunner: async () => { rejectedRunnerCalls += 1; return runner(); },
      failedRestoreBinding: { ...recoveryBinding, priorTelegramFailureReceiptDigest: `sha256:${'f'.repeat(64)}` } }), /fixed prior failure receipt/);
  assert.equal(rejectedRunnerCalls, 0);
  const telegram = await runFencedAction(actionArgs(state, 'preprod-abort-telegram-egress', 'telegram:booking-preprod', 'egress-abort'),
    { deployStateRoot: root, now, planBuilder, commandRunner: runner, failedRestoreBinding: recoveryBinding });
  const database = await runFencedAction(actionArgs(state, 'preprod-attest-database-restore', 'database:booking-preprod', 'database-attest'),
    { deployStateRoot: root, now, planBuilder, commandRunner: runner, failedRestoreBinding: recoveryBinding });
  const activeActionArgs = (action, resourceId, actionId) => ({ ...actionArgs(state, action, resourceId, actionId),
    'manifest-digest': ACTIVE.manifestDigest });
  const activeRuntime = await runFencedAction(activeActionArgs('preprod-restore-active-runtime', 'booking-preprod-edge', 'active-runtime-restore'),
    { deployStateRoot: root, now, planBuilder, commandRunner: runner, failedRestoreBinding: recoveryBinding });
  const activeProbe = await runFencedAction(activeActionArgs('preprod-probe-recovered-active', 'probe:booking-preprod:active', 'active-recovered-probe'),
    { deployStateRoot: root, now, planBuilder, commandRunner: runner, failedRestoreBinding: recoveryBinding });
  for (const resourceId of ['telegram:booking-preprod', 'database:booking-preprod', 'booking-preprod-data']) {
    const resource = JSON.parse(await readFile(join(resourceDirectory(statePath, resourceId), 'resource-state.json'), 'utf8'));
    assert.equal(resource.highestAcceptedFencingEpoch, 3);
    assert.equal(resource.pendingAction, null);
  }

  const manage = (to, generation, extra = {}) => runManageDeployState({ action: 'transition', execute: 'true', environment: 'preprod',
    project: 'booking-preprod', 'approval-id': state.approvalId, 'expected-generation': String(generation),
    'expected-fencing-epoch': '3', 'manifest-digest': CANDIDATE.manifestDigest, 'operation-id': state.operationId,
    'lease-id': state.lease.leaseId, 'holder-id': state.lease.holderId, 'observation-window-minutes': '30', to, ...extra },
  { deployStateRoot: root, runtimeEnvFile, allowInsecureTestPaths: true, nowMs: Date.parse('2026-09-10T11:03:00.000Z') });
  await assert.rejects(manage('FAILED_RECOVERED', state.generation, {
    'database-restore-receipt-digest': `sha256:${'f'.repeat(64)}`, 'telegram-abort-receipt-digest': telegram.receiptDigest,
    'active-runtime-restore-receipt-digest': activeRuntime.receiptDigest, 'active-probe-digest': activeProbe.receiptDigest }), /canonical store|receipt/);
  const recovered = await manage('FAILED_RECOVERED', state.generation, {
    'database-restore-receipt-digest': database.receiptDigest, 'telegram-abort-receipt-digest': telegram.receiptDigest,
    'active-runtime-restore-receipt-digest': activeRuntime.receiptDigest, 'active-probe-digest': activeProbe.receiptDigest });
  assert.equal(recovered.phase, 'FAILED_RECOVERED');
  assert.equal(recovered.schema, 'booking.deploy-state/v3');
  assert.equal(recovered.fencingEpoch, 3);

  const recoveryResourcePaths = ['telegram:booking-preprod', 'database:booking-preprod', 'booking-preprod-data',
    'booking-preprod-edge', 'ingress:booking-preprod', 'probe:booking-preprod:active']
    .map((resourceId) => join(resourceDirectory(statePath, resourceId), 'resource-state.json'));
  for (const path of recoveryResourcePaths) {
    const saved = await readFile(path, 'utf8');
    await rm(path);
    await assert.rejects(manage('IDLE', recovered.generation), /completion state is missing/);
    await writeFile(path, saved);
  }
  const savedTelegram = await readFile(telegramPath, 'utf8');
  const forgedTelegram = JSON.parse(savedTelegram);
  forgedTelegram.receiptChainHead = recovered.recovery.priorFailedStateDigest;
  await writeFile(telegramPath, `${JSON.stringify(forgedTelegram)}\n`);
  await assert.rejects(manage('IDLE', recovered.generation), /mutation head/);
  await writeFile(telegramPath, savedTelegram);

  const idle = await manage('IDLE', recovered.generation);
  assert.equal(idle.phase, 'IDLE');
  assert.equal(idle.fencingEpoch, 3);
  assert.equal(idle.recovery, null);
  assert.match(idle.receiptChainHead, /^sha256:/);
  const terminalReceipt = JSON.parse(await readFile(join(dirname(statePath), 'receipts',
    `${String(idle.generation).padStart(12, '0')}.json`), 'utf8'));
  assert.equal(terminalReceipt.schema, 'booking.deploy-receipt/v2');
  assert.equal(terminalReceipt.terminalPhase, 'FAILED_RECOVERED');
  assert.equal(terminalReceipt.receiptDigest, idle.receiptChainHead);
  assert.equal(terminalReceipt.recovery.priorFailedStateDigest, sha256(state));
});

test('completed fence-3 Telegram abort is independently re-attested and chained by a fence-4 takeover', async (t) => {
  const fixture = await installTelegramFailureFixture(t);
  const atFenceThree = () => new Date('2026-09-10T11:02:00.000Z');
  const fenceThree = await runFencedAction(actionArgs(fixture.state, 'preprod-abort-telegram-egress',
    'telegram:booking-preprod', 'egress-abort-f3'), { deployStateRoot: fixture.root, now: atFenceThree,
    planBuilder: registryBoundPlanBuilder, commandRunner: runner, failedRestoreBinding: fixture.recoveryBinding });
  const stateFour = await takeoverToFenceFour(fixture.statePath);
  assert.notEqual(planCommandDigest(registryBoundPlanBuilder(fixture.state)),
    planCommandDigest(registryBoundPlanBuilder(stateFour)));
  const completedThree = JSON.parse(await readFile(fixture.telegramPath, 'utf8'));
  await writeFile(fixture.telegramPath, `${JSON.stringify({ ...completedThree, receiptChainHead: `sha256:${'9'.repeat(64)}` })}\n`);
  let rejectedReadbacks = 0;
  await assert.rejects(runFencedAction(actionArgs(stateFour, 'preprod-abort-telegram-egress',
    'telegram:booking-preprod', 'egress-abort-f4'), { deployStateRoot: fixture.root,
    now: () => new Date('2026-09-10T12:02:00.000Z'), planBuilder: registryBoundPlanBuilder,
    commandRunner: async () => { rejectedReadbacks += 1; return runner(); }, failedRestoreBinding: fixture.recoveryBinding }),
  /canonical store/);
  assert.equal(rejectedReadbacks, 0);
  await writeFile(fixture.telegramPath, `${JSON.stringify(completedThree)}\n`);
  let changedRegistryCalls = 0;
  const changedRegistryPlanBuilder = (current) => {
    const original = registryBoundPlanBuilder(current);
    const registrySupplyChainBinding = { ...original.registrySupplyChainBinding,
      components: { backend: { digest: `sha256:${'d'.repeat(64)}` } } };
    return { ...original, registrySupplyChainBinding,
      environmentBinding: { BOOKING_REGISTRY_SUPPLY_CHAIN_DIGEST: sha256(registrySupplyChainBinding) } };
  };
  await assert.rejects(runFencedAction(actionArgs(stateFour, 'preprod-abort-telegram-egress',
    'telegram:booking-preprod', 'egress-abort-f4'), { deployStateRoot: fixture.root,
    now: () => new Date('2026-09-10T12:02:00.000Z'), planBuilder: changedRegistryPlanBuilder,
    commandRunner: async () => { changedRegistryCalls += 1; return runner(); },
    failedRestoreBinding: fixture.recoveryBinding }), /prior receipt is not canonically bound/);
  assert.equal(changedRegistryCalls, 0);
  let readbacks = 0;
  const fenceFour = await runFencedAction(actionArgs(stateFour, 'preprod-abort-telegram-egress',
    'telegram:booking-preprod', 'egress-abort-f4'), { deployStateRoot: fixture.root,
    now: () => new Date('2026-09-10T12:02:00.000Z'), planBuilder: registryBoundPlanBuilder,
    commandRunner: async () => { readbacks += 1; return runner(); }, failedRestoreBinding: fixture.recoveryBinding });
  assert.equal(readbacks, 2);
  assert.equal(fenceFour.fencingEpoch, 4);
  assert.equal(fenceFour.resources[0].previousReceiptDigest, fenceThree.receiptDigest);
  assert.deepEqual(fenceFour.verification.priorFailure, fenceThree.verification.priorFailure);
  const resource = JSON.parse(await readFile(fixture.telegramPath, 'utf8'));
  assert.equal(resource.highestAcceptedFencingEpoch, 4);
  assert.equal(resource.pendingAction, null);
  assert.equal(resource.receiptChainHead, fenceFour.receiptDigest);
});

for (const priorReceiptMode of ['missing', 'pass']) {
  test(`fence-4 Telegram abort re-attests a fence-3 pending action with ${priorReceiptMode} receipt`, async (t) => {
    const fixture = await installTelegramFailureFixture(t);
    const argsThree = actionArgs(fixture.state, 'preprod-abort-telegram-egress', 'telegram:booking-preprod', 'egress-abort-f3');
    let fenceThreeReceipt = null;
    if (priorReceiptMode === 'missing') {
      let calls = 0;
      await assert.rejects(runFencedAction(argsThree, { deployStateRoot: fixture.root,
        now: () => new Date('2026-09-10T11:02:00.000Z'), planBuilder: registryBoundPlanBuilder,
        commandRunner: async () => { calls += 1; return calls === 1 ? runner() : { ...(await runner()), exitCode: 1 }; },
        failedRestoreBinding: fixture.recoveryBinding }), /external action failed/);
      assert.equal(calls, 2);
    } else {
      fenceThreeReceipt = await runFencedAction(argsThree, { deployStateRoot: fixture.root,
        now: () => new Date('2026-09-10T11:02:00.000Z'), planBuilder: registryBoundPlanBuilder, commandRunner: runner,
        failedRestoreBinding: fixture.recoveryBinding });
      const pending = { actionId: fenceThreeReceipt.actionId, requestDigest: fenceThreeReceipt.requestDigest,
        action: fenceThreeReceipt.action, approvalId: fenceThreeReceipt.approvalId, leaseId: fenceThreeReceipt.leaseId,
        holderId: fenceThreeReceipt.holderId, generation: fenceThreeReceipt.generation,
        fencingEpoch: fenceThreeReceipt.fencingEpoch, commandDigest: fenceThreeReceipt.commandDigest };
      await writeFile(fixture.telegramPath, `${JSON.stringify({ schema: 'booking.fenced-resource/v1', environment: 'preprod',
        project: 'booking-preprod', resourceId: 'telegram:booking-preprod', highestAcceptedFencingEpoch: 3,
        operationId: fixture.state.operationId, manifestDigest: CANDIDATE.manifestDigest, pendingAction: pending,
        receiptChainHead: fenceThreeReceipt.resources[0].previousReceiptDigest, updatedAt: '2026-09-10T11:02:00.000Z' })}\n`);
    }
    const stateFour = await takeoverToFenceFour(fixture.statePath);
    if (priorReceiptMode === 'missing') {
      let rejectedReadbacks = 0;
      const changedPlanBuilder = (current) => ({ ...registryBoundPlanBuilder(current), argv: ['changed'] });
      await assert.rejects(runFencedAction(actionArgs(stateFour, 'preprod-abort-telegram-egress',
        'telegram:booking-preprod', 'egress-abort-f4'), { deployStateRoot: fixture.root,
        now: () => new Date('2026-09-10T12:02:00.000Z'), planBuilder: changedPlanBuilder,
        commandRunner: async () => { rejectedReadbacks += 1; return runner(); }, failedRestoreBinding: fixture.recoveryBinding }),
      /prior pending request identity/);
      assert.equal(rejectedReadbacks, 0);
    }
    let readbacks = 0;
    const fenceFour = await runFencedAction(actionArgs(stateFour, 'preprod-abort-telegram-egress',
      'telegram:booking-preprod', 'egress-abort-f4'), { deployStateRoot: fixture.root,
      now: () => new Date('2026-09-10T12:02:00.000Z'), planBuilder: registryBoundPlanBuilder,
      commandRunner: async () => { readbacks += 1; return runner(); }, failedRestoreBinding: fixture.recoveryBinding });
    assert.equal(readbacks, 2);
    assert.equal(fenceFour.fencingEpoch, 4);
    assert.equal(fenceFour.resources[0].previousReceiptDigest, fenceThreeReceipt?.receiptDigest || null);
    const resource = JSON.parse(await readFile(fixture.telegramPath, 'utf8'));
    assert.equal(resource.highestAcceptedFencingEpoch, 4);
    assert.equal(resource.pendingAction, null);
    assert.equal(resource.receiptChainHead, fenceFour.receiptDigest);
  });
}

test('Telegram abort re-inspects identity and removes the immutable container ID, never the mutable name', async (t) => {
  const fixture = await installTelegramFailureFixture(t);
  let readbacks = 0;
  let removes = 0;
  const receipt = await runFencedAction(actionArgs(fixture.state, 'preprod-abort-telegram-egress',
    'telegram:booking-preprod', 'egress-abort-by-id'), { deployStateRoot: fixture.root,
    now: () => new Date('2026-09-10T11:02:00.000Z'), planBuilder: abortPlan,
    commandRunner: async (_executable, argv) => {
      if (argv[0] === 'ps') {
        readbacks += 1;
        return { ...(await runner()), stdout: readbacks === 1 ? 'present' : '' };
      }
      if (argv[0] === 'container' && argv[1] === 'inspect') {
        return { ...(await runner()), stdout: JSON.stringify({ containerId: ABORT_CONTAINER_ID,
          imageId: `sha256:${'d'.repeat(64)}`, composeProject: 'booking-preprod', composeService: 'telegram-egress' }) };
      }
      if (argv[0] === 'container' && argv[1] === 'rm') {
        removes += 1;
        assert.deepEqual(argv, ['container', 'rm', '--force', ABORT_CONTAINER_ID]);
        return { ...(await runner()), stdout: ABORT_CONTAINER_ID };
      }
      return runner();
    }, failedRestoreBinding: fixture.recoveryBinding });
  assert.equal(receipt.status, 'pass');
  assert.equal(removes, 1);
});

test('Telegram abort freezes when the name resolves to a different container at the second inspect', async (t) => {
  const fixture = await installTelegramFailureFixture(t);
  let inspections = 0;
  let removes = 0;
  await assert.rejects(runFencedAction(actionArgs(fixture.state, 'preprod-abort-telegram-egress',
    'telegram:booking-preprod', 'egress-abort-toctou'), { deployStateRoot: fixture.root,
    now: () => new Date('2026-09-10T11:02:00.000Z'), planBuilder: abortPlan,
    commandRunner: async (_executable, argv) => {
      if (argv[0] === 'ps') return { ...(await runner()), stdout: 'present' };
      if (argv[0] === 'container' && argv[1] === 'inspect') {
        inspections += 1;
        return { ...(await runner()), stdout: JSON.stringify({ containerId: (inspections === 1 ? 'c' : 'e').repeat(64),
          imageId: `sha256:${'d'.repeat(64)}`, composeProject: 'booking-preprod', composeService: 'telegram-egress' }) };
      }
      if (argv[0] === 'container' && argv[1] === 'rm') removes += 1;
      return runner();
    }, failedRestoreBinding: fixture.recoveryBinding }), /changed between identity checks/);
  assert.equal(removes, 0);
});

test('completed fence-3 database restore is freshly re-attested at fence 4 and current completion remains replayable', async (t) => {
  const fixture = await installTelegramFailureFixture(t);
  const argsThree = actionArgs(fixture.state, 'preprod-attest-database-restore', 'database:booking-preprod', 'database-attest-f3');
  const fenceThree = await runFencedAction(argsThree, { deployStateRoot: fixture.root,
    now: () => new Date('2026-09-10T11:02:00.000Z'), planBuilder: registryBoundPlanBuilder, commandRunner: runner,
    failedRestoreBinding: fixture.recoveryBinding });
  assert.equal(fenceThree.verification.continuity.mode, 'fixed-evidence-predecessor');
  const stateFour = await takeoverToFenceFour(fixture.statePath);
  const argsFour = actionArgs(stateFour, 'preprod-attest-database-restore', 'database:booking-preprod', 'database-attest-f4');
  let freshCalls = 0;
  const fenceFour = await runFencedAction(argsFour, { deployStateRoot: fixture.root,
    now: () => new Date('2026-09-10T12:02:00.000Z'), planBuilder: registryBoundPlanBuilder,
    commandRunner: async () => { freshCalls += 1; return runner(); }, failedRestoreBinding: fixture.recoveryBinding });
  assert.equal(freshCalls, 2);
  assert.equal(fenceFour.verification.continuity.mode, 'prior-completed-re-attested');
  assert.equal(fenceFour.verification.continuity.priorReceiptDigest, fenceThree.receiptDigest);
  assert.deepEqual(fenceFour.resources.map((resource) => resource.previousReceiptDigest),
    [fenceThree.receiptDigest, fenceThree.receiptDigest]);
  for (const resourceId of databaseResourceIds) {
    const resource = JSON.parse(await readFile(databaseResourcePath(fixture.statePath, resourceId), 'utf8'));
    assert.equal(resource.highestAcceptedFencingEpoch, 4);
    assert.equal(resource.pendingAction, null);
    assert.equal(resource.receiptChainHead, fenceFour.receiptDigest);
  }
  let replayCalls = 0;
  const replay = await runFencedAction(argsFour, { deployStateRoot: fixture.root,
    now: () => new Date('2026-09-10T12:03:00.000Z'), planBuilder: registryBoundPlanBuilder,
    commandRunner: async () => { replayCalls += 1; return runner(); }, failedRestoreBinding: fixture.recoveryBinding });
  assert.equal(replayCalls, 1);
  assert.equal(replay.receiptDigest, fenceFour.receiptDigest);
});

test('fixed database restore rejects a shared forged predecessor head before any readback', async (t) => {
  const fixture = await installTelegramFailureFixture(t);
  const forged = `sha256:${'9'.repeat(64)}`;
  for (const resourceId of databaseResourceIds) {
    const path = databaseResourcePath(fixture.statePath, resourceId);
    const resource = JSON.parse(await readFile(path, 'utf8'));
    resource.receiptChainHead = forged;
    await writeFile(path, `${JSON.stringify(resource)}\n`);
  }
  let calls = 0;
  await assert.rejects(runFencedAction(actionArgs(fixture.state, 'preprod-attest-database-restore',
    'database:booking-preprod', 'database-attest-forged-head'), { deployStateRoot: fixture.root,
    now: () => new Date('2026-09-10T11:02:00.000Z'), planBuilder,
    commandRunner: async () => { calls += 1; return runner(); }, failedRestoreBinding: fixture.recoveryBinding }),
  /rooted migration evidence/);
  assert.equal(calls, 0);
});

for (const receiptMode of ['missing', 'fail', 'pass']) {
  test(`fence-4 database restore safely continues a fence-3 pending action with ${receiptMode} receipt`, async (t) => {
    const fixture = await installTelegramFailureFixture(t);
    const prior = await installPriorDatabasePending(fixture, receiptMode, {}, registryBoundPlanBuilder);
    const stateFour = await takeoverToFenceFour(fixture.statePath);
    let freshCalls = 0;
    const fenceFour = await runFencedAction(actionArgs(stateFour, 'preprod-attest-database-restore',
      'database:booking-preprod', `database-attest-f4-${receiptMode}`), { deployStateRoot: fixture.root,
      now: () => new Date('2026-09-10T12:02:00.000Z'), planBuilder: registryBoundPlanBuilder,
      commandRunner: async () => { freshCalls += 1; return runner(); }, failedRestoreBinding: fixture.recoveryBinding });
    assert.equal(freshCalls, 2);
    assert.equal(fenceFour.verification.continuity.mode, receiptMode === 'pass'
      ? 'prior-pending-pass-adopted' : `prior-pending-${receiptMode === 'fail' ? 'fail' : 'without-receipt'}-superseded`);
    const expectedPredecessor = receiptMode === 'pass' ? prior.receipt.receiptDigest : prior.previousReceiptDigest;
    assert.deepEqual(fenceFour.resources.map((resource) => resource.previousReceiptDigest),
      [expectedPredecessor, expectedPredecessor]);
    for (const resourceId of databaseResourceIds) {
      const resource = JSON.parse(await readFile(databaseResourcePath(fixture.statePath, resourceId), 'utf8'));
      assert.equal(resource.highestAcceptedFencingEpoch, 4);
      assert.equal(resource.pendingAction, null);
      assert.equal(resource.receiptChainHead, fenceFour.receiptDigest);
    }
  });
}

for (const drift of ['one-resource', 'predecessor', 'runtime-env', 'command', 'resources']) {
  test(`fence-4 database continuation fails closed before readback on ${drift} drift`, async (t) => {
    const fixture = await installTelegramFailureFixture(t);
    const overrides = drift === 'runtime-env' ? { runtimeEnvDigest: `sha256:${'7'.repeat(64)}` }
      : drift === 'command' ? { commandDigest: `sha256:${'8'.repeat(64)}` }
        : drift === 'resources' ? { resourceIds: ['database:booking-preprod'] } : {};
    await installPriorDatabasePending(fixture, 'pass', overrides, registryBoundPlanBuilder);
    if (drift === 'one-resource' || drift === 'predecessor') {
      const path = databaseResourcePath(fixture.statePath, 'booking-preprod-data');
      const resource = JSON.parse(await readFile(path, 'utf8'));
      if (drift === 'one-resource') resource.pendingAction = { ...resource.pendingAction, requestDigest: `sha256:${'9'.repeat(64)}` };
      else resource.receiptChainHead = `sha256:${'6'.repeat(64)}`;
      await writeFile(path, `${JSON.stringify(resource)}\n`);
    }
    const stateFour = await takeoverToFenceFour(fixture.statePath);
    let calls = 0;
    await assert.rejects(runFencedAction(actionArgs(stateFour, 'preprod-attest-database-restore',
      'database:booking-preprod', `database-attest-f4-drift-${drift}`), { deployStateRoot: fixture.root,
      now: () => new Date('2026-09-10T12:02:00.000Z'), planBuilder: registryBoundPlanBuilder,
      commandRunner: async () => { calls += 1; return runner(); }, failedRestoreBinding: fixture.recoveryBinding }),
    /database restore (prior pending|resources do not share)/);
    assert.equal(calls, 0);
    for (const resourceId of databaseResourceIds) {
      const resource = JSON.parse(await readFile(databaseResourcePath(fixture.statePath, resourceId), 'utf8'));
      assert.equal(resource.highestAcceptedFencingEpoch, 3);
    }
  });
}
