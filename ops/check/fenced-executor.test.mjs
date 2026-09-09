import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256 } from '../release/lib/contracts.mjs';
import { canonicalStatePath, initializeStateFile, mutateStateFile } from '../release/lib/deploy-state-store.mjs';
import { resourceDirectory } from '../release/lib/fenced-resource-store.mjs';
import { acquireLease, initialDeployState, takeoverExpiredLease, transitionDeployState } from '../release/lib/state-machine.mjs';
import { runFencedAction, singletonSourceIdentity, verifyBaselineReceipt, verifyLegacyDockerImageBinding } from '../release/execute-fenced-action.mjs';
import { LEGACY_OLD_BINDING } from '../release/lib/legacy-preprod.mjs';

const ACTIVE = { slot: 'green', releaseId: 'booking-20260907T120000Z-aaaaaaaa', gitSha: 'a'.repeat(40), manifestDigest: `sha256:${'a'.repeat(64)}` };
const BACKEND_IMAGE_ID = `sha256:${'c'.repeat(64)}`;
const GATEWAY_IMAGE_ID = `sha256:${'d'.repeat(64)}`;
const H5_CONTENT = 'fixture-h5';
const H5_DIGEST = sha256([{ path: 'index.html', digest: sha256(H5_CONTENT) }]);
const MANIFEST = {
  schema: 'booking.release/v1', releaseId: 'booking-20260909T120000Z-bbbbbbbb', source: { gitSha: 'b'.repeat(40), treeState: 'clean' },
  artifacts: {
    backend: { image: 'registry.test/booking/backend', digest: BACKEND_IMAGE_ID, sbomDigest: `sha256:${'1'.repeat(64)}`, provenanceDigest: `sha256:${'2'.repeat(64)}` },
    gateway: { image: 'registry.test/booking/gateway', digest: GATEWAY_IMAGE_ID, sbomDigest: `sha256:${'3'.repeat(64)}`, provenanceDigest: `sha256:${'4'.repeat(64)}`,
      frontendAssetDigest: H5_DIGEST, routeContractDigest: `sha256:${'5'.repeat(64)}` },
  },
  contracts: { configSchema: 'booking.config/v1', apiVersion: 'v1', frontendCompatibleApi: 'v1',
    migration: { expandFloor: '1788760000000-AddOrderCreatedConsumerIdempotency', catalogDigest: `sha256:${'6'.repeat(64)}`, compatibility: 'expand-contract' }, rollbackCompatibleRelease: ACTIVE.releaseId },
  runtime: { nodeMajor: 20, targetPlatform: 'linux/amd64' }, probes: { live: '/livez', ready: '/readyz', version: '/__ops/version' },
};
const CANDIDATE = { slot: 'blue', releaseId: MANIFEST.releaseId, gitSha: MANIFEST.source.gitSha, manifestDigest: sha256(MANIFEST) };
const DEPLOYMENT = { environment: 'preprod', project: 'booking-preprod', resources: {
  edgeNetwork: 'booking-preprod-edge', dataNetwork: 'booking-preprod-data', databaseRef: 'database:booking-preprod', ingressRef: 'ingress:booking-preprod',
}, active: ACTIVE };

function stagedState(expiresAt = '2026-09-09T16:00:00.000Z') {
  let state = initialDeployState(DEPLOYMENT, '2026-09-09T15:00:00.000Z');
  state = acquireLease(state, { expectedGeneration: 0, expectedFencingEpoch: 0, candidate: CANDIDATE, operationId: 'op-1', approvalId: 'approval-1',
    leaseId: 'lease-1', holderId: 'owner-1', now: '2026-09-09T15:01:00.000Z', expiresAt });
  state = transitionDeployState(state, { expectedGeneration: 1, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:02:00.000Z', to: 'MANIFEST_VERIFIED', manifestDigest: CANDIDATE.manifestDigest });
  return transitionDeployState(state, { expectedGeneration: 2, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:00.000Z', to: 'STAGED', manifestDigest: CANDIDATE.manifestDigest });
}

function switchedState() {
  let state = stagedState();
  state = transitionDeployState(state, { expectedGeneration: 3, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:10.000Z', to: 'CANDIDATE_STARTED' });
  state = transitionDeployState(state, { expectedGeneration: 4, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:20.000Z', to: 'CANDIDATE_READY', candidateProbeDigest: `sha256:${'9'.repeat(64)}` });
  state = transitionDeployState(state, { expectedGeneration: 5, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:30.000Z', to: 'SINGLETON_TRANSFERRED', rollbackPreSwitchProbeDigest: `sha256:${'a'.repeat(64)}`,
    singletonTransferReceiptDigest: `sha256:${'c'.repeat(64)}` });
  return transitionDeployState(state, { expectedGeneration: 6, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:40.000Z', to: 'SWITCHED', switchReceiptDigest: `sha256:${'b'.repeat(64)}` });
}

function candidateReadyState() {
  let state = stagedState();
  state = transitionDeployState(state, { expectedGeneration: 3, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:10.000Z', to: 'CANDIDATE_STARTED' });
  return transitionDeployState(state, { expectedGeneration: 4, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:20.000Z', to: 'CANDIDATE_READY', candidateProbeDigest: `sha256:${'9'.repeat(64)}` });
}

function rollbackPendingState() {
  let state = switchedState();
  state = transitionDeployState(state, { expectedGeneration: 7, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:50.000Z', to: 'OBSERVING' });
  return transitionDeployState(state, { expectedGeneration: 8, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:04:00.000Z', to: 'ROLLBACK_PENDING' });
}

function args(overrides = {}) {
  return { action: 'preprod-stage', execute: 'true', environment: 'preprod', project: 'booking-preprod', 'approval-id': 'approval-1',
    'expected-generation': '3', 'expected-fencing-epoch': '1', 'manifest-digest': CANDIDATE.manifestDigest,
    'operation-id': 'op-1', 'lease-id': 'lease-1', 'holder-id': 'owner-1', 'resource-id': 'booking-preprod-edge', 'action-id': 'stage-1', ...overrides };
}

function planBuilder() {
  return { executable: '/trusted/docker', argv: ['compose', 'up'], cwd: '/trusted/release',
    readback: { executable: '/trusted/docker', argv: ['compose', 'ps'], verify: () => ({ services: ['backend-blue', 'gateway-blue'] }) } };
}

function successRunner() {
  return Promise.resolve({ exitCode: 0, signal: null, overflow: false, stdout: '[]', stderr: '' });
}

function imageInspectOutput(component, imageId = component === 'backend' ? BACKEND_IMAGE_ID : GATEWAY_IMAGE_ID) {
  const artifact = MANIFEST.artifacts[component];
  const labels = { 'org.opencontainers.image.revision': CANDIDATE.gitSha, 'uk.happybooking.release-id': CANDIDATE.releaseId, 'uk.happybooking.component': component };
  return `${JSON.stringify(imageId)}|[]|${JSON.stringify([`${artifact.image}:${CANDIDATE.releaseId}`])}|${JSON.stringify(labels)}`;
}

async function fixture(expiresAt) {
  const root = await mkdtemp(join(tmpdir(), 'booking-fenced-executor-'));
  const statePath = await canonicalStatePath({ environment: 'preprod', project: 'booking-preprod', deployStateRoot: root });
  await initializeStateFile(statePath, stagedState(expiresAt));
  return { root, statePath };
}

async function fixtureFromState(state) {
  const root = await mkdtemp(join(tmpdir(), 'booking-fenced-executor-'));
  const statePath = await canonicalStatePath({ environment: 'preprod', project: 'booking-preprod', deployStateRoot: root });
  await initializeStateFile(statePath, state);
  return { root, statePath };
}

const at = (iso) => () => new Date(iso);

const MIGRATION_ENV = {
  BOOKING_MIGRATION_BACKUP_RECEIPT_DIGEST: `sha256:${'7'.repeat(64)}`,
  BOOKING_MIGRATION_BACKUP_RECEIPT_HOST_FILE: '/trusted/evidence/backup.json',
  BOOKING_MIGRATION_APPROVED_PENDING_JSON: JSON.stringify([
    'CreateTelegramWebhookInbox1788730000000',
    'AddOrderSourceIdempotencyKey1788740000000',
    'CreateOrderOutbox1788750000000',
    'AddOrderCreatedConsumerIdempotency1788760000000',
  ]),
};

function migrationReceipt(action = 'apply', ledgerHead = 'AddOrderCreatedConsumerIdempotency1788760000000') {
  const common = {
    environment: 'preproduction',
    database: 'booking_preprod',
    releaseId: CANDIDATE.releaseId,
    gitSha: CANDIDATE.gitSha,
    manifestDigest: CANDIDATE.manifestDigest,
    migrationCatalogDigest: MANIFEST.contracts.migration.catalogDigest,
    migrationFloor: MANIFEST.contracts.migration.expandFloor,
    backupReceiptDigest: MIGRATION_ENV.BOOKING_MIGRATION_BACKUP_RECEIPT_DIGEST,
  };
  return action === 'apply'
    ? { schema: 'booking.migration-apply-receipt/v1', ...common,
      approvedPending: JSON.parse(MIGRATION_ENV.BOOKING_MIGRATION_APPROVED_PENDING_JSON), completedAt: '2026-09-09T15:05:10.000Z' }
    : { schema: 'booking.migration-readback/v1', ...common, migrationCount: 15, ledgerHead,
      ledgerDigest: `sha256:${'8'.repeat(64)}`, verifiedAt: '2026-09-09T15:05:11.000Z' };
}

async function concreteReleaseRoot() {
  const releaseRoot = await mkdtemp(join(tmpdir(), 'booking-release-root-'));
  const composeDirectory = join(releaseRoot, CANDIDATE.releaseId, 'ops', 'compose');
  await mkdir(composeDirectory, { recursive: true });
  await writeFile(join(composeDirectory, 'compose.preprod.yml'), 'services:\n  schema-migrate: {}\n  schema-migration-readback: {}\n');
  return releaseRoot;
}

function migrationArgs(overrides = {}) {
  return args({ action: 'preprod-expand-migrate', 'resource-id': 'database:booking-preprod', 'action-id': 'migrate-1', ...overrides });
}

function concreteMigrationRunner(options = {}) {
  return async (_executable, argv) => {
    if (argv[0] === 'image' && argv[1] === 'inspect') {
      return { exitCode: 0, signal: null, overflow: false,
        stdout: imageInspectOutput('backend', options.wrongImage ? `sha256:${'e'.repeat(64)}` : BACKEND_IMAGE_ID), stderr: '' };
    }
    if (argv[0] === 'container' && argv[1] === 'inspect') {
      return { exitCode: 0, signal: null, overflow: false, stdout: BACKEND_IMAGE_ID, stderr: '' };
    }
    if (argv.includes('schema-migration-readback')) {
      return { exitCode: 0, signal: null, overflow: false,
        stdout: JSON.stringify(migrationReceipt('verify', options.ledgerHead)), stderr: '' };
    }
    if (argv.includes('schema-migrate')) {
      return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(migrationReceipt('apply')), stderr: '' };
    }
    return successRunner();
  };
}

const WEBHOOK_ENV = {
  ...MIGRATION_ENV,
  BOOKING_TELEGRAM_EXPECTED_BOT_ID: '123456',
  BOOKING_TELEGRAM_EXPECTED_BOT_USERNAME: 'booking_preprod_bot',
  BOOKING_TELEGRAM_WEBHOOK_URL: 'https://booking-preprod.happybooking.uk/telegram/webhook',
};

function webhookReceipt(action) {
  return {
    schemaVersion: 1,
    action,
    environment: 'preproduction',
    completedAt: '2026-09-09T15:05:12.000Z',
    bot: { id: 123456, username: 'booking_preprod_bot' },
    candidate: {
      releaseId: CANDIDATE.releaseId,
      gitSha: CANDIDATE.gitSha,
      manifestDigest: CANDIDATE.manifestDigest,
      configSchema: MANIFEST.contracts.configSchema,
      migrationFloor: MANIFEST.contracts.migration.expandFloor,
      migrationCatalogDigest: MANIFEST.contracts.migration.catalogDigest,
    },
    webhook: { url: WEBHOOK_ENV.BOOKING_TELEGRAM_WEBHOOK_URL, pendingUpdateCount: 0 },
    verification: { candidateReady: true, getMeIdentityMatched: true,
      ...(action === 'set' ? { setWebhookAccepted: true } : {}), readBackUrlMatched: true },
  };
}

const BASELINE_HISTORY = [{ timestamp: '1788720000000', name: 'HardenPaymentSettlementIdentity1788720000000' }];
const BASELINE_ENV = {
  BOOKING_BASELINE_OLD_RELEASE_ID: ACTIVE.releaseId,
  BOOKING_BASELINE_OLD_GIT_SHA: ACTIVE.gitSha,
  BOOKING_BASELINE_OLD_MANIFEST_DIGEST: ACTIVE.manifestDigest,
  BOOKING_BASELINE_OLD_CATALOG_DIGEST: `sha256:${'0'.repeat(64)}`,
  BOOKING_BASELINE_OLD_FLOOR: '1788720000000-HardenPaymentSettlementIdentity',
  BOOKING_BASELINE_APPROVED_HISTORY_JSON: JSON.stringify(BASELINE_HISTORY),
  BOOKING_BASELINE_SCHEMA_DIFF_RECEIPT_DIGEST: `sha256:${'1'.repeat(64)}`,
  BOOKING_BASELINE_SCHEMA_DIFF_RECEIPT_HOST_FILE: '/trusted/evidence/schema-diff.json',
  BOOKING_BASELINE_BACKUP_RECEIPT_DIGEST: `sha256:${'2'.repeat(64)}`,
  BOOKING_BASELINE_BACKUP_RECEIPT_HOST_FILE: '/trusted/evidence/backup.json',
};

function baselineReceipt(action) {
  return {
    schema: action === 'apply' ? 'booking.migration-baseline-receipt/v1' : 'booking.migration-baseline-readback/v1',
    environment: 'preproduction', database: 'booking_preprod', releaseId: ACTIVE.releaseId, gitSha: ACTIVE.gitSha,
    manifestDigest: ACTIVE.manifestDigest, migrationCatalogDigest: BASELINE_ENV.BOOKING_BASELINE_OLD_CATALOG_DIGEST,
    migrationFloor: BASELINE_ENV.BOOKING_BASELINE_OLD_FLOOR, historyCount: BASELINE_HISTORY.length,
    historyDigest: sha256(JSON.stringify(BASELINE_HISTORY)),
    schemaDiffReceiptDigest: BASELINE_ENV.BOOKING_BASELINE_SCHEMA_DIFF_RECEIPT_DIGEST,
    backupReceiptDigest: BASELINE_ENV.BOOKING_BASELINE_BACKUP_RECEIPT_DIGEST,
    ...(action === 'apply' ? { backupDigest: `sha256:${'3'.repeat(64)}` } : {}),
    verification: action === 'apply' ? { atomic: true, exactReadback: true } : { exactReadback: true },
    completedAt: '2026-09-09T15:05:13.000Z',
  };
}

test('fenced executor persists epochs before execution, verifies readback, and emits an immutable receipt', async () => {
  const { root, statePath } = await fixture();
  let calls = 0;
  try {
    const receipt = await runFencedAction(args(), { deployStateRoot: root, now: at('2026-09-09T15:05:00.000Z'), planBuilder, commandRunner: async (...input) => { calls += 1; return successRunner(...input); } });
    assert.equal(receipt.status, 'pass');
    assert.equal(receipt.schema, 'booking.external-action-receipt/v1');
    assert.equal(receipt.fencingEpoch, 1);
    assert.deepEqual(receipt.resourceIds, ['booking-preprod-edge']);
    const { receiptDigest, ...body } = receipt;
    assert.equal(receiptDigest, sha256(body));
    assert.equal(calls, 2);
    for (const resourceId of receipt.resourceIds) {
      const resource = JSON.parse(await readFile(join(resourceDirectory(statePath, resourceId), 'resource-state.json'), 'utf8'));
      assert.equal(resource.highestAcceptedFencingEpoch, 1);
      assert.equal(resource.pendingAction, null);
      assert.equal(resource.receiptChainHead, receiptDigest);
    }
    const replay = await runFencedAction(args(), { deployStateRoot: root, now: at('2026-09-09T15:06:00.000Z'), planBuilder, commandRunner: async () => { calls += 1; return successRunner(); } });
    assert.equal(replay.receiptDigest, receiptDigest);
    assert.equal(calls, 3, 'receipt replay must perform readback without executing the mutation twice');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preproduction ledger baseline is fenced to the canonical database resources', async () => {
  const { root } = await fixture();
  try {
    const receipt = await runFencedAction(args({
      action: 'preprod-baseline-ledger',
      'resource-id': 'database:booking-preprod',
      'action-id': 'baseline-1',
    }), {
      deployStateRoot: root,
      now: at('2026-09-09T15:05:00.000Z'),
      planBuilder: () => ({
        executable: '/trusted/docker',
        argv: ['compose', 'run', 'schema-baseline-ledger'],
        cwd: '/trusted/release',
        readbackFromExecution: true,
        verify: () => ({ exactReadback: true }),
      }),
      commandRunner: successRunner,
    });
    assert.equal(receipt.action, 'preprod-baseline-ledger');
    assert.deepEqual(receipt.resourceIds, [
      'database:booking-preprod',
      'booking-preprod-data',
    ]);
    assert.equal(receipt.verification.runtime.exactReadback, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('singleton transfer is CANDIDATE_READY-only, locks all shared singleton resources, and replay is readback-only', async () => {
  const { root } = await fixtureFromState(candidateReadyState());
  let mutations = 0;
  let readbacks = 0;
  const singletonPlan = () => ({ executable: '/trusted/singletons', argv: ['transfer'], cwd: '/trusted/release',
    readback: { executable: '/trusted/singletons', argv: ['readback'], verify: () => ({ exactlyOne: true }) } });
  const singletonArgs = args({ action: 'preprod-transfer-singletons', 'expected-generation': '5',
    'resource-id': 'booking-preprod-edge', 'action-id': 'singletons-1' });
  const runner = async (_executable, argv) => {
    if (argv[0] === 'transfer') mutations += 1;
    if (argv[0] === 'readback') readbacks += 1;
    return successRunner();
  };
  try {
    const receipt = await runFencedAction(singletonArgs, { deployStateRoot: root, now: at('2026-09-09T15:05:00.000Z'), planBuilder: singletonPlan, commandRunner: runner });
    assert.deepEqual(receipt.resourceIds, ['booking-preprod-edge', 'booking-preprod-data', 'database:booking-preprod', 'telegram:booking-preprod']);
    await runFencedAction(singletonArgs, { deployStateRoot: root, now: at('2026-09-09T15:06:00.000Z'), planBuilder: singletonPlan, commandRunner: runner });
    assert.equal(mutations, 1);
    assert.equal(readbacks, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rollback ingress and singleton actions bind immutable rollback identity in ROLLBACK_PENDING', async () => {
  const rollback = rollbackPendingState();
  const { root } = await fixtureFromState(rollback);
  const generic = () => ({ executable: '/trusted/action', argv: ['mutate'], cwd: '/trusted/release',
    readback: { executable: '/trusted/action', argv: ['readback'], verify: () => ({ restored: true }) } });
  try {
    for (const [action, resource, actionId] of [
      ['preprod-rollback-ingress', 'ingress:booking-preprod', 'rollback-ingress-1'],
      ['preprod-rollback-singletons', 'booking-preprod-edge', 'rollback-singletons-1'],
    ]) {
      const receipt = await runFencedAction(args({ action, 'expected-generation': '9', 'manifest-digest': ACTIVE.manifestDigest,
        'resource-id': resource, 'action-id': actionId }), { deployStateRoot: root, now: at('2026-09-09T15:05:00.000Z'), planBuilder: generic, commandRunner: successRunner });
      assert.deepEqual(receipt.releaseIdentity, ACTIVE);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('concrete rollback ingress rejects a non-legacy raw manifest identity', async () => {
  const legacyManifest = structuredClone(MANIFEST);
  legacyManifest.releaseId = ACTIVE.releaseId;
  legacyManifest.source.gitSha = ACTIVE.gitSha;
  const rawManifest = `${JSON.stringify(legacyManifest, null, 2)}\n`;
  const legacy = { ...ACTIVE, manifestDigest: sha256(rawManifest) };
  const state = rollbackPendingState();
  state.rollback = legacy;
  const { root } = await fixtureFromState(state);
  const releaseRoot = await mkdtemp(join(tmpdir(), 'booking-rollback-release-'));
  const directory = join(releaseRoot, legacy.releaseId);
  await mkdir(join(directory, 'ops', 'compose'), { recursive: true });
  await writeFile(join(directory, 'ops', 'compose', 'compose.preprod.yml'), 'services: {}\n');
  await writeFile(join(directory, 'release-manifest.json'), rawManifest);
  const invocations = [];
  const readback = { schema: 'booking.ingress-readback/v1', project: 'booking-preprod', hostname: 'booking-preprod.happybooking.uk',
    upstream: 'gateway-green:8080', releaseId: legacy.releaseId, manifestDigest: legacy.manifestDigest, operationId: 'op-1', fencingEpoch: 1,
    observedAt: '2026-09-09T15:05:01.000Z' };
  try {
    await assert.rejects(runFencedAction(args({ action: 'preprod-rollback-ingress', 'expected-generation': '9', 'manifest-digest': legacy.manifestDigest,
      'resource-id': 'ingress:booking-preprod', 'action-id': 'rollback-ingress-raw-1' }), {
      deployStateRoot: root, releaseRoot, dockerExecutable: '/trusted/docker', ingressExecutable: '/trusted/switch-preprod-ingress', now: at('2026-09-09T15:05:00.000Z'),
      commandRunner: async (_executable, argv) => { invocations.push(argv); return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(readback), stderr: '' }; },
    }), /canonical candidate identity/);
    assert.equal(invocations.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('singleton rollback sources transferred candidate before switch and active after switch', () => {
  let beforeSwitch = candidateReadyState();
  beforeSwitch = transitionDeployState(beforeSwitch, { expectedGeneration: 5, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:30.000Z', to: 'SINGLETON_TRANSFERRED', rollbackPreSwitchProbeDigest: `sha256:${'a'.repeat(64)}`,
    singletonTransferReceiptDigest: `sha256:${'c'.repeat(64)}` });
  beforeSwitch = transitionDeployState(beforeSwitch, { expectedGeneration: 6, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:40.000Z', to: 'ROLLBACK_PENDING' });
  assert.deepEqual(singletonSourceIdentity(beforeSwitch, true), CANDIDATE);
  assert.deepEqual(singletonSourceIdentity(rollbackPendingState(), true), CANDIDATE);
  assert.deepEqual(singletonSourceIdentity(candidateReadyState(), false), ACTIVE);
});

test('baseline receipt readback binds both evidence files and the backup object digest', () => {
  const value = {
    schema: 'booking.migration-baseline-receipt/v1',
    environment: 'preproduction',
    database: 'booking_preprod',
    migrationFloor: '1788720000000-HardenPaymentSettlementIdentity',
    historyCount: 12,
    historyDigest: `sha256:${'4'.repeat(64)}`,
    schemaDiffReceiptDigest: `sha256:${'1'.repeat(64)}`,
    backupReceiptDigest: `sha256:${'2'.repeat(64)}`,
    backupDigest: `sha256:${'3'.repeat(64)}`,
    verification: { atomic: true, exactReadback: true },
  };
  assert.deepEqual(verifyBaselineReceipt(JSON.stringify(value)), {
    database: value.database,
    historyCount: value.historyCount,
    migrationFloor: value.migrationFloor,
    schemaDiffReceiptDigest: value.schemaDiffReceiptDigest,
    backupReceiptDigest: value.backupReceiptDigest,
    historyDigest: value.historyDigest,
    backupDigest: value.backupDigest,
  });
  assert.throws(
    () => verifyBaselineReceipt(JSON.stringify({ ...value, backupDigest: undefined })),
    /incomplete/,
  );
});

test('legacy image exception is exact, label-free, and cannot widen to another rollback image', () => {
  const artifact = { image: LEGACY_OLD_BINDING.manifestRepository, digest: LEGACY_OLD_BINDING.imageId };
  const identity = { slot: 'green', releaseId: LEGACY_OLD_BINDING.releaseId, gitSha: LEGACY_OLD_BINDING.gitSha,
    manifestDigest: LEGACY_OLD_BINDING.manifestRawDigest };
  const inspected = { id: LEGACY_OLD_BINDING.imageId, repoDigests: [], repoTags: [LEGACY_OLD_BINDING.uniqueTag], labels: null };
  assert.equal(verifyLegacyDockerImageBinding('backend', artifact, identity, inspected).legacy, true);
  assert.throws(() => verifyLegacyDockerImageBinding('backend', artifact, identity, { ...inspected, labels: {} }), /one-time fixed/);
  assert.throws(() => verifyLegacyDockerImageBinding('backend', artifact, identity, { ...inspected, id: `sha256:${'f'.repeat(64)}` }), /one-time fixed/);
});

test('concrete Synology plan stages only the inactive blue slot and leaves routed green untouched', async () => {
  const { root } = await fixture();
  const releaseRoot = await mkdtemp(join(tmpdir(), 'booking-release-root-'));
  const composeDirectory = join(releaseRoot, CANDIDATE.releaseId, 'ops', 'compose');
  await mkdir(composeDirectory, { recursive: true });
  await writeFile(join(composeDirectory, 'compose.preprod.yml'), 'services:\n  backend-blue: {}\n  gateway-blue: {}\n');
  const invocations = [];
  try {
    const receipt = await runFencedAction(args(), { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, dockerExecutable: '/trusted/docker',
      now: at('2026-09-09T15:05:00.000Z'), commandRunner: async (executable, argv) => {
        invocations.push({ executable, argv });
        if (argv.includes('config')) return { exitCode: 0, signal: null, overflow: false, stdout: 'backend-blue\ngateway-blue\n', stderr: '' };
        if (argv[0] === 'image' && argv[1] === 'inspect') {
          const component = String(argv.at(-1)).includes('/backend:') ? 'backend' : 'gateway';
          return { exitCode: 0, signal: null, overflow: false, stdout: imageInspectOutput(component), stderr: '' };
        }
        if (argv.includes('ps') && argv.includes('-q')) {
          const component = String(argv.at(-1)).startsWith('backend-') ? 'backend' : 'gateway';
          return { exitCode: 0, signal: null, overflow: false, stdout: (component === 'backend' ? BACKEND_IMAGE_ID : GATEWAY_IMAGE_ID).slice(7), stderr: '' };
        }
        if (argv[0] === 'container' && argv[1] === 'inspect') {
          const component = argv.at(-1) === BACKEND_IMAGE_ID.slice(7) ? 'backend' : 'gateway';
          return { exitCode: 0, signal: null, overflow: false, stdout: component === 'backend' ? BACKEND_IMAGE_ID : GATEWAY_IMAGE_ID, stderr: '' };
        }
        if (argv[0] === 'cp') { await writeFile(join(argv.at(-1), 'index.html'), H5_CONTENT); return successRunner(); }
        if (String(argv[0]).includes('probe-fenced-candidate.mjs')) return { exitCode: 0, signal: null, overflow: false,
          stdout: JSON.stringify({ status: 'pass', releaseId: CANDIDATE.releaseId, gitSha: CANDIDATE.gitSha,
            manifestDigest: CANDIDATE.manifestDigest, slot: 'blue' }), stderr: '' };
        return successRunner();
      } });
    assert.equal(receipt.releaseIdentity.slot, 'blue');
    const mutation = invocations.find((item) => item.argv.includes('up'));
    assert.ok(mutation.argv.includes('backend-blue'));
    assert.ok(mutation.argv.includes('gateway-blue'));
    assert.equal(mutation.argv.includes('backend-green'), false);
    assert.equal(mutation.argv.includes('gateway-green'), false);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('candidate stage rejects a loopback port collision with the active slot before Docker runs', async () => {
  const { root } = await fixture();
  const releaseRoot = await mkdtemp(join(tmpdir(), 'booking-release-root-'));
  const composeDirectory = join(releaseRoot, CANDIDATE.releaseId, 'ops', 'compose');
  await mkdir(composeDirectory, { recursive: true });
  await writeFile(join(composeDirectory, 'compose.preprod.yml'), 'services:\n  backend-blue: {}\n  gateway-blue: {}\n');
  let calls = 0;
  try {
    await assert.rejects(runFencedAction(args(), { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, dockerExecutable: '/trusted/docker',
      env: { BOOKING_BLUE_PORT: '18081', BOOKING_GREEN_PORT: '18081' }, now: at('2026-09-09T15:05:00.000Z'),
      commandRunner: async () => { calls += 1; return successRunner(); } }), /ports must be valid and distinct/);
    assert.equal(calls, 0);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('concrete migration plan verifies apply receipt, independent exact ledger readback and actual container images', async () => {
  const { root } = await fixture();
  const releaseRoot = await concreteReleaseRoot();
  try {
    const receipt = await runFencedAction(migrationArgs(), {
      deployStateRoot: root,
      releaseRoot,
      releaseManifest: MANIFEST,
      dockerExecutable: '/trusted/docker',
      env: MIGRATION_ENV,
      now: at('2026-09-09T15:05:00.000Z'),
      commandRunner: concreteMigrationRunner(),
    });
    assert.deepEqual(receipt.verification.execution.approvedPending, JSON.parse(MIGRATION_ENV.BOOKING_MIGRATION_APPROVED_PENDING_JSON));
    assert.equal(receipt.verification.runtime.ledgerHead, 'AddOrderCreatedConsumerIdempotency1788760000000');
    assert.equal(receipt.verification.artifacts.backend.imageId, BACKEND_IMAGE_ID);
    assert.equal(receipt.verification.artifacts.containers.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('migration action rejects a forged backend image before touching the database', async () => {
  const { root } = await fixture();
  const releaseRoot = await concreteReleaseRoot();
  let migrationRan = false;
  const runner = concreteMigrationRunner({ wrongImage: true });
  try {
    await assert.rejects(runFencedAction(migrationArgs(), {
      deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
      now: at('2026-09-09T15:05:00.000Z'), commandRunner: async (executable, argv) => {
        if (argv.includes('schema-migrate')) migrationRan = true;
        return runner(executable, argv);
      },
    }), /local image ID does not match release manifest digest/);
    assert.equal(migrationRan, false);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('migration replay after receipt/pending crash performs independent ledger readback and clears every pending resource', async () => {
  const { root, statePath } = await fixture();
  const releaseRoot = await concreteReleaseRoot();
  let migrationExecutions = 0;
  const runner = concreteMigrationRunner();
  try {
    const receipt = await runFencedAction(migrationArgs(), {
      deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
      now: at('2026-09-09T15:05:00.000Z'), commandRunner: async (executable, argv) => {
        if (argv.includes('schema-migrate')) migrationExecutions += 1;
        return runner(executable, argv);
      },
    });
    for (const resourceId of receipt.resourceIds) {
      const path = join(resourceDirectory(statePath, resourceId), 'resource-state.json');
      const resource = JSON.parse(await readFile(path, 'utf8'));
      resource.pendingAction = { actionId: 'migrate-1', requestDigest: receipt.requestDigest };
      resource.receiptChainHead = null;
      await writeFile(path, `${JSON.stringify(resource)}\n`);
    }
    const recovered = await runFencedAction(migrationArgs(), {
      deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
      now: at('2026-09-09T15:06:00.000Z'), commandRunner: async (executable, argv) => {
        if (argv.includes('schema-migrate')) migrationExecutions += 1;
        return runner(executable, argv);
      },
    });
    assert.equal(recovered.schema, 'booking.external-action-recovery/v1');
    assert.equal(migrationExecutions, 1, 'crash recovery must not apply migrations a second time');
    assert.equal(recovered.verification.runtime.ledgerHead, 'AddOrderCreatedConsumerIdempotency1788760000000');
    for (const resourceId of receipt.resourceIds) {
      const resource = JSON.parse(await readFile(join(resourceDirectory(statePath, resourceId), 'resource-state.json'), 'utf8'));
      assert.equal(resource.pendingAction, null);
      assert.equal(resource.receiptChainHead, recovered.receiptDigest);
    }
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('migration replay fails closed on ledger drift or trusted environment drift', async () => {
  const { root } = await fixture();
  const releaseRoot = await concreteReleaseRoot();
  try {
    await runFencedAction(migrationArgs(), { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST,
      dockerExecutable: '/trusted/docker', env: MIGRATION_ENV, now: at('2026-09-09T15:05:00.000Z'), commandRunner: concreteMigrationRunner() });
    await assert.rejects(runFencedAction(migrationArgs(), { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST,
      dockerExecutable: '/trusted/docker', env: MIGRATION_ENV, now: at('2026-09-09T15:06:00.000Z'),
      commandRunner: concreteMigrationRunner({ ledgerHead: 'ForeignMigration9999999999999' }) }), /ledger binding is invalid/);
    await assert.rejects(runFencedAction(migrationArgs(), { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST,
      dockerExecutable: '/trusted/docker', env: { ...MIGRATION_ENV, BOOKING_MIGRATION_APPROVED_PENDING_JSON: '[]' },
      now: at('2026-09-09T15:06:00.000Z'), commandRunner: concreteMigrationRunner() }), /receipt does not match this request/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('canonical release identity environment variables cannot be overridden by a caller', async () => {
  const { root } = await fixture();
  const releaseRoot = await concreteReleaseRoot();
  let calls = 0;
  try {
    await assert.rejects(runFencedAction(migrationArgs(), { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST,
      dockerExecutable: '/trusted/docker', env: { ...MIGRATION_ENV, BOOKING_RELEASE_ID: ACTIVE.releaseId },
      now: at('2026-09-09T15:05:00.000Z'), commandRunner: async () => { calls += 1; return successRunner(); } }),
    /BOOKING_RELEASE_ID conflicts with canonical release identity/);
    assert.equal(calls, 0);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('webhook action proves the exact migration ledger and cannot implicitly run schema migration', async () => {
  const { root } = await fixtureFromState(switchedState());
  const releaseRoot = await concreteReleaseRoot();
  const invocations = [];
  try {
    const receipt = await runFencedAction(args({ action: 'preprod-set-webhook', 'expected-generation': '7',
      'resource-id': 'telegram:booking-preprod', 'action-id': 'webhook-1' }), {
      deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, dockerExecutable: '/trusted/docker', env: WEBHOOK_ENV,
      now: at('2026-09-09T15:05:00.000Z'), commandRunner: async (_executable, argv) => {
        invocations.push(argv);
        if (argv[0] === 'image' && argv[1] === 'inspect') {
          return { exitCode: 0, signal: null, overflow: false, stdout: imageInspectOutput('backend'), stderr: '' };
        }
        if (argv[0] === 'container' && argv[1] === 'inspect') {
          return { exitCode: 0, signal: null, overflow: false, stdout: BACKEND_IMAGE_ID, stderr: '' };
        }
        if (argv.includes('schema-migration-readback')) {
          return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(migrationReceipt('verify')), stderr: '' };
        }
        if (argv.includes('telegram-webhook-readback')) {
          return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(webhookReceipt('verify')), stderr: '' };
        }
        if (argv.includes('telegram-webhook-set')) {
          return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(webhookReceipt('set')), stderr: '' };
        }
        return successRunner();
      },
    });
    assert.equal(receipt.verification.runtime.webhookUrl, WEBHOOK_ENV.BOOKING_TELEGRAM_WEBHOOK_URL);
    assert.equal(receipt.verification.artifacts.containers.length, 3);
    assert.equal(invocations.some((argv) => argv.at(-1) === 'schema-migrate'), false);
    for (const argv of invocations.filter((item) => item.includes('telegram-webhook-set') || item.includes('telegram-webhook-readback'))) {
      assert.ok(argv.includes('--no-deps'));
    }
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('baseline receipt/pending crash replay independently verifies the exact ledger without recreating it', async () => {
  const { root, statePath } = await fixture();
  const releaseRoot = await concreteReleaseRoot();
  let applyCount = 0;
  let readbackCount = 0;
  const baselineArgs = args({ action: 'preprod-baseline-ledger', 'resource-id': 'database:booking-preprod', 'action-id': 'baseline-replay-1' });
  const runner = async (_executable, argv) => {
    if (argv[0] === 'image' && argv[1] === 'inspect') return { exitCode: 0, signal: null, overflow: false, stdout: imageInspectOutput('backend'), stderr: '' };
    if (argv[0] === 'container' && argv[1] === 'inspect') return { exitCode: 0, signal: null, overflow: false, stdout: BACKEND_IMAGE_ID, stderr: '' };
    if (argv.includes('schema-baseline-readback')) { readbackCount += 1; return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(baselineReceipt('verify')), stderr: '' }; }
    if (argv.includes('schema-baseline-ledger')) { applyCount += 1; return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(baselineReceipt('apply')), stderr: '' }; }
    return successRunner();
  };
  try {
    const receipt = await runFencedAction(baselineArgs, { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST,
      dockerExecutable: '/trusted/docker', env: BASELINE_ENV, now: at('2026-09-09T15:05:00.000Z'), commandRunner: runner });
    for (const resourceId of receipt.resourceIds) {
      const path = join(resourceDirectory(statePath, resourceId), 'resource-state.json');
      const resource = JSON.parse(await readFile(path, 'utf8'));
      resource.pendingAction = { actionId: 'baseline-replay-1', requestDigest: receipt.requestDigest };
      resource.receiptChainHead = null;
      await writeFile(path, `${JSON.stringify(resource)}\n`);
    }
    const recovered = await runFencedAction(baselineArgs, { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST,
      dockerExecutable: '/trusted/docker', env: BASELINE_ENV, now: at('2026-09-09T15:06:00.000Z'), commandRunner: runner });
    assert.equal(recovered.schema, 'booking.external-action-recovery/v1');
    assert.equal(applyCount, 1);
    assert.equal(readbackCount, 2);
    assert.equal(recovered.verification.runtime.historyDigest, sha256(JSON.stringify(BASELINE_HISTORY)));
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('webhook receipt replay repeats ledger and Telegram readbacks but never repeats setter mutation', async () => {
  const { root } = await fixtureFromState(switchedState());
  const releaseRoot = await concreteReleaseRoot();
  let setterCount = 0;
  let ledgerReadbackCount = 0;
  let webhookReadbackCount = 0;
  const webhookArgs = args({ action: 'preprod-set-webhook', 'expected-generation': '7',
    'resource-id': 'telegram:booking-preprod', 'action-id': 'webhook-replay-1' });
  const runner = async (_executable, argv) => {
    if (argv[0] === 'image' && argv[1] === 'inspect') return { exitCode: 0, signal: null, overflow: false, stdout: imageInspectOutput('backend'), stderr: '' };
    if (argv[0] === 'container' && argv[1] === 'inspect') return { exitCode: 0, signal: null, overflow: false, stdout: BACKEND_IMAGE_ID, stderr: '' };
    if (argv.includes('schema-migration-readback')) { ledgerReadbackCount += 1; return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(migrationReceipt('verify')), stderr: '' }; }
    if (argv.includes('telegram-webhook-readback')) { webhookReadbackCount += 1; return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(webhookReceipt('verify')), stderr: '' }; }
    if (argv.includes('telegram-webhook-set')) { setterCount += 1; return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(webhookReceipt('set')), stderr: '' }; }
    return successRunner();
  };
  try {
    const runtime = { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, dockerExecutable: '/trusted/docker', env: WEBHOOK_ENV,
      now: at('2026-09-09T15:05:00.000Z'), commandRunner: runner };
    const receipt = await runFencedAction(webhookArgs, runtime);
    const replay = await runFencedAction(webhookArgs, { ...runtime, now: at('2026-09-09T15:06:00.000Z') });
    assert.equal(replay.receiptDigest, receipt.receiptDigest);
    assert.equal(setterCount, 1);
    assert.equal(ledgerReadbackCount, 2);
    assert.equal(webhookReadbackCount, 2);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('a forged self-reported runtime identity cannot hide a wrong Docker image', async () => {
  const { root } = await fixture();
  const releaseRoot = await mkdtemp(join(tmpdir(), 'booking-release-root-'));
  const composeDirectory = join(releaseRoot, CANDIDATE.releaseId, 'ops', 'compose');
  await mkdir(composeDirectory, { recursive: true });
  await writeFile(join(composeDirectory, 'compose.preprod.yml'), 'services:\n  backend-blue: {}\n  gateway-blue: {}\n');
  let mutationRan = false;
  try {
    await assert.rejects(runFencedAction(args(), { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, dockerExecutable: '/trusted/docker',
      now: at('2026-09-09T15:05:00.000Z'), commandRunner: async (_executable, argv) => {
        if (argv.includes('config')) return { exitCode: 0, signal: null, overflow: false, stdout: 'backend-blue\ngateway-blue\n', stderr: '' };
        if (argv[0] === 'image' && argv[1] === 'inspect') {
          const component = String(argv.at(-1)).includes('/backend:') ? 'backend' : 'gateway';
          return { exitCode: 0, signal: null, overflow: false, stdout: imageInspectOutput(component, `sha256:${'e'.repeat(64)}`), stderr: '' };
        }
        if (argv.includes('up')) mutationRan = true;
        return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify({ status: 'pass', releaseId: CANDIDATE.releaseId,
          gitSha: CANDIDATE.gitSha, manifestDigest: CANDIDATE.manifestDigest, slot: CANDIDATE.slot }), stderr: '' };
      } }), /local image ID does not match release manifest digest/);
    assert.equal(mutationRan, false);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('a manifest-bound image is still rejected when its running gateway H5 directory differs', async () => {
  const { root } = await fixture();
  const releaseRoot = await mkdtemp(join(tmpdir(), 'booking-release-root-'));
  const composeDirectory = join(releaseRoot, CANDIDATE.releaseId, 'ops', 'compose');
  await mkdir(composeDirectory, { recursive: true });
  await writeFile(join(composeDirectory, 'compose.preprod.yml'), 'services:\n  backend-blue: {}\n  gateway-blue: {}\n');
  try {
    await assert.rejects(runFencedAction(args(), { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, dockerExecutable: '/trusted/docker',
      now: at('2026-09-09T15:05:00.000Z'), commandRunner: async (_executable, argv) => {
        if (argv.includes('config')) return { exitCode: 0, signal: null, overflow: false, stdout: 'backend-blue\ngateway-blue\n', stderr: '' };
        if (argv[0] === 'image' && argv[1] === 'inspect') {
          const component = String(argv.at(-1)).includes('/backend:') ? 'backend' : 'gateway';
          return { exitCode: 0, signal: null, overflow: false, stdout: imageInspectOutput(component), stderr: '' };
        }
        if (argv.includes('ps') && argv.includes('-q')) {
          const component = String(argv.at(-1)).startsWith('backend-') ? 'backend' : 'gateway';
          return { exitCode: 0, signal: null, overflow: false, stdout: (component === 'backend' ? BACKEND_IMAGE_ID : GATEWAY_IMAGE_ID).slice(7), stderr: '' };
        }
        if (argv[0] === 'container' && argv[1] === 'inspect') {
          return { exitCode: 0, signal: null, overflow: false, stdout: argv.at(-1) === BACKEND_IMAGE_ID.slice(7) ? BACKEND_IMAGE_ID : GATEWAY_IMAGE_ID, stderr: '' };
        }
        if (argv[0] === 'cp') { await writeFile(join(argv.at(-1), 'index.html'), 'tampered-h5'); return successRunner(); }
        if (String(argv[0]).includes('probe-fenced-candidate.mjs')) return { exitCode: 0, signal: null, overflow: false,
          stdout: JSON.stringify({ status: 'pass', releaseId: CANDIDATE.releaseId, gitSha: CANDIDATE.gitSha, manifestDigest: CANDIDATE.manifestDigest, slot: 'blue' }), stderr: '' };
        return successRunner();
      } }), /H5 digest does not match release manifest/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('receipt replay verifies the immutable receipt digest before trusting it', async () => {
  const { root, statePath } = await fixture();
  try {
    await runFencedAction(args(), { deployStateRoot: root, now: at('2026-09-09T15:05:00.000Z'), planBuilder, commandRunner: successRunner });
    const path = join(dirname(statePath), 'executor', 'receipts', '000000000001-preprod-stage-stage-1.json');
    const receipt = JSON.parse(await readFile(path, 'utf8'));
    receipt.verification = { tampered: true };
    await writeFile(path, `${JSON.stringify(receipt)}\n`);
    await assert.rejects(runFencedAction(args(), { deployStateRoot: root, now: at('2026-09-09T15:06:00.000Z'), planBuilder, commandRunner: successRunner }), /integrity check failed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a crash after pass receipt but before pending clear is recovered only after a fresh readback', async () => {
  const { root, statePath } = await fixture();
  let calls = 0;
  try {
    const receipt = await runFencedAction(args(), { deployStateRoot: root, now: at('2026-09-09T15:05:00.000Z'), planBuilder,
      commandRunner: async () => { calls += 1; return successRunner(); } });
    const path = join(resourceDirectory(statePath, 'booking-preprod-edge'), 'resource-state.json');
    const resource = JSON.parse(await readFile(path, 'utf8'));
    resource.pendingAction = { actionId: 'stage-1', requestDigest: receipt.requestDigest };
    resource.receiptChainHead = null;
    await writeFile(path, `${JSON.stringify(resource)}\n`);
    const recovered = await runFencedAction(args(), { deployStateRoot: root, now: at('2026-09-09T15:06:00.000Z'), planBuilder,
      commandRunner: async () => { calls += 1; return successRunner(); } });
    assert.equal(recovered.schema, 'booking.external-action-recovery/v1');
    assert.equal(calls, 3);
    const finalResource = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(finalResource.pendingAction, null);
    assert.equal(finalResource.receiptChainHead, recovered.receiptDigest);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('completed receipt replay rejects current external-state drift', async () => {
  const { root } = await fixture();
  let drifted = false;
  const driftAwarePlan = () => ({ executable: '/trusted/docker', argv: ['compose', 'up'], cwd: '/trusted/release',
    readback: { executable: '/trusted/docker', argv: ['compose', 'ps'], verify: (stdout) => {
      if (stdout !== 'healthy') throw new Error('external state drifted');
      return { current: true };
    } } });
  try {
    await runFencedAction(args(), { deployStateRoot: root, now: at('2026-09-09T15:05:00.000Z'), planBuilder: driftAwarePlan,
      commandRunner: async () => ({ exitCode: 0, signal: null, overflow: false, stdout: drifted ? 'drifted' : 'healthy', stderr: '' }) });
    drifted = true;
    await assert.rejects(runFencedAction(args(), { deployStateRoot: root, now: at('2026-09-09T15:06:00.000Z'), planBuilder: driftAwarePlan,
      commandRunner: async () => ({ exitCode: 0, signal: null, overflow: false, stdout: 'drifted', stderr: '' }) }), /external state drifted/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('concurrent executors cannot both cross the canonical deployment lock', async () => {
  const { root } = await fixture();
  let releaseFirst;
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const wait = new Promise((resolve) => { releaseFirst = resolve; });
  let call = 0;
  const runner = async () => {
    call += 1;
    if (call === 1) { entered(); await wait; }
    return successRunner();
  };
  try {
    const first = runFencedAction(args(), { deployStateRoot: root, now: at('2026-09-09T15:05:00.000Z'), planBuilder, commandRunner: runner });
    await enteredPromise;
    await assert.rejects(runFencedAction(args({ 'action-id': 'stage-2' }), { deployStateRoot: root, now: at('2026-09-09T15:05:00.000Z'), planBuilder, commandRunner: runner }), /state lock exists/);
    releaseFirst();
    await first;
  } finally { releaseFirst?.(); await rm(root, { recursive: true, force: true }); }
});

test('expired leases and incorrect resources fail before command execution', async () => {
  const expired = await fixture('2026-09-09T15:04:00.000Z');
  let calls = 0;
  try {
    await assert.rejects(runFencedAction(args(), { deployStateRoot: expired.root, now: at('2026-09-09T15:05:00.000Z'), planBuilder, commandRunner: async () => { calls += 1; return successRunner(); } }), /lease has expired/);
    assert.equal(calls, 0);
  } finally { await rm(expired.root, { recursive: true, force: true }); }

  const wrong = await fixture();
  try {
    await assert.rejects(runFencedAction(args({ 'resource-id': 'booking-prod-edge' }), { deployStateRoot: wrong.root, now: at('2026-09-09T15:05:00.000Z'), planBuilder, commandRunner: async () => { calls += 1; return successRunner(); } }), /canonical action resource/);
    assert.equal(calls, 0);
  } finally { await rm(wrong.root, { recursive: true, force: true }); }
});

test('production actions remain unavailable and fail before any command execution', async () => {
  let calls = 0;
  await assert.rejects(runFencedAction(args({ action: 'production-stage', environment: 'production', project: 'booking-prod' }), {
    now: at('2026-09-09T15:05:00.000Z'), planBuilder, commandRunner: async () => { calls += 1; return successRunner(); },
  }), /unsupported fenced action/);
  assert.equal(calls, 0);
});

test('takeover raises the resource epoch and fences the old operator', async () => {
  const { root, statePath } = await fixture('2026-09-09T15:10:00.000Z');
  let calls = 0;
  try {
    await runFencedAction(args(), { deployStateRoot: root, now: at('2026-09-09T15:05:00.000Z'), planBuilder, commandRunner: async () => { calls += 1; return successRunner(); } });
    await mutateStateFile(statePath, (state) => takeoverExpiredLease(state, { expectedGeneration: 3, expectedFencingEpoch: 1, approvalId: 'approval-2',
      leaseId: 'lease-2', holderId: 'owner-2', now: '2026-09-09T15:11:00.000Z', expiresAt: '2026-09-09T16:11:00.000Z' }));
    await assert.rejects(runFencedAction(args({ 'action-id': 'old-after-takeover' }), { deployStateRoot: root, now: at('2026-09-09T15:12:00.000Z'), planBuilder, commandRunner: async () => { calls += 1; return successRunner(); } }), /generation mismatch/);
    assert.equal(calls, 2);
    const receipt = await runFencedAction(args({ 'approval-id': 'approval-2', 'expected-generation': '4', 'expected-fencing-epoch': '2',
      'lease-id': 'lease-2', 'holder-id': 'owner-2', 'action-id': 'new-owner-stage' }), { deployStateRoot: root, now: at('2026-09-09T15:12:00.000Z'), planBuilder, commandRunner: async () => { calls += 1; return successRunner(); } });
    assert.equal(receipt.fencingEpoch, 2);
    const resource = JSON.parse(await readFile(join(resourceDirectory(statePath, 'booking-preprod-edge'), 'resource-state.json'), 'utf8'));
    assert.equal(resource.highestAcceptedFencingEpoch, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed or interrupted actions leave a durable receipt and unresolved pending fence', async () => {
  const { root, statePath } = await fixture();
  try {
    await assert.rejects(runFencedAction(args(), { deployStateRoot: root, now: at('2026-09-09T15:05:00.000Z'), planBuilder,
      commandRunner: async () => ({ exitCode: 1, signal: null, overflow: false, stdout: '', stderr: 'redacted failure' }) }), /external action failed/);
    const failed = JSON.parse(await readFile(join(dirname(statePath), 'executor', 'receipts', '000000000001-preprod-stage-stage-1.json'), 'utf8'));
    assert.equal(failed.status, 'fail');
    const resource = JSON.parse(await readFile(join(resourceDirectory(statePath, 'booking-preprod-edge'), 'resource-state.json'), 'utf8'));
    assert.equal(resource.pendingAction.actionId, 'stage-1');
    await assert.rejects(runFencedAction(args({ 'action-id': 'stage-after-failure' }), { deployStateRoot: root, now: at('2026-09-09T15:06:00.000Z'), planBuilder, commandRunner: successRunner }), /unresolved pending action/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('any residual resource lock fails closed, regardless of apparent age', async () => {
  const { root, statePath } = await fixture();
  const lockPath = join(resourceDirectory(statePath, 'booking-preprod-edge'), 'resource-state.lock');
  try {
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, JSON.stringify({ pid: 2147483647, acquiredAt: '2000-01-01T00:00:00.000Z' }));
    await assert.rejects(runFencedAction(args(), { deployStateRoot: root, now: at('2026-09-09T15:05:00.000Z'), planBuilder, commandRunner: successRunner }), /explicit forensic recovery/);
    assert.match(await readFile(lockPath, 'utf8'), /2147483647/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
