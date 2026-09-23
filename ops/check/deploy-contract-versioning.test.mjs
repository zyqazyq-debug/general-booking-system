import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import deployReceiptSchema from '../contracts/deploy-receipt.schema.json' with { type: 'json' };
import deployStateSchema from '../contracts/deploy-state.schema.json' with { type: 'json' };
import externalReceiptSchema from '../contracts/external-action-receipt.schema.json' with { type: 'json' };
import { canonicalJson, sha256 } from '../release/lib/contracts.mjs';
import { initializeStateFile, mutateStateFile, validateDeployReceipt, verifyCanonicalDeployReceiptChain } from '../release/lib/deploy-state-store.mjs';
import { schemaForAction } from '../release/lib/external-action-contract.mjs';
import { writeExecutorReceipt } from '../release/lib/fenced-resource-store.mjs';
import { acquireLease, initialDeployState, renewLease, transitionDeployState, validateDeployState } from '../release/lib/state-machine.mjs';

const D = (digit) => `sha256:${digit.repeat(64)}`;
const ACTIVE = { slot: 'green', releaseId: 'booking-20260908T120000Z-aaaaaaa', gitSha: 'a'.repeat(40), manifestDigest: D('a') };
const CANDIDATE = { slot: 'blue', releaseId: 'booking-20260910T120000Z-bbbbbbb', gitSha: 'b'.repeat(40), manifestDigest: D('b') };
const DEPLOYMENT = { environment: 'preprod', project: 'booking-preprod', resources: {
  edgeNetwork: 'booking-preprod-edge', dataNetwork: 'booking-preprod-data', databaseRef: 'database:booking-preprod',
  ingressRef: 'ingress:booking-preprod' }, active: ACTIVE, runtimeEnvDigest: D('e') };
const RECOVERY = { databaseRestoreReceiptDigest: D('1'), telegramAbortReceiptDigest: D('2'),
  activeRuntimeRestoreReceiptDigest: D('3'), activeProbeDigest: D('4'), priorFailedStateDigest: D('5') };

function legacyV2Idle() {
  const state = initialDeployState(DEPLOYMENT, '2026-09-10T10:00:00.000Z');
  state.schema = 'booking.deploy-state/v2';
  delete state.evidence.telegramEgressReceiptDigest;
  delete state.recovery;
  delete state.observationWindowMinutes;
  delete state.observationStartedAt;
  return validateDeployState(state);
}

function leaseInput(state, now = '2026-09-10T10:01:00.000Z') {
  return { expectedGeneration: state.generation, expectedFencingEpoch: state.fencingEpoch, candidate: CANDIDATE,
    operationId: 'op-versioning', approvalId: 'approval-versioning', leaseId: 'lease-versioning', holderId: 'holder-versioning',
    now, expiresAt: '2026-09-10T11:00:00.000Z' };
}

function evidence() {
  return { baselineReceiptDigest: null, expandMigrationReceiptDigest: null, telegramEgressReceiptDigest: null, stageReceiptDigest: null, candidateProbeDigest: null,
    rollbackPreSwitchProbeDigest: null, singletonTransferReceiptDigest: null, switchReceiptDigest: null, webhookReceiptDigest: null,
    observationReceiptDigest: null, rollbackReceiptDigest: null, rollbackSingletonTransferReceiptDigest: null, rolledBackProbeDigest: null };
}

function legacyEvidenceWithoutTelegram() {
  const { telegramEgressReceiptDigest: _removed, ...legacy } = evidence();
  return legacy;
}

function deployReceipt({ generation, previousReceiptDigest = null, activeIdentity = ACTIVE, schema = 'booking.deploy-receipt/v1',
  terminalPhase = 'COMMITTED', environment = 'preprod', recovery } = {}) {
  const body = { schema, environment, project: environment === 'preprod' ? 'booking-preprod' : 'booking-prod', generation,
    fencingEpoch: generation, operationId: `op-${generation}`, approvalId: `approval-${generation}`, terminalPhase,
    previousReceiptDigest, terminalStateDigest: D('9'), activeIdentity, evidence: evidence(), ...(recovery ? { recovery } : {}) };
  return { ...body, receiptDigest: sha256(body) };
}

async function writeReceipt(statePath, receipt, name = `${String(receipt.generation).padStart(12, '0')}.json`) {
  const path = join(dirname(statePath), 'receipts', name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(receipt)}\n`);
  return path;
}

test('deploy state v2 remains frozen while acquire and failed recovery upgrade to v3', () => {
  const v2 = legacyV2Idle();
  assert.equal(initialDeployState(DEPLOYMENT, '2026-09-10T10:00:00.000Z').schema, 'booking.deploy-state/v3');
  assert.throws(() => validateDeployState({ ...v2, recovery: null }), /recovery is not allowed/);
  assert.throws(() => validateDeployState({ ...v2, phase: 'FAILED_RECOVERED' }), /phase is invalid/);

  const acquiredV3 = acquireLease(v2, leaseInput(v2));
  assert.equal(acquiredV3.schema, 'booking.deploy-state/v3');
  assert.equal(acquiredV3.recovery, null);

  const runningV2 = structuredClone(acquiredV3);
  runningV2.schema = 'booking.deploy-state/v2';
  delete runningV2.evidence.telegramEgressReceiptDigest;
  delete runningV2.recovery;
  delete runningV2.observationWindowMinutes;
  delete runningV2.observationStartedAt;
  validateDeployState(runningV2);
  const renewed = renewLease(runningV2, { expectedGeneration: 1, expectedFencingEpoch: 1, leaseId: 'lease-versioning',
    holderId: 'holder-versioning', now: '2026-09-10T10:02:00.000Z', expiresAt: '2026-09-10T12:00:00.000Z' });
  assert.equal(renewed.schema, 'booking.deploy-state/v2');
  const failedV2 = transitionDeployState(runningV2, { expectedGeneration: 1, expectedFencingEpoch: 1,
    leaseId: 'lease-versioning', holderId: 'holder-versioning', now: '2026-09-10T10:03:00.000Z', to: 'FAILED' });
  assert.equal(failedV2.schema, 'booking.deploy-state/v2');
  const legacyFailedV2 = { ...failedV2, evidence: legacyEvidenceWithoutTelegram() };
  validateDeployState(legacyFailedV2);
  const originalDigest = sha256(legacyFailedV2);
  const recovered = transitionDeployState(legacyFailedV2, { expectedGeneration: 2, expectedFencingEpoch: 1,
    leaseId: 'lease-versioning', holderId: 'holder-versioning', now: '2026-09-10T10:04:00.000Z', to: 'FAILED_RECOVERED',
    ...RECOVERY, priorFailedStateDigest: originalDigest });
  assert.equal(recovered.schema, 'booking.deploy-state/v3');
  assert.equal(recovered.evidence.telegramEgressReceiptDigest, null);
  assert.equal(recovered.recovery.priorFailedStateDigest, originalDigest);
});

test('legacy v2 evidence compatibility accepts only the exact pre-Telegram shape', () => {
  const legacy = { ...legacyV2Idle(), evidence: legacyEvidenceWithoutTelegram() };
  assert.equal(validateDeployState(legacy), legacy);
  assert.throws(() => validateDeployState({ ...legacy, evidence: evidence() }), /telegramEgressReceiptDigest is not allowed/);
  assert.throws(() => validateDeployState({ ...legacy, schema: 'booking.deploy-state/v3', recovery: null,
    observationWindowMinutes: 30, observationStartedAt: null }), /telegramEgressReceiptDigest is required/);
  const { rollbackPreSwitchProbeDigest: _removed, ...tooOld } = legacy.evidence;
  assert.throws(() => validateDeployState({ ...legacy, evidence: tooOld }), /rollbackPreSwitchProbeDigest is required/);
  assert.throws(() => validateDeployState({ ...legacy, evidence: { ...legacy.evidence, unknownReceiptDigest: null } }),
    /telegramEgressReceiptDigest is required|unknownReceiptDigest is not allowed/);
  assert.throws(() => validateDeployState({ ...legacy, evidence: { ...legacy.evidence, stageReceiptDigest: 'not-a-digest' } }),
    /stageReceiptDigest is invalid/);
});

test('deploy state schema admits only pre-switch or post-switch FAILED shapes in v2 and v3', () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validateState = ajv.compile(deployStateSchema);
  const idleV3 = initialDeployState(DEPLOYMENT, '2026-09-10T10:00:00.000Z');
  const acquiredV3 = acquireLease(idleV3, leaseInput(idleV3));
  const failedV3 = transitionDeployState(acquiredV3, { expectedGeneration: acquiredV3.generation,
    expectedFencingEpoch: acquiredV3.fencingEpoch, leaseId: acquiredV3.lease.leaseId, holderId: acquiredV3.lease.holderId,
    now: '2026-09-10T10:02:00.000Z', to: 'FAILED' });
  const failedV2 = structuredClone(failedV3);
  failedV2.schema = 'booking.deploy-state/v2';
  delete failedV2.evidence.telegramEgressReceiptDigest;
  delete failedV2.recovery;
  delete failedV2.observationWindowMinutes;
  delete failedV2.observationStartedAt;

  for (const preSwitch of [failedV2, failedV3]) {
    const postSwitch = { ...preSwitch, active: CANDIDATE, candidate: null,
      evidence: { ...preSwitch.evidence, switchReceiptDigest: D('1') } };
    assert.equal(validateState(preSwitch), true, canonicalJson(validateState.errors));
    assert.equal(validateState(postSwitch), true, canonicalJson(validateState.errors));
    assert.equal(validateState({ ...preSwitch, rollback: null }), false, 'FAILED requires rollback identity');
    assert.equal(validateState({ ...preSwitch, candidate: null }), false, 'pre-switch FAILED requires candidate identity');
    assert.equal(validateState({ ...preSwitch, evidence: { ...preSwitch.evidence, switchReceiptDigest: D('1') } }), false,
      'pre-switch FAILED rejects switch evidence');
    assert.equal(validateState({ ...postSwitch, evidence: { ...postSwitch.evidence, switchReceiptDigest: null } }), false,
      'post-switch FAILED requires switch evidence');
    assert.equal(validateState({ ...postSwitch, candidate: ACTIVE }), false, 'post-switch FAILED rejects candidate identity');
  }
});

for (const terminalPhase of ['COMMITTED', 'ROLLED_BACK']) {
  test(`legacy v2 ${terminalPhase} closes through a v1 receipt into a v3 IDLE chain head`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), `booking-v2-${terminalPhase.toLowerCase()}-`));
    t.after(() => rm(root, { recursive: true, force: true }));
    const statePath = join(root, 'deploy-state.json');
    const predecessor = deployReceipt({ generation: 1, activeIdentity: ACTIVE });
    await writeReceipt(statePath, predecessor);
    const terminal = {
      ...legacyV2Idle(),
      generation: 2,
      fencingEpoch: 1,
      phase: terminalPhase,
      operationId: 'op-versioning',
      approvalId: 'approval-versioning',
      lease: {
        leaseId: 'lease-versioning', holderId: 'holder-versioning', fencingEpoch: 1,
        acquiredAt: '2026-09-10T10:01:00.000Z', expiresAt: '2026-09-10T11:00:00.000Z',
      },
      active: terminalPhase === 'COMMITTED' ? CANDIDATE : ACTIVE,
      candidate: terminalPhase === 'COMMITTED' ? null : CANDIDATE,
      rollback: ACTIVE,
      receiptChainHead: predecessor.receiptDigest,
      updatedAt: '2026-09-10T10:04:00.000Z',
    };
    validateDeployState(terminal);
    await initializeStateFile(statePath, terminal);

    const idle = await mutateStateFile(statePath, (current) => transitionDeployState(current, {
      expectedGeneration: current.generation,
      expectedFencingEpoch: current.fencingEpoch,
      leaseId: current.lease.leaseId,
      holderId: current.lease.holderId,
      now: '2026-09-10T10:05:00.000Z',
      to: 'IDLE',
    }));

    assert.equal(idle.schema, 'booking.deploy-state/v3');
    assert.equal(idle.phase, 'IDLE');
    assert.equal(idle.recovery, null);
    assert.match(idle.receiptChainHead, /^sha256:[0-9a-f]{64}$/);
    const receipt = JSON.parse(await readFile(join(root, 'receipts', '000000000003.json'), 'utf8'));
    assert.equal(receipt.schema, 'booking.deploy-receipt/v1');
    assert.equal(receipt.terminalPhase, terminalPhase);
    assert.equal(receipt.previousReceiptDigest, predecessor.receiptDigest);
    assert.equal(receipt.receiptDigest, idle.receiptChainHead);
    assert.deepEqual(receipt.activeIdentity, idle.active);
    assert.equal((await verifyCanonicalDeployReceiptChain(statePath, idle, { mode: 'acquire' })).length, 2);
  });
}

test('JSON schemas and schemaForAction enforce exact legacy/recovery/local-ingress version routing', () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(deployStateSchema);
  const validateState = ajv.getSchema(deployStateSchema.$id);
  const validateDeployReceiptSchema = ajv.compile(deployReceiptSchema);
  const validateExternal = ajv.compile(externalReceiptSchema);
  const v2 = legacyV2Idle();
  const v3 = initialDeployState(DEPLOYMENT, '2026-09-10T10:00:00.000Z');
  assert.equal(validateState(v2), true, canonicalJson(validateState.errors));
  assert.equal(validateState(v3), true, canonicalJson(validateState.errors));
  const legacyV2Evidence = { ...v2, evidence: legacyEvidenceWithoutTelegram() };
  assert.equal(validateState(legacyV2Evidence), true, canonicalJson(validateState.errors));
  assert.equal(validateState({ ...v3, evidence: legacyEvidenceWithoutTelegram() }), false);
  const { rollbackPreSwitchProbeDigest: _tooOldRemoved, ...tooOldEvidence } = legacyV2Evidence.evidence;
  assert.equal(validateState({ ...v2, evidence: tooOldEvidence }), false);
  const { telegramEgressReceiptDigest: _telegramEgressReceiptDigest, ...evidenceWithoutTelegramEgress } = v3.evidence;
  assert.equal(validateState({ ...v3, evidence: evidenceWithoutTelegramEgress }), false);
  assert.equal(validateState({ ...v3, evidence: { ...v3.evidence, telegramEgressReceiptDigest: 'not-a-digest' } }), false);
  assert.equal(validateState({ ...v2, recovery: null }), false);
  assert.equal(validateState({ ...v2, phase: 'FAILED_RECOVERED' }), false);

  const v1Receipt = deployReceipt({ generation: 3 });
  const v2Receipt = deployReceipt({ generation: 4, schema: 'booking.deploy-receipt/v2', terminalPhase: 'FAILED_RECOVERED', recovery: RECOVERY });
  assert.equal(validateDeployReceiptSchema(v1Receipt), true, canonicalJson(validateDeployReceiptSchema.errors));
  assert.equal(validateDeployReceiptSchema(v2Receipt), true, canonicalJson(validateDeployReceiptSchema.errors));
  assert.equal(validateDeployReceiptSchema({ ...v1Receipt, schema: 'booking.deploy-receipt/v2' }), false);
  assert.equal(validateDeployReceiptSchema({ ...v2Receipt, schema: 'booking.deploy-receipt/v1' }), false);

  const externalBody = { schema: 'booking.external-action-receipt/v1', environment: 'preprod', project: 'booking-preprod',
    action: 'preprod-stage', actionId: 'action-1', operationId: 'op-1', approvalId: 'approval-1', generation: 1,
    fencingEpoch: 1, leaseId: 'lease-1', holderId: 'holder-1', manifestDigest: CANDIDATE.manifestDigest,
    releaseIdentity: CANDIDATE, resourceIds: ['booking-preprod-edge'], runtimeEnvDigest: D('e'), commandDigest: D('c'),
    requestDigest: D('d'), startedAt: '2026-09-10T10:00:00.000Z', completedAt: '2026-09-10T10:00:01.000Z', status: 'pass',
    executionOutputDigest: D('6'), readbackOutputDigest: D('7'), verification: {}, resources: [{ resourceId: 'booking-preprod-edge',
      highestAcceptedFencingEpoch: 1, previousReceiptDigest: null }], receiptDigest: D('8') };
  assert.equal(validateExternal(externalBody), true, canonicalJson(validateExternal.errors));
  assert.equal(validateExternal({ ...externalBody, schema: 'booking.external-action-receipt/v2' }), false);
  const recoveryExternal = { ...externalBody, schema: 'booking.external-action-receipt/v2', action: 'preprod-restore-active-runtime' };
  assert.equal(validateExternal(recoveryExternal), true, canonicalJson(validateExternal.errors));
  assert.equal(validateExternal({ ...recoveryExternal, schema: 'booking.external-action-receipt/v1' }), false);
  const ingressExternal = { ...externalBody, schema: 'booking.external-action-receipt/v3', action: 'preprod-switch-ingress',
    resourceIds: ['ingress:booking-preprod', 'booking-preprod-edge'], resources: [
      { resourceId: 'ingress:booking-preprod', highestAcceptedFencingEpoch: 1, previousReceiptDigest: null },
      { resourceId: 'booking-preprod-edge', highestAcceptedFencingEpoch: 1, previousReceiptDigest: null },
    ] };
  assert.equal(validateExternal(ingressExternal), true, canonicalJson(validateExternal.errors));
  assert.equal(validateExternal({ ...ingressExternal, resourceIds: ['ingress:booking-preprod'] }), false);
  assert.equal(validateExternal({ ...ingressExternal, schema: 'booking.external-action-receipt/v1' }), false);
  assert.deepEqual(schemaForAction('preprod-stage'), { request: 'booking.fenced-action-request/v4', receipt: 'booking.external-action-receipt/v4' });
  assert.deepEqual(schemaForAction('preprod-restore-active-runtime'), { request: 'booking.fenced-action-request/v2', receipt: 'booking.external-action-receipt/v2' });
  assert.deepEqual(schemaForAction('preprod-switch-ingress'), { request: 'booking.fenced-action-request/v3', receipt: 'booking.external-action-receipt/v3' });
  assert.deepEqual(schemaForAction('preprod-rollback-ingress'), { request: 'booking.fenced-action-request/v3', receipt: 'booking.external-action-receipt/v3' });
});

test('canonical deployment receipt chain validates reachable files and ignores crash orphans', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'booking-deploy-chain-valid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const statePath = join(root, 'deploy-state.json');
  const first = deployReceipt({ generation: 5 });
  const head = deployReceipt({ generation: 10, previousReceiptDigest: first.receiptDigest, activeIdentity: CANDIDATE });
  await writeReceipt(statePath, first);
  await writeReceipt(statePath, head);
  await writeFile(join(root, 'receipts', '000000000011.json'), '{crash-orphan');
  const state = { ...initialDeployState({ ...DEPLOYMENT, active: CANDIDATE }, '2026-09-10T10:00:00.000Z'),
    generation: 10, fencingEpoch: 2, receiptChainHead: head.receiptDigest };
  assert.equal((await verifyCanonicalDeployReceiptChain(statePath, state, { mode: 'acquire' })).length, 2);
});

test('canonical deployment receipt chain rejects missing, tampered, misnamed, cross-project, wrong-head identity, and non-decreasing links', async (t) => {
  async function fixture(name, build) {
    const root = await mkdtemp(join(tmpdir(), `booking-deploy-chain-${name}-`));
    t.after(() => rm(root, { recursive: true, force: true }));
    const statePath = join(root, 'deploy-state.json');
    const result = await build(statePath);
    await assert.rejects(verifyCanonicalDeployReceiptChain(statePath, result.state, { mode: 'acquire' }), result.pattern);
  }
  await fixture('missing', async () => ({ state: { ...initialDeployState(DEPLOYMENT, '2026-09-10T10:00:00.000Z'),
    generation: 2, fencingEpoch: 1, receiptChainHead: D('f') }, pattern: /chain directory is missing|canonical generation filename/ }));
  await fixture('tampered', async (statePath) => {
    const receipt = deployReceipt({ generation: 2 });
    await writeReceipt(statePath, { ...receipt, terminalStateDigest: D('8') });
    return { state: { ...initialDeployState(DEPLOYMENT, '2026-09-10T10:00:00.000Z'), generation: 2, fencingEpoch: 1,
      receiptChainHead: receipt.receiptDigest }, pattern: /integrity/ };
  });
  await fixture('misnamed', async (statePath) => {
    const receipt = deployReceipt({ generation: 2 });
    await writeReceipt(statePath, receipt, '000000000003.json');
    return { state: { ...initialDeployState(DEPLOYMENT, '2026-09-10T10:00:00.000Z'), generation: 2, fencingEpoch: 1,
      receiptChainHead: receipt.receiptDigest }, pattern: /canonical generation filename/ };
  });
  await fixture('cross-project', async (statePath) => {
    const receipt = deployReceipt({ generation: 2, environment: 'production' });
    await writeReceipt(statePath, receipt);
    return { state: { ...initialDeployState(DEPLOYMENT, '2026-09-10T10:00:00.000Z'), generation: 2, fencingEpoch: 1,
      receiptChainHead: receipt.receiptDigest }, pattern: /environment\/project mismatch/ };
  });
  await fixture('identity', async (statePath) => {
    const receipt = deployReceipt({ generation: 2, activeIdentity: CANDIDATE });
    await writeReceipt(statePath, receipt);
    return { state: { ...initialDeployState(DEPLOYMENT, '2026-09-10T10:00:00.000Z'), generation: 2, fencingEpoch: 1,
      receiptChainHead: receipt.receiptDigest }, pattern: /not bound to its terminal receipt head/ };
  });
  await fixture('generation', async (statePath) => {
    const prior = deployReceipt({ generation: 12 });
    const head = deployReceipt({ generation: 11, previousReceiptDigest: prior.receiptDigest });
    await writeReceipt(statePath, prior);
    await writeReceipt(statePath, head);
    return { state: { ...initialDeployState(DEPLOYMENT, '2026-09-10T10:00:00.000Z'), generation: 11, fencingEpoch: 1,
      receiptChainHead: head.receiptDigest }, pattern: /strictly decreasing/ };
  });
});

test('acquire rejects non-genesis IDLE without a head and terminal append verifies the prior chain before writing', async (t) => {
  const genesisPath = join(await mkdtemp(join(tmpdir(), 'booking-deploy-genesis-')), 'deploy-state.json');
  t.after(() => rm(dirname(genesisPath), { recursive: true, force: true }));
  const genesis = initialDeployState(DEPLOYMENT, '2026-09-10T10:00:00.000Z');
  assert.deepEqual(await verifyCanonicalDeployReceiptChain(genesisPath, genesis, { mode: 'acquire' }), []);
  await assert.rejects(verifyCanonicalDeployReceiptChain(genesisPath, { ...genesis, generation: 1 }, { mode: 'acquire' }), /non-genesis idle/);

  let terminal = acquireLease(genesis, leaseInput(genesis));
  terminal = { ...terminal, phase: 'COMMITTED', generation: 2, active: CANDIDATE, candidate: null, receiptChainHead: D('f') };
  validateDeployState(terminal);
  await initializeStateFile(genesisPath, terminal);
  await assert.rejects(mutateStateFile(genesisPath, (current) => transitionDeployState(current, {
    expectedGeneration: current.generation, expectedFencingEpoch: current.fencingEpoch, leaseId: current.lease.leaseId,
    holderId: current.lease.holderId, now: '2026-09-10T10:05:00.000Z', to: 'IDLE' })), /chain directory is missing|canonical generation filename/);
  const unchanged = JSON.parse(await readFile(genesisPath, 'utf8'));
  assert.equal(unchanged.phase, 'COMMITTED');
});

test('manual deploy receipt validator keeps v1 and v2 semantics disjoint', () => {
  const v1 = deployReceipt({ generation: 1 });
  const v2 = deployReceipt({ generation: 2, schema: 'booking.deploy-receipt/v2', terminalPhase: 'FAILED_RECOVERED', recovery: RECOVERY });
  assert.equal(validateDeployReceipt(v1), v1);
  assert.equal(validateDeployReceipt(v2), v2);
  assert.throws(() => validateDeployReceipt({ ...v1, schema: 'booking.deploy-receipt/v2' }), /recovery is required/);
  assert.throws(() => validateDeployReceipt({ ...v2, schema: 'booking.deploy-receipt/v1' }), /recovery is not allowed/);
  const legacyV1Body = { ...v1, evidence: legacyEvidenceWithoutTelegram() };
  delete legacyV1Body.receiptDigest;
  const legacyV1 = { ...legacyV1Body, receiptDigest: sha256(legacyV1Body) };
  assert.equal(validateDeployReceipt(legacyV1), legacyV1);
  const legacyV2Body = { ...v2, evidence: legacyEvidenceWithoutTelegram() };
  delete legacyV2Body.receiptDigest;
  assert.throws(() => validateDeployReceipt({ ...legacyV2Body, receiptDigest: sha256(legacyV2Body) }),
    /telegramEgressReceiptDigest is required/);
  const { rollbackPreSwitchProbeDigest: _removed, ...tooOld } = legacyV1.evidence;
  const tooOldBody = { ...legacyV1, evidence: tooOld };
  delete tooOldBody.receiptDigest;
  assert.throws(() => validateDeployReceipt({ ...tooOldBody, receiptDigest: sha256(tooOldBody) }),
    /telegramEgressReceiptDigest is required/);
});

test('executor immutable store rejects an action/receipt-version mismatch before publication', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'booking-executor-version-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const statePath = join(root, 'deploy-state.json');
  const receipt = { schema: 'booking.external-action-receipt/v1', action: 'preprod-restore-active-runtime',
    fencingEpoch: 1, actionId: 'restore-1' };
  await assert.rejects(writeExecutorReceipt(statePath, receipt), /schema does not match its action contract/);
});
