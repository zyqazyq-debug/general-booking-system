import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256 } from '../release/lib/contracts.mjs';
import { canonicalStatePath, initializeStateFile, mutateStateFile } from '../release/lib/deploy-state-store.mjs';
import { resourceDirectory } from '../release/lib/fenced-resource-store.mjs';
import { acquireLease, initialDeployState, takeoverExpiredLease, transitionDeployState } from '../release/lib/state-machine.mjs';
import { runFencedAction, singletonSourceIdentity, verifyBaselineReceipt, verifyDockerImageBinding, verifyLegacyDockerImageBinding } from '../release/execute-fenced-action.mjs';
import { runManageDeployState } from '../release/manage-deploy-state.mjs';
import { LEGACY_OLD_BINDING } from '../release/lib/legacy-preprod.mjs';
import { runIngressHelper } from '../release/switch-preprod-ingress.mjs';

const ACTIVE = { slot: 'green', releaseId: 'booking-20260907T120000Z-aaaaaaaa', gitSha: 'a'.repeat(40), manifestDigest: `sha256:${'a'.repeat(64)}` };
const BACKEND_IMAGE_ID = `sha256:${'c'.repeat(64)}`;
const GATEWAY_IMAGE_ID = `sha256:${'d'.repeat(64)}`;
const H5_CONTENT = 'fixture-h5';
const RUNTIME_ENV_CONTENT = 'FIXTURE_ONLY=true\n';
const H5_DIGEST = sha256([{ path: 'index.html', digest: sha256(H5_CONTENT) }]);
const ROUTE_CONTENT = 'server { listen 8080; location / { try_files $uri /index.html; } }\n';
const TELEGRAM_BOT_USERNAME = 'happybooking_preprod_bot';
const TELEGRAM_BOT_DISPLAY_NAME = 'HappyBooking Preprod';
const COMPOSE_CONTENT = 'services:\n  backend-blue: {}\n  gateway-blue: {}\n  schema-migrate: {}\n  schema-migration-readback: {}\n  schema-baseline-ledger: {}\n  schema-baseline-readback: {}\n  telegram-webhook-set: {}\n  telegram-webhook-readback: {}\n';
const EGRESS_COMPOSE_CONTENT = 'services:\n  telegram-egress: {}\n';
const MANIFEST = {
  schema: 'booking.release/v2', releaseId: 'booking-20260909T120000Z-bbbbbbbb', source: { gitSha: 'b'.repeat(40), treeState: 'clean' },
  artifacts: {
    backend: { image: 'registry.test/booking/backend', digest: BACKEND_IMAGE_ID, sbomDigest: `sha256:${'1'.repeat(64)}`, provenanceDigest: `sha256:${'2'.repeat(64)}` },
    gateway: { image: 'registry.test/booking/gateway', digest: GATEWAY_IMAGE_ID, sbomDigest: `sha256:${'3'.repeat(64)}`, provenanceDigest: `sha256:${'4'.repeat(64)}`,
      frontendAssetDigest: H5_DIGEST, routeContractDigest: sha256(ROUTE_CONTENT),
      telegramBotUsername: TELEGRAM_BOT_USERNAME, telegramBotDisplayName: TELEGRAM_BOT_DISPLAY_NAME },
    telegramEgress: { image: 'registry.test/booking/telegram-egress', digest: `sha256:${'e'.repeat(64)}`,
      sbomDigest: `sha256:${'a'.repeat(64)}`, provenanceDigest: `sha256:${'b'.repeat(64)}`, buildInputDigest: `sha256:${'f'.repeat(64)}`,
      baseImage: 'debian:bookworm-20260824-slim', baseImageDigest: `sha256:${'c'.repeat(64)}`,
      aptSources: { debianMirror: 'https://deb.debian.org/debian', securityMirror: 'https://deb.debian.org/debian-security' },
      warpPackage: { version: '2026.7.1377.0', sha256: 'd'.repeat(64) } },
    deployment: { composeDigest: sha256([sha256(COMPOSE_CONTENT), sha256(EGRESS_COMPOSE_CONTENT)]) },
  },
  contracts: { configSchema: 'booking.config/v1', apiVersion: 'v1', frontendCompatibleApi: 'v1',
    migration: { expandFloor: '1788760000000-AddOrderCreatedConsumerIdempotency', catalogDigest: `sha256:${'6'.repeat(64)}`, compatibility: 'expand-contract' }, rollbackCompatibleRelease: ACTIVE.releaseId },
  runtime: { nodeMajor: 20, targetPlatform: 'linux/amd64' }, probes: { live: '/livez', ready: '/readyz', version: '/__ops/version' },
};
const CANDIDATE = { slot: 'blue', releaseId: MANIFEST.releaseId, gitSha: MANIFEST.source.gitSha, manifestDigest: sha256(MANIFEST) };
const DEPLOYMENT = { environment: 'preprod', project: 'booking-preprod', resources: {
  edgeNetwork: 'booking-preprod-edge', dataNetwork: 'booking-preprod-data', databaseRef: 'database:booking-preprod', ingressRef: 'ingress:booking-preprod',
}, active: ACTIVE, runtimeEnvDigest: sha256(RUNTIME_ENV_CONTENT) };

function preMigrationState(expiresAt = '2026-09-09T16:00:00.000Z') {
  let state = initialDeployState(DEPLOYMENT, '2026-09-09T15:00:00.000Z');
  state = acquireLease(state, { expectedGeneration: 0, expectedFencingEpoch: 0, candidate: CANDIDATE, operationId: 'op-1', approvalId: 'approval-1',
    leaseId: 'lease-1', holderId: 'owner-1', now: '2026-09-09T15:01:00.000Z', expiresAt });
  state = transitionDeployState(state, { expectedGeneration: 1, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:02:00.000Z', to: 'MANIFEST_VERIFIED', manifestDigest: CANDIDATE.manifestDigest });
  return transitionDeployState(state, { expectedGeneration: 2, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:00.000Z', to: 'STAGED', manifestDigest: CANDIDATE.manifestDigest });
}

function stagedState(expiresAt = '2026-09-09T16:00:00.000Z') {
  return transitionDeployState(preMigrationState(expiresAt), { expectedGeneration: 3, expectedFencingEpoch: 1,
    leaseId: 'lease-1', holderId: 'owner-1', now: '2026-09-09T15:03:05.000Z', to: 'EXPAND_MIGRATED',
    expandMigrationReceiptDigest: `sha256:${'7'.repeat(64)}` });
}

function switchedState() {
  let state = stagedState();
  state = transitionDeployState(state, { expectedGeneration: 4, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:10.000Z', to: 'CANDIDATE_STARTED', stageReceiptDigest: `sha256:${'8'.repeat(64)}` });
  state = transitionDeployState(state, { expectedGeneration: 5, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:20.000Z', to: 'CANDIDATE_READY', candidateProbeDigest: `sha256:${'9'.repeat(64)}` });
  state = transitionDeployState(state, { expectedGeneration: 6, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:30.000Z', to: 'SINGLETON_TRANSFERRED', rollbackPreSwitchProbeDigest: `sha256:${'a'.repeat(64)}`,
    singletonTransferReceiptDigest: `sha256:${'c'.repeat(64)}` });
  return transitionDeployState(state, { expectedGeneration: 7, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:40.000Z', to: 'SWITCHED', switchReceiptDigest: `sha256:${'b'.repeat(64)}` });
}

function candidateReadyState() {
  let state = stagedState();
  state = transitionDeployState(state, { expectedGeneration: 4, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:10.000Z', to: 'CANDIDATE_STARTED', stageReceiptDigest: `sha256:${'8'.repeat(64)}` });
  return transitionDeployState(state, { expectedGeneration: 5, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:20.000Z', to: 'CANDIDATE_READY', candidateProbeDigest: `sha256:${'9'.repeat(64)}` });
}

function singletonTransferredState() {
  return transitionDeployState(candidateReadyState(), { expectedGeneration: 6, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:30.000Z', to: 'SINGLETON_TRANSFERRED', rollbackPreSwitchProbeDigest: `sha256:${'a'.repeat(64)}`,
    singletonTransferReceiptDigest: `sha256:${'c'.repeat(64)}` });
}

function rollbackPendingState() {
  let state = switchedState();
  state = transitionDeployState(state, { expectedGeneration: 8, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:50.000Z', to: 'OBSERVING', webhookReceiptDigest: `sha256:${'d'.repeat(64)}` });
  return transitionDeployState(state, { expectedGeneration: 9, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:04:00.000Z', to: 'ROLLBACK_PENDING' });
}

function args(overrides = {}) {
  return { action: 'preprod-stage', execute: 'true', environment: 'preprod', project: 'booking-preprod', 'approval-id': 'approval-1',
    'expected-generation': '4', 'expected-fencing-epoch': '1', 'manifest-digest': CANDIDATE.manifestDigest,
    'operation-id': 'op-1', 'lease-id': 'lease-1', 'holder-id': 'owner-1', 'resource-id': 'booking-preprod-edge', 'action-id': 'stage-1', ...overrides };
}

function planBuilder() {
  return { executable: '/trusted/docker', argv: ['compose', 'up'], cwd: '/trusted/release',
    readback: { executable: '/trusted/docker', argv: ['compose', 'ps'], verify: () => ({ services: ['backend-blue', 'gateway-blue'] }) } };
}

function successRunner() {
  return Promise.resolve({ exitCode: 0, signal: null, overflow: false, stdout: '[]', stderr: '' });
}

function dataPlaneInspect(container, sourceOverride, labelOverride) {
  const postgres = container.includes('postgres');
  const source = sourceOverride || `/volume1/homes/realzyq/booking-preprod-data/${postgres ? 'postgres' : 'redis'}`;
  const destination = postgres ? '/var/lib/postgresql/data' : '/data';
  const labels = labelOverride || { 'com.docker.compose.project': 'booking-preprod', 'com.docker.compose.service': postgres ? 'postgres' : 'redis' };
  return `${JSON.stringify([{ Type: 'bind', Source: source, Destination: destination, RW: true }])}|${JSON.stringify({ 'booking-preprod-data': {} })}|${JSON.stringify(labels)}|${JSON.stringify('running')}\n`;
}

function imageInspectOutput(component, imageId = component === 'backend' ? BACKEND_IMAGE_ID : GATEWAY_IMAGE_ID) {
  const artifact = MANIFEST.artifacts[component];
  const labels = { 'org.opencontainers.image.revision': CANDIDATE.gitSha, 'uk.happybooking.release-id': CANDIDATE.releaseId, 'uk.happybooking.component': component };
  if (component === 'gateway') {
    labels['uk.happybooking.telegram-bot-username'] = TELEGRAM_BOT_USERNAME;
    labels['uk.happybooking.telegram-bot-display-name'] = TELEGRAM_BOT_DISPLAY_NAME;
  }
  return `${JSON.stringify(imageId)}|[]|${JSON.stringify([`${artifact.image}:${CANDIDATE.releaseId}`])}|${JSON.stringify(labels)}`;
}

function candidateRuntimeInspect(component, releaseRoot, overrides = {}) {
  const backend = component === 'backend';
  const labels = { 'com.docker.compose.project': 'booking-preprod', 'com.docker.compose.service': `${component}-blue` };
  const env = backend ? [
    'NODE_ENV=production', 'TYPEORM_SYNCHRONIZE=false', 'POSTGRES_HOST=postgres', 'POSTGRES_DB=booking_preprod', 'REDIS_HOST=redis',
    `BOOKING_RELEASE_ID=${CANDIDATE.releaseId}`, `BOOKING_GIT_SHA=${CANDIDATE.gitSha}`, `BOOKING_MANIFEST_DIGEST=${CANDIDATE.manifestDigest}`,
    'BOOKING_SLOT=blue', 'BOOKING_RUNTIME_ROLE=standby', 'BOOKING_WORKERS_ENABLED=false', 'ORDER_OUTBOX_DISPATCH_ENABLED=false',
    'TELEGRAM_ENABLE_WEBHOOK=true', 'TELEGRAM_POLLING_DELETE_WEBHOOK_ON_STARTUP=false',
    'BOOKING_TELEGRAM_EGRESS_REQUIRED=true', 'TELEGRAM_PROXY_URL=socks5h://telegram-egress:1080',
  ] : ['BOOKING_BACKEND_UPSTREAM=backend-blue:3001', 'NGINX_ENVSUBST_TEMPLATE_DIR=/tmp/empty-nginx-templates'];
  const secretRoot = '/volume1/homes/realzyq/booking-preprod/.g4/secrets';
  const mounts = backend ? [
    { Type: 'tmpfs', Source: '', Destination: '/tmp', RW: true }, { Type: 'tmpfs', Source: '', Destination: '/app/logs', RW: true },
    { Type: 'bind', Source: `${secretRoot}/telegram-data-encryption-secret`, Destination: '/run/secrets/telegram_data_encryption_secret', RW: false },
    { Type: 'bind', Source: `${secretRoot}/telegram-webhook-secret`, Destination: '/run/secrets/telegram_webhook_secret', RW: false },
  ] : [
    { Type: 'tmpfs', Source: '', Destination: '/var/cache/nginx', RW: true }, { Type: 'tmpfs', Source: '', Destination: '/var/run', RW: true },
    { Type: 'tmpfs', Source: '', Destination: '/tmp', RW: true },
    { Type: 'bind', Source: join(releaseRoot, CANDIDATE.releaseId, 'frontend', 'nginx.preprod.conf'), Destination: '/etc/nginx/conf.d/default.conf', RW: false },
  ];
  const values = [labels, env, mounts, backend ? { 'booking-preprod-edge': {}, 'booking-preprod-data': {}, 'booking-preprod-telegram': {} } : { 'booking-preprod-edge': {} },
    true, ['ALL'], backend ? [] : ['NET_BIND_SERVICE'], ['no-new-privileges:true'],
    backend ? {} : { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '18083' }] }, backend ? 'node' : '101', false, '', '', []];
  for (const [index, value] of Object.entries(overrides)) values[Number(index)] = value;
  return values.map((value) => JSON.stringify(value)).join('\n');
}

function parseImageInspectFixture(component) {
  const [id, repoDigests, repoTags, labels] = imageInspectOutput(component).split('|').map((value) => JSON.parse(value));
  return { id, repoDigests, repoTags, labels };
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
  BOOKING_GREEN_PORT: '18082',
  BOOKING_BLUE_PORT: '18083',
  BOOKING_MIGRATION_BACKUP_RECEIPT_DIGEST: `sha256:${'7'.repeat(64)}`,
  BOOKING_MIGRATION_BACKUP_RECEIPT_HOST_FILE: '/trusted/evidence/backup.json',
  BOOKING_MIGRATION_APPROVED_PENDING_JSON: JSON.stringify([
    'CreateTelegramWebhookInbox1788730000000',
    'AddOrderSourceIdempotencyKey1788740000000',
    'CreateOrderOutbox1788750000000',
    'AddOrderCreatedConsumerIdempotency1788760000000',
  ]),
};
const backupArtifactVerifier = async () => ({ receiptDigest: MIGRATION_ENV.BOOKING_MIGRATION_BACKUP_RECEIPT_DIGEST,
  backupDigest: `sha256:${'0'.repeat(64)}`, backupSize: 128, backupPath: '/trusted/evidence/pre-migration.dump',
  pgRestoreListDigest: `sha256:${'f'.repeat(64)}` });

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

async function concreteReleaseRoot(baseDirectory = tmpdir()) {
  const releaseRoot = await mkdtemp(join(baseDirectory, 'booking-release-root-'));
  await writeFile(join(releaseRoot, '.runtime.env'), RUNTIME_ENV_CONTENT, { mode: 0o600 });
  const composeDirectory = join(releaseRoot, CANDIDATE.releaseId, 'ops', 'compose');
  await mkdir(composeDirectory, { recursive: true });
  await writeFile(join(composeDirectory, 'compose.preprod.yml'), COMPOSE_CONTENT);
  await writeFile(join(composeDirectory, 'compose.preprod-telegram-egress.yml'), EGRESS_COMPOSE_CONTENT);
  await mkdir(join(releaseRoot, CANDIDATE.releaseId, 'frontend'));
  await writeFile(join(releaseRoot, CANDIDATE.releaseId, 'frontend', 'nginx.preprod.conf'), ROUTE_CONTENT, { mode: 0o444 });
  return releaseRoot;
}

function migrationArgs(overrides = {}) {
  return args({ action: 'preprod-expand-migrate', 'expected-generation': '3', 'resource-id': 'database:booking-preprod', 'action-id': 'migrate-1', ...overrides });
}

function concreteMigrationRunner(options = {}) {
  return async (_executable, argv) => {
    if (argv[0] === 'image' && argv[1] === 'inspect') {
      return { exitCode: 0, signal: null, overflow: false,
        stdout: imageInspectOutput('backend', options.wrongImage ? `sha256:${'e'.repeat(64)}` : BACKEND_IMAGE_ID), stderr: '' };
    }
    if (argv[0] === 'container' && argv[1] === 'inspect' && String(argv[3]).includes('.Mounts')) {
      return { exitCode: 0, signal: null, overflow: false, stdout: dataPlaneInspect(String(argv.at(-1)), options.dataRoot, options.labels), stderr: '' };
    }
    if (argv[0] === 'exec' && argv.includes('psql')) {
      return { exitCode: 0, signal: null, overflow: false, stdout: 'booking_preprod|booking_preprod\n', stderr: '' };
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

function concreteStageRunner(releaseRoot, runtimeOverrides = {}) {
  return async (_executable, argv) => {
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
      return { exitCode: 0, signal: null, overflow: false,
        stdout: String(argv[3]).includes('.HostConfig') ? candidateRuntimeInspect(component, releaseRoot, runtimeOverrides[component]) :
          (component === 'backend' ? BACKEND_IMAGE_ID : GATEWAY_IMAGE_ID), stderr: '' };
    }
    if (argv[0] === 'cp') { await writeFile(join(argv.at(-1), 'index.html'), H5_CONTENT); return successRunner(); }
    if (String(argv[0]).includes('probe-fenced-candidate.mjs')) return { exitCode: 0, signal: null, overflow: false,
      stdout: JSON.stringify({ status: 'pass', releaseId: CANDIDATE.releaseId, gitSha: CANDIDATE.gitSha,
        manifestDigest: CANDIDATE.manifestDigest, slot: 'blue' }), stderr: '' };
    return successRunner();
  };
}

const WEBHOOK_ENV = {
  ...MIGRATION_ENV,
  BOOKING_TELEGRAM_EXPECTED_BOT_ID: '123456',
  BOOKING_TELEGRAM_EXPECTED_BOT_USERNAME: TELEGRAM_BOT_USERNAME,
  BOOKING_TELEGRAM_WEBHOOK_URL: 'https://booking-preprod.happybooking.uk/telegram/webhook',
};

function webhookReceipt(action) {
  return {
    schemaVersion: 1,
    action,
    environment: 'preproduction',
    completedAt: '2026-09-09T15:05:12.000Z',
    bot: { id: 123456, username: TELEGRAM_BOT_USERNAME },
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

test('registry runtime gate is repeated around mutation and its operation/fence binding cannot be replayed', async () => {
  const { root } = await fixture();
  const binding = { schema: 'booking.registry-runtime-gate/v1', operationId: 'op-1', fencingEpoch: 1,
    releaseId: CANDIDATE.releaseId, manifestDigest: CANDIDATE.manifestDigest };
  let gateCalls = 0;
  let commandCalls = 0;
  const guardedPlan = (override = binding) => ({ ...planBuilder(), registrySupplyChainBinding: override,
    registrySupplyChainGate: async () => { gateCalls += 1; return override; } });
  try {
    await runFencedAction(args({ 'action-id': 'stage-registry-runtime-gate' }), { deployStateRoot: root,
      now: at('2026-09-09T15:05:00.000Z'), planBuilder: async () => guardedPlan(),
      commandRunner: async () => { commandCalls += 1; return successRunner(); } });
    assert.equal(gateCalls, 5, 'gate must run after locking, before fencing/execution/readback, and after readback');
    assert.equal(commandCalls, 2);
    await assert.rejects(runFencedAction(args({ 'action-id': 'stage-registry-runtime-gate' }), { deployStateRoot: root,
      now: at('2026-09-09T15:05:01.000Z'), planBuilder: async () => guardedPlan({ ...binding, operationId: 'op-old', fencingEpoch: 0 }),
      commandRunner: async () => { throw new Error('stale binding must fail before command replay'); } }),
    /existing action receipt does not match this request/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('registry deletion or drift immediately before the external mutation records failure without running it', async () => {
  const { root } = await fixture();
  let gateCalls = 0;
  let commandCalls = 0;
  const binding = { schema: 'booking.registry-runtime-gate/v1', operationId: 'op-1', fencingEpoch: 1,
    releaseId: CANDIDATE.releaseId, manifestDigest: CANDIDATE.manifestDigest };
  try {
    await assert.rejects(runFencedAction(args({ 'action-id': 'stage-registry-disappeared' }), { deployStateRoot: root,
      now: at('2026-09-09T15:05:00.000Z'), planBuilder: async () => ({ ...planBuilder(), registrySupplyChainBinding: binding,
        registrySupplyChainGate: async () => {
          gateCalls += 1;
          if (gateCalls === 3) throw new Error('registry evidence disappeared');
          return binding;
        } }), commandRunner: async () => { commandCalls += 1; return successRunner(); } }), /registry evidence disappeared/);
    assert.equal(gateCalls, 3);
    assert.equal(commandCalls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a live registry gate that crosses lease expiry blocks normal, replay, recovery, and adoption commands', async (t) => {
  const binding = { schema: 'booking.registry-runtime-gate/v1', operationId: 'op-1', fencingEpoch: 1,
    releaseId: CANDIDATE.releaseId, manifestDigest: CANDIDATE.manifestDigest };
  const guardedPlan = (gate, currentBinding = binding) => ({ ...planBuilder(), registrySupplyChainBinding: currentBinding,
    registrySupplyChainGate: gate });
  const expiring = (threshold, before, expired) => {
    let calls = 0;
    let crossed = false;
    return { now: () => new Date(crossed ? expired : before), gate: async () => {
      calls += 1;
      if (calls >= threshold) crossed = true;
      return binding;
    }, calls: () => calls };
  };

  await t.test('normal execution', async () => {
    const { root } = await fixture();
    const clock = expiring(3, '2026-09-09T15:59:00.000Z', '2026-09-09T16:00:00.000Z');
    let mutations = 0;
    try {
      await assert.rejects(runFencedAction(args({ 'action-id': 'stage-expired-after-live-gate' }), { deployStateRoot: root,
        now: clock.now, planBuilder: async () => guardedPlan(clock.gate), commandRunner: async () => {
          mutations += 1; return successRunner();
        } }), /lease has expired|insufficient remaining time/);
      assert.equal(clock.calls(), 3);
      assert.equal(mutations, 0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  for (const mode of ['replay', 'recovery']) await t.test(mode, async () => {
    const { root, statePath } = await fixture();
    const steadyGate = async () => binding;
    try {
      const receipt = await runFencedAction(args({ 'action-id': `stage-expired-${mode}` }), { deployStateRoot: root,
        now: at('2026-09-09T15:05:00.000Z'), planBuilder: async () => guardedPlan(steadyGate), commandRunner: successRunner });
      if (mode === 'recovery') {
        const path = join(resourceDirectory(statePath, 'booking-preprod-edge'), 'resource-state.json');
        const resource = JSON.parse(await readFile(path, 'utf8'));
        resource.pendingAction = { actionId: `stage-expired-${mode}`, requestDigest: receipt.requestDigest };
        resource.receiptChainHead = null;
        await writeFile(path, `${JSON.stringify(resource)}\n`);
      }
      const clock = expiring(2, '2026-09-09T15:59:00.000Z', '2026-09-09T16:00:00.000Z');
      let commands = 0;
      await assert.rejects(runFencedAction(args({ 'action-id': `stage-expired-${mode}` }), { deployStateRoot: root,
        now: clock.now, planBuilder: async () => guardedPlan(clock.gate), commandRunner: async () => {
          commands += 1; return successRunner();
        } }), /lease has expired|insufficient remaining time/);
      assert.equal(clock.calls(), 2);
      assert.equal(commands, 0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  await t.test('takeover adoption', async () => {
    const { root } = await fixtureFromState(candidateReadyState());
    const runtimeEnvFile = join(root, '.runtime.env');
    await writeFile(runtimeEnvFile, RUNTIME_ENV_CONTENT, { mode: 0o600 });
    const singletonPlan = () => ({ executable: '/trusted/singletons', argv: ['transfer'], cwd: '/trusted/release',
      readback: { executable: '/trusted/singletons', argv: ['readback'], verify: () => ({ exactlyOne: true }) } });
    const oldArgs = args({ action: 'preprod-transfer-singletons', 'expected-generation': '6', 'resource-id': 'booking-preprod-edge',
      'action-id': 'singleton-expiry-old' });
    let mutations = 0;
    const runner = async (_executable, argv) => { if (argv[0] === 'transfer') mutations += 1; return successRunner(); };
    try {
      await runFencedAction(oldArgs, { deployStateRoot: root, now: at('2026-09-09T15:05:00.000Z'),
        planBuilder: singletonPlan, commandRunner: runner });
      const taken = await runManageDeployState({ action: 'takeover', execute: 'true', environment: 'preprod', project: 'booking-preprod',
        'approval-id': 'approval-2', 'expected-generation': '6', 'expected-fencing-epoch': '1',
        'manifest-digest': CANDIDATE.manifestDigest, 'operation-id': 'op-1', 'lease-id': 'lease-2', 'holder-id': 'owner-2',
        'lease-duration-ms': '1800000' }, { deployStateRoot: root, runtimeEnvFile, allowInsecureTestPaths: true,
        nowMs: Date.parse('2026-09-09T16:01:00.000Z') });
      const currentBinding = { ...binding, fencingEpoch: 2 };
      const clock = expiring(2, '2026-09-09T16:30:00.000Z', '2026-09-09T16:31:00.000Z');
      const gate = async () => { await clock.gate(); return currentBinding; };
      await assert.rejects(runFencedAction({ ...oldArgs, 'approval-id': 'approval-2',
        'expected-generation': String(taken.generation), 'expected-fencing-epoch': '2', 'lease-id': 'lease-2',
        'holder-id': 'owner-2', 'action-id': 'singleton-expiry-adopt' }, { deployStateRoot: root, now: clock.now,
        planBuilder: async () => guardedPlan(gate, currentBinding), commandRunner: runner }),
      /lease has expired|insufficient remaining time/);
      assert.equal(clock.calls(), 2);
      assert.equal(mutations, 1, 'only the original holder mutation may have executed');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

test('external command budgets are derived from the post-gate clock rather than firstNow', async () => {
  const { root } = await fixture();
  const binding = { schema: 'booking.registry-runtime-gate/v1', operationId: 'op-1', fencingEpoch: 1,
    releaseId: CANDIDATE.releaseId, manifestDigest: CANDIDATE.manifestDigest };
  let clockReads = 0;
  const now = () => new Date(clockReads++ === 0 ? '2026-09-09T15:00:00.000Z' : '2026-09-09T15:59:00.000Z');
  const timeouts = [];
  try {
    await runFencedAction(args({ 'action-id': 'stage-post-gate-budget' }), { deployStateRoot: root, now,
      planBuilder: async () => ({ ...planBuilder(), registrySupplyChainBinding: binding,
        registrySupplyChainGate: async () => binding }), commandRunner: async (_executable, _argv, options) => {
        timeouts.push(options.timeoutMs); return successRunner();
      } });
    assert.deepEqual(timeouts, [59_000, 59_500]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preproduction ledger baseline is fenced to the canonical database resources', async () => {
  const { root } = await fixtureFromState(preMigrationState());
  try {
    const receipt = await runFencedAction(args({
      action: 'preprod-baseline-ledger',
      'expected-generation': '3',
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
  const singletonArgs = args({ action: 'preprod-transfer-singletons', 'expected-generation': '6',
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

test('concrete singleton transfer proves manifest-bound Telegram getMe identity before invoking the singleton helper', async () => {
  const sourceManifest = structuredClone(MANIFEST);
  sourceManifest.releaseId = ACTIVE.releaseId;
  sourceManifest.source.gitSha = ACTIVE.gitSha;
  sourceManifest.contracts.rollbackCompatibleRelease = null;
  const sourceIdentity = { ...ACTIVE, manifestDigest: sha256(sourceManifest) };
  let state = initialDeployState({ ...DEPLOYMENT, active: sourceIdentity }, '2026-09-09T15:00:00.000Z');
  state = acquireLease(state, { expectedGeneration: 0, expectedFencingEpoch: 0, candidate: CANDIDATE, operationId: 'op-1', approvalId: 'approval-1',
    leaseId: 'lease-1', holderId: 'owner-1', now: '2026-09-09T15:01:00.000Z', expiresAt: '2026-09-09T16:00:00.000Z' });
  for (const [to, extra] of [['MANIFEST_VERIFIED', {}], ['STAGED', {}], ['EXPAND_MIGRATED', { expandMigrationReceiptDigest: `sha256:${'1'.repeat(64)}` }],
    ['CANDIDATE_STARTED', { stageReceiptDigest: `sha256:${'2'.repeat(64)}` }], ['CANDIDATE_READY', { candidateProbeDigest: `sha256:${'3'.repeat(64)}` }]]) {
    state = transitionDeployState(state, { expectedGeneration: state.generation, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
      now: '2026-09-09T15:03:00.000Z', to, manifestDigest: CANDIDATE.manifestDigest, ...extra });
  }
  for (const mismatch of [false, true]) {
    const { root } = await fixtureFromState(state);
    const releaseRoot = await concreteReleaseRoot();
    const sourceComposeDirectory = join(releaseRoot, sourceIdentity.releaseId, 'ops', 'compose');
    await mkdir(sourceComposeDirectory, { recursive: true });
    await writeFile(join(sourceComposeDirectory, 'compose.preprod.yml'), COMPOSE_CONTENT);
    await writeFile(join(sourceComposeDirectory, 'compose.preprod-telegram-egress.yml'), EGRESS_COMPOSE_CONTENT);
    await writeFile(join(releaseRoot, sourceIdentity.releaseId, 'release-manifest.json'), `${JSON.stringify(sourceManifest)}\n`);
    let singletonRan = false;
    let isolationChecks = 0;
    const invocations = [];
    try {
      const run = runFencedAction(args({ action: 'preprod-transfer-singletons', 'expected-generation': '6',
        'resource-id': 'booking-preprod-edge', 'action-id': `singletons-getme-${mismatch}` }), { deployStateRoot: root, releaseRoot,
        releaseManifest: MANIFEST, sourceReleaseManifest: sourceManifest, dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
        candidateRuntimeVerifier: async () => { isolationChecks += 1; return { verified: true }; },
        now: at('2026-09-09T15:05:00.000Z'), commandRunner: async (_executable, argv) => {
          invocations.push(argv);
          if (argv.includes('telegram-bot-identity')) return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify({
            schema: 'booking.telegram-bot-identity/v1', action: 'getMe', botId: 123,
            botUsername: mismatch ? 'foreign_bot' : TELEGRAM_BOT_USERNAME, observedAt: '2026-09-09T15:05:01.000Z' }), stderr: '' };
          if (argv[0] === 'image' && argv[1] === 'inspect') return { exitCode: 0, signal: null, overflow: false, stdout: imageInspectOutput('backend'), stderr: '' };
          if (String(argv[0]).includes('manage-preprod-singletons.mjs')) {
            singletonRan ||= !argv.includes('--readback');
            return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify({ schema: 'booking.singleton-transfer-readback/v1',
              project: 'booking-preprod', action: 'transfer', releaseId: CANDIDATE.releaseId, gitSha: CANDIDATE.gitSha,
              manifestDigest: CANDIDATE.manifestDigest, targetSlot: 'blue', sourceSlot: 'green', legacySourceNoOutbox: false,
              legacyTargetNoOutbox: false, targetSupported: true, targetService: 'order-worker-blue', workerContainerId: 'a'.repeat(64),
              workerImageId: BACKEND_IMAGE_ID, workerHealth: 'healthy', observedAt: '2026-09-09T15:05:02.000Z' }), stderr: '' };
          }
          return successRunner();
        } });
      if (mismatch) {
        await assert.rejects(run, /Telegram getMe preflight does not match manifest bot identity/);
        assert.equal(singletonRan, false);
      } else {
        const receipt = await run;
        assert.equal(receipt.verification.preflight.botUsername, TELEGRAM_BOT_USERNAME);
        assert.equal(singletonRan, true);
        assert.equal(isolationChecks, 2);
        const identityInvocation = invocations.find((argv) => argv.includes('telegram-bot-identity'));
        assert.ok(identityInvocation.includes('--rm'));
        assert.ok(identityInvocation.includes('--no-deps'));
      }
    } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
  }
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
      const receipt = await runFencedAction(args({ action, 'expected-generation': '10', 'manifest-digest': ACTIVE.manifestDigest,
        'resource-id': resource, 'action-id': actionId }), { deployStateRoot: root, now: at('2026-09-09T15:05:00.000Z'), planBuilder: generic, commandRunner: successRunner });
      assert.deepEqual(receipt.releaseIdentity, ACTIVE);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('pre-switch rollback rejects ingress before planning or command execution while singleton rollback remains available', async () => {
  let state = singletonTransferredState();
  state = transitionDeployState(state, { expectedGeneration: 7, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:40.000Z', to: 'ROLLBACK_PENDING' });
  const { root } = await fixtureFromState(state);
  let planCalls = 0;
  let commandCalls = 0;
  const generic = () => {
    planCalls += 1;
    return { executable: '/trusted/action', argv: ['mutate'], cwd: '/trusted/release',
      readback: { executable: '/trusted/action', argv: ['readback'], verify: () => ({ restored: true }) } };
  };
  const runner = async () => {
    commandCalls += 1;
    return successRunner();
  };
  try {
    await assert.rejects(runFencedAction(args({ action: 'preprod-rollback-ingress', 'expected-generation': '8',
      'manifest-digest': ACTIVE.manifestDigest, 'resource-id': 'ingress:booking-preprod', 'action-id': 'forbidden-pre-switch-ingress' }),
    { deployStateRoot: root, now: at('2026-09-09T15:05:00.000Z'), planBuilder: generic, commandRunner: runner }),
    /ingress rollback is forbidden before the candidate ingress promotion/);
    assert.equal(planCalls, 0);
    assert.equal(commandCalls, 0);

    const singletonReceipt = await runFencedAction(args({ action: 'preprod-rollback-singletons', 'expected-generation': '8',
      'manifest-digest': ACTIVE.manifestDigest, 'resource-id': 'booking-preprod-edge', 'action-id': 'pre-switch-singletons' }),
    { deployStateRoot: root, now: at('2026-09-09T15:05:00.000Z'), planBuilder: generic, commandRunner: runner });
    assert.deepEqual(singletonReceipt.releaseIdentity, ACTIVE);
    assert.equal(planCalls, 1);
    assert.equal(commandCalls, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('concrete ingress plan derives first and second promotion sequence plus immutable cycle binding from canonical state', async () => {
  let secondPromotion = rollbackPendingState();
  secondPromotion = transitionDeployState(secondPromotion, { expectedGeneration: 10, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:04:10.000Z', to: 'ROLLED_BACK', rollbackReceiptDigest: `sha256:${'1'.repeat(64)}`,
    rollbackSingletonTransferReceiptDigest: `sha256:${'2'.repeat(64)}`, rolledBackProbeDigest: `sha256:${'3'.repeat(64)}` });
  secondPromotion = transitionDeployState(secondPromotion, { expectedGeneration: 11, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:04:20.000Z', to: 'CANDIDATE_STARTED', stageReceiptDigest: `sha256:${'4'.repeat(64)}` });
  secondPromotion = transitionDeployState(secondPromotion, { expectedGeneration: 12, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:04:30.000Z', to: 'CANDIDATE_READY', candidateProbeDigest: `sha256:${'5'.repeat(64)}` });
  secondPromotion = transitionDeployState(secondPromotion, { expectedGeneration: 13, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:04:40.000Z', to: 'SINGLETON_TRANSFERRED', rollbackPreSwitchProbeDigest: `sha256:${'6'.repeat(64)}`,
    singletonTransferReceiptDigest: `sha256:${'7'.repeat(64)}` });
  for (const [state, sequence, actionId] of [[singletonTransferredState(), 1, 'switch-ingress-first'], [secondPromotion, 3, 'switch-ingress-second']]) {
    const { root } = await fixtureFromState(state);
    const releaseRoot = await concreteReleaseRoot();
    const invocations = [];
    let isolationChecks = 0;
    const readback = { schema: 'booking.ingress-readback/v2', project: 'booking-preprod', hostname: 'booking-preprod.happybooking.uk',
      upstream: 'gateway-blue:8080', releaseId: CANDIDATE.releaseId, manifestDigest: CANDIDATE.manifestDigest, operationId: 'op-1',
      approvalId: 'approval-1', leaseId: 'lease-1', holderId: 'owner-1', actionKind: 'preprod-switch-ingress', actionId, sequence,
      fencingEpoch: 1, rollbackUpstream: 'gateway-green:8080', rollbackReleaseId: ACTIVE.releaseId,
      rollbackManifestDigest: ACTIVE.manifestDigest, proofDigest: `sha256:${'8'.repeat(64)}`, remoteVersion: sequence,
      remoteConfigDigest: `sha256:${'9'.repeat(64)}`, guard: { mode: 'double-read-version-and-digest', atomicRemoteCas: false,
        opportunisticIfMatch: true, exclusiveWriteRequired: true }, observedAt: '2026-09-09T15:05:01.000Z' };
    try {
      const receipt = await runFencedAction(args({ action: 'preprod-switch-ingress', 'expected-generation': String(state.generation),
        'resource-id': 'ingress:booking-preprod', 'action-id': actionId }), { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST,
        ingressExecutable: '/trusted/switch-preprod-ingress', dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
        candidateRuntimeVerifier: async () => { isolationChecks += 1; return { verified: true }; }, now: at('2026-09-09T15:05:00.000Z'),
        commandRunner: async (_executable, argv) => { invocations.push(argv); return { exitCode: 0, signal: null, overflow: false,
          stdout: JSON.stringify(readback), stderr: '' }; } });
      const mutation = invocations.find((argv) => argv.includes('--execute'));
      assert.ok(mutation);
      assert.equal(mutation[mutation.indexOf('--sequence') + 1], String(sequence));
      assert.equal(mutation[mutation.indexOf('--action-kind') + 1], 'preprod-switch-ingress');
      assert.equal(mutation[mutation.indexOf('--approval-id') + 1], 'approval-1');
      assert.equal(mutation[mutation.indexOf('--lease-id') + 1], 'lease-1');
      assert.equal(mutation[mutation.indexOf('--holder-id') + 1], 'owner-1');
      assert.equal(mutation[mutation.indexOf('--rollback-upstream') + 1], 'gateway-green:8080');
      assert.equal(mutation[mutation.indexOf('--rollback-release') + 1], ACTIVE.releaseId);
      assert.equal(mutation[mutation.indexOf('--rollback-manifest-digest') + 1], ACTIVE.manifestDigest);
      await assert.rejects(runIngressHelper(mutation, { tokenFile: join(releaseRoot, 'missing-token'), proofFile: join(releaseRoot, 'proof.json'),
        proofArchiveDirectory: join(releaseRoot, 'proofs'), lockFile: join(releaseRoot, 'ingress.lock'), allowInsecureTestPaths: true }),
      sequence === 1 ? /token file is unavailable/ : /first ingress proof must begin at sequence one/);
      assert.equal(receipt.verification.runtime.proofDigest, readback.proofDigest);
      assert.equal(receipt.verification.runtime.remoteConfigDigest, readback.remoteConfigDigest);
      assert.equal(isolationChecks, 2);
    } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
  }
});

test('concrete ingress readback rejects action identity or cycle baseline drift', async () => {
  for (const field of ['actionId', 'rollbackManifestDigest']) {
    const state = singletonTransferredState();
    const { root } = await fixtureFromState(state);
    const releaseRoot = await concreteReleaseRoot();
    const actionId = `switch-ingress-bad-${field}`;
    const readback = { schema: 'booking.ingress-readback/v2', project: 'booking-preprod', hostname: 'booking-preprod.happybooking.uk',
      upstream: 'gateway-blue:8080', releaseId: CANDIDATE.releaseId, manifestDigest: CANDIDATE.manifestDigest, operationId: 'op-1',
      approvalId: 'approval-1', leaseId: 'lease-1', holderId: 'owner-1', actionKind: 'preprod-switch-ingress', actionId, sequence: 1,
      fencingEpoch: 1, rollbackUpstream: 'gateway-green:8080', rollbackReleaseId: ACTIVE.releaseId,
      rollbackManifestDigest: ACTIVE.manifestDigest, proofDigest: `sha256:${'8'.repeat(64)}`, remoteVersion: 1,
      remoteConfigDigest: `sha256:${'9'.repeat(64)}`, guard: { mode: 'double-read-version-and-digest', atomicRemoteCas: false,
        opportunisticIfMatch: false, exclusiveWriteRequired: true }, observedAt: '2026-09-09T15:05:01.000Z' };
    readback[field] = field === 'actionId' ? 'foreign-action' : `sha256:${'0'.repeat(64)}`;
    try {
      await assert.rejects(runFencedAction(args({ action: 'preprod-switch-ingress', 'expected-generation': '7',
        'resource-id': 'ingress:booking-preprod', 'action-id': actionId }), { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST,
        ingressExecutable: '/trusted/switch-preprod-ingress', dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
        candidateRuntimeVerifier: async () => ({ verified: true }), now: at('2026-09-09T15:05:00.000Z'),
        commandRunner: async () => ({ exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(readback), stderr: '' }) }),
      /ingress readback identity mismatch/);
    } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
  }
});

test('takeover recovers an ingress PUT completed before executor receipt only through prior proof and fresh remote readbacks', async () => {
  const { root, statePath } = await fixtureFromState(singletonTransferredState());
  const releaseRoot = await concreteReleaseRoot();
  const runtimeEnvFile = join(root, '.runtime.env');
  await writeFile(runtimeEnvFile, RUNTIME_ENV_CONTENT, { mode: 0o600 });
  const oldActionId = 'switch-before-crash';
  const newActionId = 'switch-after-takeover';
  const ingressReadback = (approvalId, leaseId, holderId, actionId, fencingEpoch, proofDigit) => ({
    schema: 'booking.ingress-readback/v2', project: 'booking-preprod', hostname: 'booking-preprod.happybooking.uk',
    upstream: 'gateway-blue:8080', releaseId: CANDIDATE.releaseId, manifestDigest: CANDIDATE.manifestDigest, operationId: 'op-1',
    approvalId, leaseId, holderId, actionKind: 'preprod-switch-ingress', actionId, sequence: 1, fencingEpoch,
    rollbackUpstream: 'gateway-green:8080', rollbackReleaseId: ACTIVE.releaseId, rollbackManifestDigest: ACTIVE.manifestDigest,
    proofDigest: `sha256:${proofDigit.repeat(64)}`, remoteVersion: fencingEpoch + 10, remoteConfigDigest: `sha256:${'9'.repeat(64)}`,
    guard: { mode: 'double-read-version-and-digest', atomicRemoteCas: false, opportunisticIfMatch: true, exclusiveWriteRequired: true },
    observedAt: '2026-09-09T15:05:01.000Z',
  });
  const oldProof = ingressReadback('approval-1', 'lease-1', 'owner-1', oldActionId, 1, '8');
  try {
    const oldReceipt = await runFencedAction(args({ action: 'preprod-switch-ingress', 'expected-generation': '7',
      'resource-id': 'ingress:booking-preprod', 'action-id': oldActionId }), { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST,
      ingressExecutable: '/trusted/switch-preprod-ingress', dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
      candidateRuntimeVerifier: async () => ({ verified: true }),
      now: at('2026-09-09T15:05:00.000Z'), commandRunner: async () => ({ exitCode: 0, signal: null, overflow: false,
        stdout: JSON.stringify(oldProof), stderr: '' }) });
    await unlink(join(dirname(statePath), 'executor', 'receipts', `000000000001-preprod-switch-ingress-${oldActionId}.json`));
    const resourcePath = join(resourceDirectory(statePath, 'ingress:booking-preprod'), 'resource-state.json');
    const resource = JSON.parse(await readFile(resourcePath, 'utf8'));
    await writeFile(resourcePath, `${JSON.stringify({ ...resource, pendingAction: { action: oldReceipt.action,
      actionId: oldActionId, requestDigest: oldReceipt.requestDigest, approvalId: oldReceipt.approvalId,
      leaseId: oldReceipt.leaseId, holderId: oldReceipt.holderId, generation: oldReceipt.generation,
      fencingEpoch: oldReceipt.fencingEpoch, commandDigest: oldReceipt.commandDigest },
    receiptChainHead: oldReceipt.resources[0].previousReceiptDigest })}\n`);
    const taken = await runManageDeployState({ action: 'takeover', execute: 'true', environment: 'preprod', project: 'booking-preprod',
      'approval-id': 'approval-2', 'expected-generation': '7', 'expected-fencing-epoch': '1', 'manifest-digest': CANDIDATE.manifestDigest,
      'operation-id': 'op-1', 'lease-id': 'lease-2', 'holder-id': 'owner-2', 'lease-duration-ms': '1800000' },
    { deployStateRoot: root, runtimeEnvFile, allowInsecureTestPaths: true, nowMs: Date.parse('2026-09-09T16:01:00.000Z') });
    const newProof = ingressReadback('approval-2', 'lease-2', 'owner-2', newActionId, 2, '7');
    const notApplied = { schema: 'booking.ingress-pending-recovery/v1', outcome: 'not-applied', project: 'booking-preprod',
      hostname: 'booking-preprod.happybooking.uk', operationId: 'op-1', actionKind: 'preprod-switch-ingress',
      actionId: oldActionId, sequence: 1, fencingEpoch: 1, expectedPreviousUpstream: 'gateway-green:8080',
      remoteVersion: 3, remoteConfigDigest: `sha256:${'6'.repeat(64)}`, previousProofDigest: null,
      guard: { mode: 'double-read-version-and-digest', atomicRemoteCas: false,
        opportunisticIfMatch: true, exclusiveWriteRequired: true },
      observedAt: '2026-09-09T16:02:00.000Z' };
    const pendingAfterCrash = JSON.parse(await readFile(resourcePath, 'utf8'));
    for (const mismatch of ['action', 'request']) {
      const badPending = { ...pendingAfterCrash.pendingAction,
        ...(mismatch === 'action' ? { actionId: 'foreign-pending-action' } : { requestDigest: `sha256:${'f'.repeat(64)}` }) };
      await writeFile(resourcePath, `${JSON.stringify({ ...pendingAfterCrash, pendingAction: badPending })}\n`);
      let mutationAttempted = false;
      await assert.rejects(runFencedAction(args({ action: 'preprod-switch-ingress', 'approval-id': 'approval-2',
        'expected-generation': String(taken.generation), 'expected-fencing-epoch': '2', 'resource-id': 'ingress:booking-preprod',
        'lease-id': 'lease-2', 'holder-id': 'owner-2', 'action-id': newActionId }), { deployStateRoot: root, releaseRoot,
        releaseManifest: MANIFEST, ingressExecutable: '/trusted/switch-preprod-ingress', dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
        candidateRuntimeVerifier: async () => ({ verified: true }),
        now: at('2026-09-09T16:02:00.000Z'), commandRunner: async (_executable, argv) => {
          if (!argv.includes('--readback')) mutationAttempted = true;
          return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(oldProof), stderr: '' };
        } }), /prior pending ingress (recovery identity|request digest)/);
      assert.equal(mutationAttempted, false);
    }
    await writeFile(resourcePath, `${JSON.stringify(pendingAfterCrash)}\n`);
    let ambiguousMutations = 0;
    await assert.rejects(runFencedAction(args({ action: 'preprod-switch-ingress', 'approval-id': 'approval-2',
      'expected-generation': String(taken.generation), 'expected-fencing-epoch': '2', 'resource-id': 'ingress:booking-preprod',
      'lease-id': 'lease-2', 'holder-id': 'owner-2', 'action-id': 'switch-ambiguous-after-takeover' }), { deployStateRoot: root, releaseRoot,
      releaseManifest: MANIFEST, ingressExecutable: '/trusted/switch-preprod-ingress', dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
      candidateRuntimeVerifier: async () => ({ verified: true }),
      now: at('2026-09-09T16:01:20.000Z'), commandRunner: async (_executable, argv) => {
        if (!argv.includes('--readback') && !argv.includes('--recover-pending')) ambiguousMutations += 1;
        return { exitCode: 20, signal: null, overflow: false, stdout: '', stderr: 'ambiguous remote state' };
      } }), /external action failed/);
    assert.equal(ambiguousMutations, 0, 'ambiguous recovery evidence must fail closed before mutation');
    assert.deepEqual(JSON.parse(await readFile(resourcePath, 'utf8')), pendingAfterCrash);
    let appliedReadbacks = 0;
    let appliedMutations = 0;
    const appliedRecoveryActionId = 'switch-applied-after-takeover';
    const appliedRecovery = await runFencedAction(args({ action: 'preprod-switch-ingress', 'approval-id': 'approval-2',
      'expected-generation': String(taken.generation), 'expected-fencing-epoch': '2', 'resource-id': 'ingress:booking-preprod',
      'lease-id': 'lease-2', 'holder-id': 'owner-2', 'action-id': appliedRecoveryActionId }), { deployStateRoot: root, releaseRoot,
      releaseManifest: MANIFEST, ingressExecutable: '/trusted/switch-preprod-ingress', dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
      candidateRuntimeVerifier: async () => ({ verified: true }),
      now: at('2026-09-09T16:01:30.000Z'), commandRunner: async (_executable, argv) => {
        if (argv.includes('--readback')) appliedReadbacks += 1;
        else appliedMutations += 1;
        return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(oldProof), stderr: '' };
      } });
    assert.equal(appliedReadbacks, 1);
    assert.equal(appliedMutations, 0, 'proven-applied prior ingress must be adopted without another mutation');
    assert.equal(appliedRecovery.executionOutputDigest, sha256(''));
    assert.equal(appliedRecovery.verification.runtime.actionId, oldActionId);
    assert.equal(appliedRecovery.verification.adoption.mode, 'prior-pending-proven-applied-read-only');
    const appliedCompleted = JSON.parse(await readFile(resourcePath, 'utf8'));
    assert.equal(appliedCompleted.highestAcceptedFencingEpoch, 2);
    assert.equal(appliedCompleted.pendingAction, null);
    assert.equal(appliedCompleted.receiptChainHead, appliedRecovery.receiptDigest);
    await writeFile(resourcePath, `${JSON.stringify(pendingAfterCrash)}\n`);
    let appliedReplayMutations = 0;
    const appliedReplay = await runFencedAction(args({ action: 'preprod-switch-ingress', 'approval-id': 'approval-2',
      'expected-generation': String(taken.generation), 'expected-fencing-epoch': '2', 'resource-id': 'ingress:booking-preprod',
      'lease-id': 'lease-2', 'holder-id': 'owner-2', 'action-id': appliedRecoveryActionId }), { deployStateRoot: root, releaseRoot,
      releaseManifest: MANIFEST, ingressExecutable: '/trusted/switch-preprod-ingress', dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
      candidateRuntimeVerifier: async () => ({ verified: true }),
      now: at('2026-09-09T16:01:45.000Z'), commandRunner: async (_executable, argv) => {
        if (!argv.includes('--readback')) appliedReplayMutations += 1;
        return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(oldProof), stderr: '' };
      } });
    assert.equal(appliedReplay.receiptDigest, appliedRecovery.receiptDigest);
    assert.equal(appliedReplayMutations, 0, 'receipt/resource crash recovery must remain read-only');
    const appliedReplayCompleted = JSON.parse(await readFile(resourcePath, 'utf8'));
    assert.equal(appliedReplayCompleted.pendingAction, null);
    assert.equal(appliedReplayCompleted.receiptChainHead, appliedRecovery.receiptDigest);
    await writeFile(resourcePath, `${JSON.stringify(pendingAfterCrash)}\n`);
    let readbacks = 0;
    let mutations = 0;
    let recoveryChecks = 0;
    const recovered = await runFencedAction(args({ action: 'preprod-switch-ingress', 'approval-id': 'approval-2',
      'expected-generation': String(taken.generation), 'expected-fencing-epoch': '2', 'resource-id': 'ingress:booking-preprod',
      'lease-id': 'lease-2', 'holder-id': 'owner-2', 'action-id': newActionId }), { deployStateRoot: root, releaseRoot,
      releaseManifest: MANIFEST, ingressExecutable: '/trusted/switch-preprod-ingress', dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
      candidateRuntimeVerifier: async () => ({ verified: true }),
      now: at('2026-09-09T16:02:00.000Z'), commandRunner: async (_executable, argv) => {
        if (argv.includes('--readback')) {
          readbacks += 1;
          if (readbacks === 1) return { exitCode: 20, signal: null, overflow: false, stdout: '', stderr: 'no proof' };
          return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(newProof), stderr: '' };
        }
        if (argv.includes('--recover-pending')) {
          recoveryChecks += 1;
          return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(notApplied), stderr: '' };
        }
        mutations += 1;
        return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(newProof), stderr: '' };
      } });
    assert.equal(readbacks, 2);
    assert.equal(mutations, 1);
    assert.equal(recoveryChecks, 1);
    assert.equal(recovered.verification.adoption.mode, 'prior-pending-proven-not-applied-and-retried');
    const completed = JSON.parse(await readFile(resourcePath, 'utf8'));
    assert.equal(completed.highestAcceptedFencingEpoch, 2);
    assert.equal(completed.pendingAction, null);
    assert.equal(completed.receiptChainHead, recovered.receiptDigest);

    // Simulate a crash after the new-fence receipt is durable but before the
    // prior-epoch pending resource is advanced to that receipt.
    await writeFile(resourcePath, `${JSON.stringify(pendingAfterCrash)}\n`);
    let replayMutations = 0;
    const replayed = await runFencedAction(args({ action: 'preprod-switch-ingress', 'approval-id': 'approval-2',
      'expected-generation': String(taken.generation), 'expected-fencing-epoch': '2', 'resource-id': 'ingress:booking-preprod',
      'lease-id': 'lease-2', 'holder-id': 'owner-2', 'action-id': newActionId }), { deployStateRoot: root, releaseRoot,
      releaseManifest: MANIFEST, ingressExecutable: '/trusted/switch-preprod-ingress', dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
      candidateRuntimeVerifier: async () => ({ verified: true }), now: at('2026-09-09T16:03:00.000Z'),
      commandRunner: async (_executable, argv) => {
        if (!argv.includes('--readback')) replayMutations += 1;
        return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(newProof), stderr: '' };
      } });
    assert.equal(replayed.receiptDigest, recovered.receiptDigest);
    assert.equal(replayMutations, 0);
    const replayCompleted = JSON.parse(await readFile(resourcePath, 'utf8'));
    assert.equal(replayCompleted.pendingAction, null);
    assert.equal(replayCompleted.receiptChainHead, recovered.receiptDigest);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
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
  await writeFile(join(directory, 'ops', 'compose', 'compose.preprod.yml'), COMPOSE_CONTENT);
  await writeFile(join(directory, 'ops', 'compose', 'compose.preprod-telegram-egress.yml'), EGRESS_COMPOSE_CONTENT);
  await writeFile(join(directory, 'release-manifest.json'), rawManifest);
  const invocations = [];
  const readback = { schema: 'booking.ingress-readback/v1', project: 'booking-preprod', hostname: 'booking-preprod.happybooking.uk',
    upstream: 'gateway-green:8080', releaseId: legacy.releaseId, manifestDigest: legacy.manifestDigest, operationId: 'op-1', fencingEpoch: 1,
    observedAt: '2026-09-09T15:05:01.000Z' };
  try {
    await assert.rejects(runFencedAction(args({ action: 'preprod-rollback-ingress', 'expected-generation': '10', 'manifest-digest': legacy.manifestDigest,
      'resource-id': 'ingress:booking-preprod', 'action-id': 'rollback-ingress-raw-1' }), {
      deployStateRoot: root, releaseRoot, dockerExecutable: '/trusted/docker', ingressExecutable: '/trusted/switch-preprod-ingress', now: at('2026-09-09T15:05:00.000Z'),
      commandRunner: async (_executable, argv) => { invocations.push(argv); return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(readback), stderr: '' }; },
    }), /canonical candidate identity/);
    assert.equal(invocations.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('singleton rollback sources transferred candidate before switch and active after switch', () => {
  let beforeSwitch = candidateReadyState();
  beforeSwitch = transitionDeployState(beforeSwitch, { expectedGeneration: 6, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:30.000Z', to: 'SINGLETON_TRANSFERRED', rollbackPreSwitchProbeDigest: `sha256:${'a'.repeat(64)}`,
    singletonTransferReceiptDigest: `sha256:${'c'.repeat(64)}` });
  beforeSwitch = transitionDeployState(beforeSwitch, { expectedGeneration: 7, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
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
  await writeFile(join(releaseRoot, '.runtime.env'), 'FIXTURE_ONLY=true\n', { mode: 0o600 });
  const composeDirectory = join(releaseRoot, CANDIDATE.releaseId, 'ops', 'compose');
  await mkdir(composeDirectory, { recursive: true });
  await writeFile(join(composeDirectory, 'compose.preprod.yml'), COMPOSE_CONTENT);
  await writeFile(join(composeDirectory, 'compose.preprod-telegram-egress.yml'), EGRESS_COMPOSE_CONTENT);
  await mkdir(join(releaseRoot, CANDIDATE.releaseId, 'frontend'));
  await writeFile(join(releaseRoot, CANDIDATE.releaseId, 'frontend', 'nginx.preprod.conf'), ROUTE_CONTENT, { mode: 0o444 });
  const invocations = [];
  try {
    const receipt = await runFencedAction(args(), { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier, dockerExecutable: '/trusted/docker',
      env: MIGRATION_ENV, portAvailabilityChecker: async () => true,
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
          if (String(argv[3]).includes('.HostConfig')) return { exitCode: 0, signal: null, overflow: false,
            stdout: candidateRuntimeInspect(component, releaseRoot), stderr: '' };
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
    assert.equal(
      mutation.argv[mutation.argv.indexOf('--env-file') + 1],
      '/etc/happybooking/secrets/booking-preprod-control-plane.env',
      'the host Compose process must consume only the fixed root-owned control environment',
    );
    assert.equal(receipt.verification.artifacts.routeContractDigest, MANIFEST.artifacts.gateway.routeContractDigest);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('candidate stage rejects runtime identity, privilege, namespace, device, network, mount, critical env, and loopback-port drift', async () => {
  for (const scenario of ['label', 'network', 'mount', 'environment', 'port', 'user', 'privileged', 'pid', 'ipc', 'device']) {
    const { root } = await fixture();
    const releaseRoot = await concreteReleaseRoot();
    const gatewayValues = candidateRuntimeInspect('gateway', releaseRoot).split(/\r?\n/).map((line) => JSON.parse(line));
    const backendValues = candidateRuntimeInspect('backend', releaseRoot).split(/\r?\n/).map((line) => JSON.parse(line));
    if (scenario === 'label') backendValues[0]['com.docker.compose.project'] = 'foreign';
    if (scenario === 'network') gatewayValues[3]['booking-preprod-data'] = {};
    if (scenario === 'mount') gatewayValues[2].find((item) => item.Type === 'bind').RW = true;
    if (scenario === 'environment') backendValues[1] = backendValues[1].map((item) => item === 'BOOKING_RUNTIME_ROLE=standby' ? 'BOOKING_RUNTIME_ROLE=worker' : item);
    if (scenario === 'port') gatewayValues[8]['8080/tcp'][0].HostIp = '0.0.0.0';
    if (scenario === 'user') backendValues[9] = 'root';
    if (scenario === 'privileged') backendValues[10] = true;
    if (scenario === 'pid') backendValues[11] = 'host';
    if (scenario === 'ipc') backendValues[12] = 'host';
    if (scenario === 'device') backendValues[13] = [{ PathOnHost: '/dev/null', PathInContainer: '/dev/null', CgroupPermissions: 'rwm' }];
    const overrides = { backend: Object.fromEntries(backendValues.map((value, index) => [index, value])),
      gateway: Object.fromEntries(gatewayValues.map((value, index) => [index, value])) };
    try {
      await assert.rejects(runFencedAction(args({ 'action-id': `stage-runtime-${scenario}` }), { deployStateRoot: root, releaseRoot,
        releaseManifest: MANIFEST, backupArtifactVerifier, dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
        portAvailabilityChecker: async () => true, now: at('2026-09-09T15:05:00.000Z'), commandRunner: concreteStageRunner(releaseRoot, overrides) }),
      /candidate (runtime isolation identity|network isolation|mount isolation|critical environment|capability or loopback port binding) mismatch/);
    } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
  }
});

test('completed candidate-stage receipt replay re-inspects containers and rejects post-stage isolation drift', async () => {
  const { root } = await fixture();
  const releaseRoot = await concreteReleaseRoot();
  let drifted = false;
  const gatewayValues = candidateRuntimeInspect('gateway', releaseRoot).split(/\r?\n/).map((line) => JSON.parse(line));
  gatewayValues[3]['booking-preprod-data'] = {};
  const drift = { gateway: Object.fromEntries(gatewayValues.map((value, index) => [index, value])) };
  const runner = async (...runnerArgs) => concreteStageRunner(releaseRoot, drifted ? drift : {})(...runnerArgs);
  try {
    const runtime = { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier,
      dockerExecutable: '/trusted/docker', env: MIGRATION_ENV, portAvailabilityChecker: async () => true,
      now: at('2026-09-09T15:05:00.000Z'), commandRunner: runner };
    await runFencedAction(args({ 'action-id': 'stage-replay-runtime' }), runtime);
    drifted = true;
    await assert.rejects(runFencedAction(args({ 'action-id': 'stage-replay-runtime' }), {
      ...runtime, now: at('2026-09-09T15:06:00.000Z'),
    }), /candidate network isolation mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('a completed stage survives same-holder renewal, rejects env drift and cannot use the removed state-only abort path', async () => {
  const { root } = await fixture();
  const runtimeEnvFile = join(root, '.runtime.env');
  await writeFile(runtimeEnvFile, RUNTIME_ENV_CONTENT, { mode: 0o600 });
  const managerRuntime = (nowMs) => ({ deployStateRoot: root, runtimeEnvFile, allowInsecureTestPaths: true, nowMs });
  const stateArgs = { execute: 'true', environment: 'preprod', project: 'booking-preprod', 'approval-id': 'approval-1',
    'manifest-digest': CANDIDATE.manifestDigest, 'operation-id': 'op-1', 'lease-id': 'lease-1', 'holder-id': 'owner-1' };
  try {
    const receipt = await runFencedAction(args({ 'action-id': 'stage-before-renew' }), { deployStateRoot: root,
      now: at('2026-09-09T15:05:00.000Z'), planBuilder, commandRunner: successRunner });
    await assert.rejects(runManageDeployState({ ...stateArgs, action: 'transition', 'expected-generation': '4',
      'expected-fencing-epoch': '1', to: 'ABORT_CANDIDATE' }, managerRuntime(Date.parse('2026-09-09T15:06:00.000Z'))),
    /state.phase is invalid|not allowed/);
    await writeFile(runtimeEnvFile, 'FIXTURE_ONLY=drifted-before-renew\n', { mode: 0o600 });
    await assert.rejects(runManageDeployState({ ...stateArgs, action: 'renew', 'expected-generation': '4',
      'expected-fencing-epoch': '1', 'lease-duration-ms': '1800000' }, managerRuntime(Date.parse('2026-09-09T15:40:00.000Z'))),
    /runtime environment digest drifted/);
    await writeFile(runtimeEnvFile, RUNTIME_ENV_CONTENT, { mode: 0o600 });
    const renewed = await runManageDeployState({ ...stateArgs, action: 'renew', 'expected-generation': '4',
      'expected-fencing-epoch': '1', 'lease-duration-ms': '1800000' }, managerRuntime(Date.parse('2026-09-09T15:40:00.000Z')));
    assert.equal(renewed.generation, 5);
    await writeFile(runtimeEnvFile, 'FIXTURE_ONLY=drifted\n', { mode: 0o600 });
    await assert.rejects(runManageDeployState({ ...stateArgs, action: 'transition', 'expected-generation': '5',
      'expected-fencing-epoch': '1', to: 'CANDIDATE_STARTED', 'stage-receipt-digest': receipt.receiptDigest },
    managerRuntime(Date.parse('2026-09-09T15:41:00.000Z'))), /runtime environment digest drifted/);
    await writeFile(runtimeEnvFile, RUNTIME_ENV_CONTENT, { mode: 0o600 });
    const transitioned = await runManageDeployState({ ...stateArgs, action: 'transition', 'expected-generation': '5',
      'expected-fencing-epoch': '1', to: 'CANDIDATE_STARTED', 'stage-receipt-digest': receipt.receiptDigest },
    managerRuntime(Date.parse('2026-09-09T15:41:00.000Z')));
    assert.equal(transitioned.phase, 'CANDIDATE_STARTED');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('takeover adopts completed singleton mutation by independent readback and emits a new-fence receipt', async () => {
  const { root } = await fixtureFromState(candidateReadyState());
  const runtimeEnvFile = join(root, '.runtime.env');
  await writeFile(runtimeEnvFile, RUNTIME_ENV_CONTENT, { mode: 0o600 });
  const managerRuntime = (nowMs) => ({ deployStateRoot: root, runtimeEnvFile, allowInsecureTestPaths: true, nowMs });
  const oldArgs = args({ action: 'preprod-transfer-singletons', 'expected-generation': '6', 'resource-id': 'booking-preprod-edge',
    'action-id': 'singletons-before-takeover' });
  let mutations = 0;
  const singletonPlan = () => ({ executable: '/trusted/singletons', argv: ['transfer'], cwd: '/trusted/release',
    readback: { executable: '/trusted/singletons', argv: ['readback'], verify: () => ({ exactlyOne: true }) } });
  const runner = async (_executable, argv) => { if (argv[0] === 'transfer') mutations += 1; return successRunner(); };
  try {
    await runFencedAction(oldArgs, { deployStateRoot: root, now: at('2026-09-09T15:05:00.000Z'), planBuilder: singletonPlan, commandRunner: runner });
    await assert.rejects(runManageDeployState({ action: 'transition', execute: 'true', environment: 'preprod', project: 'booking-preprod',
      'approval-id': 'approval-1', 'expected-generation': '6', 'expected-fencing-epoch': '1', 'manifest-digest': CANDIDATE.manifestDigest,
      'operation-id': 'op-1', 'lease-id': 'lease-1', 'holder-id': 'owner-1', to: 'ABORT_CANDIDATE' },
    managerRuntime(Date.parse('2026-09-09T15:06:00.000Z'))), /state.phase is invalid|not allowed/);
    const taken = await runManageDeployState({ action: 'takeover', execute: 'true', environment: 'preprod', project: 'booking-preprod',
      'approval-id': 'approval-2', 'expected-generation': '6', 'expected-fencing-epoch': '1', 'manifest-digest': CANDIDATE.manifestDigest,
      'operation-id': 'op-1', 'lease-id': 'lease-2', 'holder-id': 'owner-2', 'lease-duration-ms': '1800000' },
    managerRuntime(Date.parse('2026-09-09T16:01:00.000Z')));
    assert.equal(taken.fencingEpoch, 2);
    const currentBase = { ...oldArgs, 'approval-id': 'approval-2', 'expected-generation': '7', 'expected-fencing-epoch': '2',
      'lease-id': 'lease-2', 'holder-id': 'owner-2' };
    const activeProbe = await runFencedAction({ ...currentBase, action: 'preprod-probe-active', 'manifest-digest': ACTIVE.manifestDigest,
      'resource-id': 'probe:booking-preprod:active', 'action-id': 'active-probe-after-takeover' }, { deployStateRoot: root,
      now: at('2026-09-09T16:02:00.000Z'), planBuilder: () => ({ executable: '/trusted/probe', argv: ['probe'], cwd: '/trusted/release',
        readback: { executable: '/trusted/probe', argv: ['readback'], verify: () => ({ exact: true }) } }), commandRunner: successRunner });
    const adopted = await runFencedAction({ ...currentBase, 'action-id': 'singletons-adopted-after-takeover' }, { deployStateRoot: root,
      now: at('2026-09-09T16:03:00.000Z'), planBuilder: singletonPlan, commandRunner: runner });
    assert.equal(mutations, 1, 'takeover adoption must not repeat the singleton mutation');
    assert.equal(adopted.fencingEpoch, 2);
    assert.equal(adopted.verification.adoption.mode, 'independent-readback');
    const transitioned = await runManageDeployState({ action: 'transition', execute: 'true', environment: 'preprod', project: 'booking-preprod',
      'approval-id': 'approval-2', 'expected-generation': '7', 'expected-fencing-epoch': '2', 'manifest-digest': CANDIDATE.manifestDigest,
      'operation-id': 'op-1', 'lease-id': 'lease-2', 'holder-id': 'owner-2', to: 'SINGLETON_TRANSFERRED',
      'rollback-pre-switch-probe-digest': activeProbe.receiptDigest, 'singleton-transfer-receipt-digest': adopted.receiptDigest },
    managerRuntime(Date.parse('2026-09-09T16:04:00.000Z')));
    assert.equal(transitioned.phase, 'SINGLETON_TRANSFERRED');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('takeover adopts baseline, migration, and rollback singleton completion only by independent readback', async (t) => {
  const scenarios = [
    { action: 'preprod-baseline-ledger', state: preMigrationState(), generation: 3,
      resourceId: 'database:booking-preprod', manifestDigest: CANDIDATE.manifestDigest },
    { action: 'preprod-expand-migrate', state: preMigrationState(), generation: 3,
      resourceId: 'database:booking-preprod', manifestDigest: CANDIDATE.manifestDigest },
    { action: 'preprod-rollback-singletons', state: rollbackPendingState(), generation: 10,
      resourceId: 'booking-preprod-edge', manifestDigest: ACTIVE.manifestDigest },
  ];
  for (const scenario of scenarios) await t.test(scenario.action, async () => {
    const { root } = await fixtureFromState(scenario.state);
    const runtimeEnvFile = join(root, '.runtime.env');
    await writeFile(runtimeEnvFile, RUNTIME_ENV_CONTENT, { mode: 0o600 });
    let mutations = 0;
    let readbacks = 0;
    const plan = () => ({ executable: '/trusted/action', argv: ['apply'], cwd: '/trusted/release',
      readback: { executable: '/trusted/action', argv: ['readback'], verify: () => ({ exact: true }) } });
    const runner = async (_executable, argv) => {
      if (argv[0] === 'apply') mutations += 1;
      if (argv[0] === 'readback') readbacks += 1;
      return successRunner();
    };
    const oldArgs = args({ action: scenario.action, 'expected-generation': String(scenario.generation),
      'resource-id': scenario.resourceId, 'manifest-digest': scenario.manifestDigest, 'action-id': `${scenario.action}-old` });
    try {
      const prior = await runFencedAction(oldArgs, { deployStateRoot: root, now: at('2026-09-09T15:05:00.000Z'), planBuilder: plan, commandRunner: runner });
      const taken = await runManageDeployState({ action: 'takeover', execute: 'true', environment: 'preprod', project: 'booking-preprod',
        'approval-id': 'approval-2', 'expected-generation': String(scenario.generation), 'expected-fencing-epoch': '1',
        'manifest-digest': CANDIDATE.manifestDigest, 'operation-id': 'op-1', 'lease-id': 'lease-2', 'holder-id': 'owner-2',
        'lease-duration-ms': '1800000' }, { deployStateRoot: root, runtimeEnvFile, allowInsecureTestPaths: true,
        nowMs: Date.parse('2026-09-09T16:01:00.000Z') });
      const adopted = await runFencedAction({ ...oldArgs, 'approval-id': 'approval-2', 'expected-generation': String(taken.generation),
        'expected-fencing-epoch': '2', 'lease-id': 'lease-2', 'holder-id': 'owner-2', 'action-id': `${scenario.action}-adopted` },
      { deployStateRoot: root, now: at('2026-09-09T16:02:00.000Z'), planBuilder: plan, commandRunner: runner });
      assert.equal(mutations, 1, 'the original mutation must not be executed by the new holder');
      assert.equal(readbacks, 2, 'the new holder must perform a fresh independent readback');
      assert.equal(adopted.verification.adoption.priorReceiptDigest, prior.receiptDigest);
      assert.equal(adopted.fencingEpoch, 2);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

test('candidate stage rejects route-contract byte drift and writable release config before mutation', async () => {
  for (const scenario of ['digest', 'writable']) {
    const { root } = await fixture();
    const releaseRoot = await concreteReleaseRoot();
    const route = join(releaseRoot, CANDIDATE.releaseId, 'frontend', 'nginx.preprod.conf');
    let mutated = false;
    try {
      if (scenario === 'digest') {
        await chmod(route, 0o666);
        await writeFile(route, `${ROUTE_CONTENT}# drift\n`);
        await chmod(route, 0o444);
      }
      else await chmod(route, 0o666);
      await assert.rejects(runFencedAction(args({ 'action-id': `stage-route-${scenario}` }), { deployStateRoot: root, releaseRoot,
        releaseManifest: MANIFEST, backupArtifactVerifier, dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
        portAvailabilityChecker: async () => true, now: at('2026-09-09T15:05:00.000Z'), commandRunner: async (_executable, argv) => {
          if (argv.includes('config')) return { exitCode: 0, signal: null, overflow: false, stdout: 'backend-blue\ngateway-blue\n', stderr: '' };
          if (argv[0] === 'image' && argv[1] === 'inspect') {
            const component = String(argv.at(-1)).includes('/backend:') ? 'backend' : 'gateway';
            return { exitCode: 0, signal: null, overflow: false, stdout: imageInspectOutput(component), stderr: '' };
          }
          if (argv.includes('up')) mutated = true;
          return successRunner();
        } }), scenario === 'digest' ? /does not match the release manifest/ : /immutable root-owned/);
      assert.equal(mutated, false);
    } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
  }
});

test('candidate stage rejects a writable frontend parent directory before mutation', {
  skip: process.platform === 'win32' || process.getuid?.() !== 0,
}, async () => {
  const { root } = await fixture();
  const releaseRoot = await concreteReleaseRoot('/root');
  const frontendDirectory = join(releaseRoot, CANDIDATE.releaseId, 'frontend');
  let mutated = false;
  try {
    await chmod(frontendDirectory, 0o777);
    await assert.rejects(runFencedAction(args({ 'action-id': 'stage-writable-frontend-parent' }), {
      deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier,
      dockerExecutable: '/trusted/docker', env: MIGRATION_ENV, portAvailabilityChecker: async () => true,
      now: at('2026-09-09T15:05:00.000Z'), commandRunner: async (_executable, argv) => {
        if (argv.includes('up')) mutated = true;
        return successRunner();
      },
    }), /release frontend directory must be a canonical root-owned non-writable directory/);
    assert.equal(mutated, false);
  } finally { await chmod(frontendDirectory, 0o755).catch(() => {}); await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('runtime env digest is part of the fenced request and bot control values cannot diverge from manifest', async () => {
  const { root } = await fixture();
  const releaseRoot = await concreteReleaseRoot();
  const runner = async (_executable, argv) => {
    if (argv.includes('config')) return { exitCode: 0, signal: null, overflow: false, stdout: 'backend-blue\ngateway-blue\n', stderr: '' };
    if (argv[0] === 'image' && argv[1] === 'inspect') {
      const component = String(argv.at(-1)).includes('/backend:') ? 'backend' : 'gateway';
      return { exitCode: 0, signal: null, overflow: false, stdout: imageInspectOutput(component), stderr: '' };
    }
    if (argv.includes('ps') && argv.includes('-q')) return { exitCode: 0, signal: null, overflow: false,
      stdout: (String(argv.at(-1)).startsWith('backend-') ? BACKEND_IMAGE_ID : GATEWAY_IMAGE_ID).slice(7), stderr: '' };
    if (argv[0] === 'container' && argv[1] === 'inspect') {
      const component = argv.at(-1) === BACKEND_IMAGE_ID.slice(7) ? 'backend' : 'gateway';
      return { exitCode: 0, signal: null, overflow: false,
        stdout: String(argv[3]).includes('.HostConfig') ? candidateRuntimeInspect(component, releaseRoot) : (component === 'backend' ? BACKEND_IMAGE_ID : GATEWAY_IMAGE_ID), stderr: '' };
    }
    if (argv[0] === 'cp') { await writeFile(join(argv.at(-1), 'index.html'), H5_CONTENT); return successRunner(); }
    if (String(argv[0]).includes('probe-fenced-candidate.mjs')) return { exitCode: 0, signal: null, overflow: false,
      stdout: JSON.stringify({ status: 'pass', releaseId: CANDIDATE.releaseId, gitSha: CANDIDATE.gitSha,
        manifestDigest: CANDIDATE.manifestDigest, slot: CANDIDATE.slot }), stderr: '' };
    return successRunner();
  };
  try {
    const runtime = { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier, dockerExecutable: '/trusted/docker',
      env: MIGRATION_ENV, portAvailabilityChecker: async () => true, now: at('2026-09-09T15:05:00.000Z'), commandRunner: runner };
    const receipt = await runFencedAction(args({ 'action-id': 'stage-env-digest' }), runtime);
    assert.match(receipt.requestDigest, /^sha256:/);
    assert.equal(receipt.runtimeEnvDigest, DEPLOYMENT.runtimeEnvDigest);
    await writeFile(join(releaseRoot, '.runtime.env'), 'FIXTURE_ONLY=false\n', { mode: 0o600 });
    await assert.rejects(runFencedAction(args({ 'action-id': 'stage-env-digest' }), { ...runtime, now: at('2026-09-09T15:06:00.000Z') }),
      /runtime environment digest drifted from the operation binding/);
    await writeFile(join(releaseRoot, '.runtime.env'), RUNTIME_ENV_CONTENT, { mode: 0o600 });
    await assert.rejects(runFencedAction(args({ 'action-id': 'stage-wrong-bot' }), { ...runtime,
      env: { ...MIGRATION_ENV, BOOKING_TELEGRAM_BOT_NAME: 'different_preprod_bot' } }), /conflicts with canonical release identity/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('runtime env drift during an external action cannot publish a pass receipt', async () => {
  const { root, statePath } = await fixture();
  const releaseRoot = await concreteReleaseRoot();
  const baseRunner = concreteStageRunner(releaseRoot);
  try {
    await assert.rejects(runFencedAction(args({ 'action-id': 'stage-env-mid-action' }), { deployStateRoot: root, releaseRoot,
      releaseManifest: MANIFEST, backupArtifactVerifier, dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
      portAvailabilityChecker: async () => true, now: at('2026-09-09T15:05:00.000Z'), commandRunner: async (...runnerArgs) => {
        const result = await baseRunner(...runnerArgs);
        if (String(runnerArgs[1]?.[0]).includes('probe-fenced-candidate.mjs')) {
          await writeFile(join(releaseRoot, '.runtime.env'), 'FIXTURE_ONLY=mid-action-drift\n', { mode: 0o600 });
        }
        return result;
      },
    }), /runtime environment digest drifted from the operation binding/);
    const receiptDirectory = join(dirname(statePath), 'executor', 'receipts');
    const receiptName = (await readdir(receiptDirectory)).find((name) => name.includes('stage-env-mid-action'));
    const receipt = JSON.parse(await readFile(join(receiptDirectory, receiptName), 'utf8'));
    assert.equal(receipt.status, 'fail');
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('runtime env rejects non-0600 permissions and symbolic-link substitution', { skip: process.platform === 'win32' }, async () => {
  for (const scenario of ['permissions', 'symlink']) {
    const { root } = await fixture();
    const releaseRoot = await concreteReleaseRoot();
    const runtimeEnv = join(releaseRoot, '.runtime.env');
    try {
      if (scenario === 'permissions') await chmod(runtimeEnv, 0o644);
      else {
        const target = join(releaseRoot, '.runtime-target.env');
        await writeFile(target, 'FIXTURE_ONLY=true\n', { mode: 0o600 });
        await rm(runtimeEnv);
        await symlink(target, runtimeEnv, 'file');
      }
      await assert.rejects(runFencedAction(args({ 'action-id': `stage-runtime-${scenario}` }), { deployStateRoot: root, releaseRoot,
        releaseManifest: MANIFEST, backupArtifactVerifier, dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
        portAvailabilityChecker: async () => true, now: at('2026-09-09T15:05:00.000Z'), commandRunner: successRunner }),
      scenario === 'permissions' ? /root-owned 0600 regular file/ : /fixed canonical non-symlink path/);
    } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
  }
});

test('post-switch observation executor invokes only the fixed public HTTPS probe contract', async () => {
  const state = transitionDeployState(switchedState(), { expectedGeneration: 8, expectedFencingEpoch: 1, leaseId: 'lease-1', holderId: 'owner-1',
    now: '2026-09-09T15:03:50.000Z', to: 'OBSERVING', webhookReceiptDigest: `sha256:${'d'.repeat(64)}` });
  const { root } = await fixtureFromState(state);
  const releaseRoot = await concreteReleaseRoot();
  const invocations = [];
  let isolationChecks = 0;
  const output = JSON.stringify({ status: 'pass', origin: 'https://booking-preprod.happybooking.uk', releaseId: CANDIDATE.releaseId,
    gitSha: CANDIDATE.gitSha, manifestDigest: CANDIDATE.manifestDigest, slot: CANDIDATE.slot,
    configSchema: MANIFEST.contracts.configSchema, migrationFloor: MANIFEST.contracts.migration.expandFloor,
    migrationCatalogDigest: MANIFEST.contracts.migration.catalogDigest, telegramBotMode: 'webhook', telegramWebhookEnabled: true,
    telegramWebhookUrl: 'https://booking-preprod.happybooking.uk/telegram/webhook' });
  try {
    const receipt = await runFencedAction(args({ action: 'preprod-probe-observation', 'expected-generation': '9',
      'resource-id': 'probe:booking-preprod:observation', 'action-id': 'observe-public-1' }), { deployStateRoot: root, releaseRoot,
      releaseManifest: MANIFEST, dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
      candidateRuntimeVerifier: async () => { isolationChecks += 1; return { verified: true }; }, now: at('2026-09-09T15:05:00.000Z'),
      commandRunner: async (executable, argv) => { invocations.push({ executable, argv });
        return { exitCode: 0, signal: null, overflow: false, stdout: output, stderr: '' }; } });
    assert.equal(invocations.length, 2);
    for (const invocation of invocations) {
      assert.match(String(invocation.argv[0]), /probe-fenced-public\.mjs$/);
      assert.equal(invocation.argv.includes('--base-url'), false);
      assert.equal(invocation.argv.some((item) => String(item).includes('127.0.0.1')), false);
    }
    assert.equal(receipt.verification.runtime.origin, 'https://booking-preprod.happybooking.uk');
    assert.equal(isolationChecks, 2);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('candidate probe rejects post-stage runtime isolation drift before any HTTP probe', async () => {
  const state = transitionDeployState(stagedState(), { expectedGeneration: 4, expectedFencingEpoch: 1,
    leaseId: 'lease-1', holderId: 'owner-1', now: '2026-09-09T15:03:10.000Z',
    to: 'CANDIDATE_STARTED', stageReceiptDigest: `sha256:${'8'.repeat(64)}` });
  const { root } = await fixtureFromState(state);
  const releaseRoot = await concreteReleaseRoot();
  let probeCalls = 0;
  try {
    await assert.rejects(runFencedAction(args({ action: 'preprod-probe-candidate', 'expected-generation': '5',
      'resource-id': 'probe:booking-preprod:candidate', 'action-id': 'candidate-runtime-drift' }), {
      deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
      candidateRuntimeVerifier: async () => { throw new Error('candidate runtime isolation drift'); },
      now: at('2026-09-09T15:05:00.000Z'), commandRunner: async () => { probeCalls += 1; return successRunner(); },
    }), /candidate runtime isolation drift/);
    assert.equal(probeCalls, 0);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('gateway OCI bot labels and candidate rollback target are fail-closed', async () => {
  const gatewayArtifact = MANIFEST.artifacts.gateway;
  const inspected = parseImageInspectFixture('gateway');
  assert.throws(() => verifyDockerImageBinding('gateway', gatewayArtifact, CANDIDATE, { ...inspected,
    labels: { ...inspected.labels, 'uk.happybooking.telegram-bot-username': 'other_bot' } }), /OCI release labels/);
  for (const rollbackCompatibleRelease of [null, 'booking-20260909T130000Z-deadbee']) {
    const manifest = structuredClone(MANIFEST);
    manifest.contracts.rollbackCompatibleRelease = rollbackCompatibleRelease;
    const manifestDigest = sha256(manifest);
    const state = preMigrationState();
    state.candidate.manifestDigest = manifestDigest;
    const { root } = await fixtureFromState(state);
    const releaseRoot = await concreteReleaseRoot();
    let calls = 0;
    try {
      await assert.rejects(runFencedAction(migrationArgs({ 'manifest-digest': manifestDigest, 'action-id': `rollback-${rollbackCompatibleRelease || 'null'}` }), {
        deployStateRoot: root, releaseRoot, releaseManifest: manifest, backupArtifactVerifier, dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
        now: at('2026-09-09T15:05:00.000Z'), commandRunner: async () => { calls += 1; return successRunner(); },
      }), /canonical rollback target release/);
      assert.equal(calls, 0);
    } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
  }
});

test('candidate stage rejects a loopback port collision with the active slot before Docker runs', async () => {
  const { root } = await fixture();
  const releaseRoot = await mkdtemp(join(tmpdir(), 'booking-release-root-'));
  await writeFile(join(releaseRoot, '.runtime.env'), 'FIXTURE_ONLY=true\n', { mode: 0o600 });
  const composeDirectory = join(releaseRoot, CANDIDATE.releaseId, 'ops', 'compose');
  await mkdir(composeDirectory, { recursive: true });
  await writeFile(join(composeDirectory, 'compose.preprod.yml'), COMPOSE_CONTENT);
  await writeFile(join(composeDirectory, 'compose.preprod-telegram-egress.yml'), EGRESS_COMPOSE_CONTENT);
  await mkdir(join(releaseRoot, CANDIDATE.releaseId, 'frontend'));
  await writeFile(join(releaseRoot, CANDIDATE.releaseId, 'frontend', 'nginx.preprod.conf'), ROUTE_CONTENT, { mode: 0o444 });
  let calls = 0;
  try {
    await assert.rejects(runFencedAction(args(), { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier, dockerExecutable: '/trusted/docker',
      env: MIGRATION_ENV, portAvailabilityChecker: async () => false, now: at('2026-09-09T15:05:00.000Z'),
      commandRunner: async (_executable, argv) => { calls += 1; return argv.includes('config')
        ? { exitCode: 0, signal: null, overflow: false, stdout: 'backend-blue\ngateway-blue\n', stderr: '' }
        : successRunner(); } }), /candidate loopback port 18083 is already occupied/);
    assert.equal(calls, 1, 'only read-only compose config is allowed before the port collision fails closed');
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('candidate compose bytes and implicit release-local env are immutable trusted inputs', async () => {
  const first = await fixture();
  const releaseRoot = await mkdtemp(join(tmpdir(), 'booking-release-root-'));
  await writeFile(join(releaseRoot, '.runtime.env'), 'FIXTURE_ONLY=true\n', { mode: 0o600 });
  const directory = join(releaseRoot, CANDIDATE.releaseId);
  const composeDirectory = join(directory, 'ops', 'compose');
  await mkdir(composeDirectory, { recursive: true });
  await writeFile(join(composeDirectory, 'compose.preprod.yml'), `${COMPOSE_CONTENT}# drift\n`);
  await writeFile(join(composeDirectory, 'compose.preprod-telegram-egress.yml'), EGRESS_COMPOSE_CONTENT);
  await mkdir(join(directory, 'frontend'));
  await writeFile(join(directory, 'frontend', 'nginx.preprod.conf'), ROUTE_CONTENT, { mode: 0o444 });
  let calls = 0;
  const runtime = { deployStateRoot: first.root, releaseRoot, releaseManifest: MANIFEST, dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
    portAvailabilityChecker: async () => true, now: at('2026-09-09T15:05:00.000Z'), commandRunner: async () => { calls += 1; return successRunner(); } };
  try {
    await assert.rejects(runFencedAction(args(), runtime), /compose file does not match immutable release manifest/);
    assert.equal(calls, 0);
    await writeFile(join(composeDirectory, 'compose.preprod.yml'), COMPOSE_CONTENT);
    await writeFile(join(composeDirectory, 'compose.preprod-telegram-egress.yml'), EGRESS_COMPOSE_CONTENT);
    await writeFile(join(directory, '.env'), 'BOOKING_BLUE_PORT=18081\n');
    await assert.rejects(runFencedAction(args({ 'action-id': 'stage-env-drift' }), runtime), /release-local \.env is forbidden/);
    assert.equal(calls, 0);
  } finally { await rm(first.root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('concrete migration plan verifies apply receipt, independent exact ledger readback and actual container images', async () => {
  const { root } = await fixtureFromState(preMigrationState());
  const releaseRoot = await concreteReleaseRoot();
  try {
    const invocations = [];
    const runner = concreteMigrationRunner();
    const receipt = await runFencedAction(migrationArgs(), {
      deployStateRoot: root,
      releaseRoot,
      releaseManifest: MANIFEST,
      backupArtifactVerifier,
      dockerExecutable: '/trusted/docker',
      env: MIGRATION_ENV,
      now: at('2026-09-09T15:05:00.000Z'),
      commandRunner: async (executable, argv, options) => { invocations.push(argv); return runner(executable, argv, options); },
    });
    assert.deepEqual(receipt.verification.execution.approvedPending, JSON.parse(MIGRATION_ENV.BOOKING_MIGRATION_APPROVED_PENDING_JSON));
    assert.equal(receipt.verification.runtime.ledgerHead, 'AddOrderCreatedConsumerIdempotency1788760000000');
    assert.equal(receipt.verification.artifacts.backend.imageId, BACKEND_IMAGE_ID);
    assert.equal(receipt.verification.artifacts.containers.length, 2);
    for (const argv of invocations.filter((item) => item.includes('schema-migrate') || item.includes('schema-migration-readback'))) {
      assert.ok(argv.includes('--no-deps'), 'migration and readback one-shots must never recreate data-plane dependencies');
    }
    assert.equal(receipt.verification.artifacts.dataPlane.root, '/volume1/homes/realzyq/booking-preprod-data');
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('migration rejects the historical in-project data root before touching schema state', async () => {
  const { root } = await fixtureFromState(preMigrationState());
  const releaseRoot = await concreteReleaseRoot();
  let migrationRan = false;
  const runner = concreteMigrationRunner({ dataRoot: '/volume1/homes/realzyq/booking-preprod/data/postgres' });
  try {
    await assert.rejects(runFencedAction(migrationArgs({ 'action-id': 'migrate-old-data-root' }), {
      deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier, dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
      now: at('2026-09-09T15:05:00.000Z'), commandRunner: async (executable, argv, options) => {
        if (argv.includes('schema-migrate')) migrationRan = true;
        return runner(executable, argv, options);
      },
    }), /does not match the canonical isolated data-plane identity/);
    assert.equal(migrationRan, false);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('migration rejects data-plane containers owned by another Compose project before touching schema state', async () => {
  const { root } = await fixtureFromState(preMigrationState());
  const releaseRoot = await concreteReleaseRoot();
  let migrationRan = false;
  const runner = concreteMigrationRunner({ labels: { 'com.docker.compose.project': 'foreign', 'com.docker.compose.service': 'postgres' } });
  try {
    await assert.rejects(runFencedAction(migrationArgs({ 'action-id': 'migrate-wrong-compose-owner' }), {
      deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier, dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
      now: at('2026-09-09T15:05:00.000Z'), commandRunner: async (executable, argv, options) => {
        if (argv.includes('schema-migrate')) migrationRan = true;
        return runner(executable, argv, options);
      },
    }), /does not match the canonical isolated data-plane identity/);
    assert.equal(migrationRan, false);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('migration action rejects a forged backend image before touching the database', async () => {
  const { root } = await fixtureFromState(preMigrationState());
  const releaseRoot = await concreteReleaseRoot();
  let migrationRan = false;
  const runner = concreteMigrationRunner({ wrongImage: true });
  try {
    await assert.rejects(runFencedAction(migrationArgs(), {
      deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier, dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
      now: at('2026-09-09T15:05:00.000Z'), commandRunner: async (executable, argv) => {
        if (argv.includes('schema-migrate')) migrationRan = true;
        return runner(executable, argv);
      },
    }), /local image ID does not match release manifest digest/);
    assert.equal(migrationRan, false);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('migration replay after receipt/pending crash performs independent ledger readback and clears every pending resource', async () => {
  const { root, statePath } = await fixtureFromState(preMigrationState());
  const releaseRoot = await concreteReleaseRoot();
  let migrationExecutions = 0;
  const runner = concreteMigrationRunner();
  try {
    const receipt = await runFencedAction(migrationArgs(), {
      deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier, dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
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
      deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier, dockerExecutable: '/trusted/docker', env: MIGRATION_ENV,
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
  const { root } = await fixtureFromState(preMigrationState());
  const releaseRoot = await concreteReleaseRoot();
  try {
    await runFencedAction(migrationArgs(), { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier,
      dockerExecutable: '/trusted/docker', env: MIGRATION_ENV, now: at('2026-09-09T15:05:00.000Z'), commandRunner: concreteMigrationRunner() });
    await assert.rejects(runFencedAction(migrationArgs(), { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier,
      dockerExecutable: '/trusted/docker', env: MIGRATION_ENV, now: at('2026-09-09T15:06:00.000Z'),
      commandRunner: concreteMigrationRunner({ ledgerHead: 'ForeignMigration9999999999999' }) }), /ledger binding is invalid/);
    await assert.rejects(runFencedAction(migrationArgs(), { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier,
      dockerExecutable: '/trusted/docker', env: { ...MIGRATION_ENV, BOOKING_MIGRATION_APPROVED_PENDING_JSON: '[]' },
      now: at('2026-09-09T15:06:00.000Z'), commandRunner: concreteMigrationRunner() }), /receipt does not match this request/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('canonical release identity environment variables cannot be overridden by a caller', async () => {
  const { root } = await fixtureFromState(preMigrationState());
  const releaseRoot = await concreteReleaseRoot();
  let calls = 0;
  try {
    await assert.rejects(runFencedAction(migrationArgs(), { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier,
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
    const receipt = await runFencedAction(args({ action: 'preprod-set-webhook', 'expected-generation': '8',
      'resource-id': 'telegram:booking-preprod', 'action-id': 'webhook-1' }), {
      deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier, dockerExecutable: '/trusted/docker', env: WEBHOOK_ENV,
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
    assert.equal(receipt.verification.artifacts.check1.containers.length, 3);
    assert.equal(invocations.some((argv) => argv.at(-1) === 'schema-migrate'), false);
    for (const argv of invocations.filter((item) => item.includes('telegram-webhook-set') || item.includes('telegram-webhook-readback'))) {
      assert.ok(argv.includes('--no-deps'));
    }
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('baseline receipt/pending crash replay independently verifies the exact ledger without recreating it', async () => {
  const { root, statePath } = await fixtureFromState(preMigrationState());
  const releaseRoot = await concreteReleaseRoot();
  let applyCount = 0;
  let readbackCount = 0;
  const baselineArgs = args({ action: 'preprod-baseline-ledger', 'expected-generation': '3', 'resource-id': 'database:booking-preprod', 'action-id': 'baseline-replay-1' });
  const runner = async (_executable, argv) => {
    if (argv[0] === 'image' && argv[1] === 'inspect') return { exitCode: 0, signal: null, overflow: false, stdout: imageInspectOutput('backend'), stderr: '' };
    if (argv[0] === 'container' && argv[1] === 'inspect' && String(argv[3]).includes('.Mounts')) {
      return { exitCode: 0, signal: null, overflow: false, stdout: dataPlaneInspect(String(argv.at(-1))), stderr: '' };
    }
    if (argv[0] === 'exec' && argv.includes('psql')) return { exitCode: 0, signal: null, overflow: false, stdout: 'booking_preprod|booking_preprod\n', stderr: '' };
    if (argv[0] === 'container' && argv[1] === 'inspect') return { exitCode: 0, signal: null, overflow: false, stdout: BACKEND_IMAGE_ID, stderr: '' };
    if (argv.includes('schema-baseline-readback')) { readbackCount += 1; return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(baselineReceipt('verify')), stderr: '' }; }
    if (argv.includes('schema-baseline-ledger')) { applyCount += 1; return { exitCode: 0, signal: null, overflow: false, stdout: JSON.stringify(baselineReceipt('apply')), stderr: '' }; }
    return successRunner();
  };
  try {
    const receipt = await runFencedAction(baselineArgs, { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier,
      dockerExecutable: '/trusted/docker', env: BASELINE_ENV, now: at('2026-09-09T15:05:00.000Z'), commandRunner: runner });
    for (const resourceId of receipt.resourceIds) {
      const path = join(resourceDirectory(statePath, resourceId), 'resource-state.json');
      const resource = JSON.parse(await readFile(path, 'utf8'));
      resource.pendingAction = { actionId: 'baseline-replay-1', requestDigest: receipt.requestDigest };
      resource.receiptChainHead = null;
      await writeFile(path, `${JSON.stringify(resource)}\n`);
    }
    const recovered = await runFencedAction(baselineArgs, { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier,
      dockerExecutable: '/trusted/docker', env: BASELINE_ENV, now: at('2026-09-09T15:06:00.000Z'), commandRunner: runner });
    assert.equal(recovered.schema, 'booking.external-action-recovery/v1');
    assert.equal(applyCount, 1);
    assert.equal(readbackCount, 2);
    assert.equal(recovered.verification.runtime.historyDigest, sha256(JSON.stringify(BASELINE_HISTORY)));
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('webhook receipt replay repeats ledger and Telegram readbacks but never repeats setter mutation', async () => {
  const { root, statePath } = await fixtureFromState(switchedState());
  const releaseRoot = await concreteReleaseRoot();
  let setterCount = 0;
  let ledgerReadbackCount = 0;
  let webhookReadbackCount = 0;
  const webhookArgs = args({ action: 'preprod-set-webhook', 'expected-generation': '8',
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
    const runtime = { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier, dockerExecutable: '/trusted/docker', env: WEBHOOK_ENV,
      now: at('2026-09-09T15:05:00.000Z'), commandRunner: runner };
    const receipt = await runFencedAction(webhookArgs, runtime);
    const replay = await runFencedAction(webhookArgs, { ...runtime, now: at('2026-09-09T15:06:00.000Z') });
    assert.equal(replay.receiptDigest, receipt.receiptDigest);
    await mutateStateFile(statePath, (state) => transitionDeployState(state, { expectedGeneration: 8, expectedFencingEpoch: 1,
      leaseId: 'lease-1', holderId: 'owner-1', now: '2026-09-09T15:06:30.000Z', to: 'OBSERVING',
      manifestDigest: CANDIDATE.manifestDigest, webhookReceiptDigest: receipt.receiptDigest }));
    await assert.rejects(runFencedAction({ ...webhookArgs, 'expected-generation': '9', 'action-id': 'webhook-new-mutation' },
      { ...runtime, now: at('2026-09-09T15:07:00.000Z') }), /only exact replay of the rooted webhook action/);
    const observingReplay = await runFencedAction({ ...webhookArgs, 'expected-generation': '9' },
      { ...runtime, now: at('2026-09-09T15:07:00.000Z') });
    assert.equal(observingReplay.receiptDigest, receipt.receiptDigest);
    assert.equal(setterCount, 1);
    assert.equal(ledgerReadbackCount, 3);
    assert.equal(webhookReadbackCount, 3);
  } finally { await rm(root, { recursive: true, force: true }); await rm(releaseRoot, { recursive: true, force: true }); }
});

test('a forged self-reported runtime identity cannot hide a wrong Docker image', async () => {
  const { root } = await fixture();
  const releaseRoot = await mkdtemp(join(tmpdir(), 'booking-release-root-'));
  await writeFile(join(releaseRoot, '.runtime.env'), 'FIXTURE_ONLY=true\n', { mode: 0o600 });
  const composeDirectory = join(releaseRoot, CANDIDATE.releaseId, 'ops', 'compose');
  await mkdir(composeDirectory, { recursive: true });
  await writeFile(join(composeDirectory, 'compose.preprod.yml'), COMPOSE_CONTENT);
  await writeFile(join(composeDirectory, 'compose.preprod-telegram-egress.yml'), EGRESS_COMPOSE_CONTENT);
  await mkdir(join(releaseRoot, CANDIDATE.releaseId, 'frontend'));
  await writeFile(join(releaseRoot, CANDIDATE.releaseId, 'frontend', 'nginx.preprod.conf'), ROUTE_CONTENT, { mode: 0o444 });
  let mutationRan = false;
  try {
    await assert.rejects(runFencedAction(args(), { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier, dockerExecutable: '/trusted/docker',
      env: MIGRATION_ENV, portAvailabilityChecker: async () => true,
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
  await writeFile(join(releaseRoot, '.runtime.env'), 'FIXTURE_ONLY=true\n', { mode: 0o600 });
  const composeDirectory = join(releaseRoot, CANDIDATE.releaseId, 'ops', 'compose');
  await mkdir(composeDirectory, { recursive: true });
  await writeFile(join(composeDirectory, 'compose.preprod.yml'), COMPOSE_CONTENT);
  await writeFile(join(composeDirectory, 'compose.preprod-telegram-egress.yml'), EGRESS_COMPOSE_CONTENT);
  await mkdir(join(releaseRoot, CANDIDATE.releaseId, 'frontend'));
  await writeFile(join(releaseRoot, CANDIDATE.releaseId, 'frontend', 'nginx.preprod.conf'), ROUTE_CONTENT, { mode: 0o444 });
  try {
    await assert.rejects(runFencedAction(args(), { deployStateRoot: root, releaseRoot, releaseManifest: MANIFEST, backupArtifactVerifier, dockerExecutable: '/trusted/docker',
      env: MIGRATION_ENV, portAvailabilityChecker: async () => true,
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
          const component = argv.at(-1) === BACKEND_IMAGE_ID.slice(7) ? 'backend' : 'gateway';
          return { exitCode: 0, signal: null, overflow: false,
            stdout: String(argv[3]).includes('.HostConfig') ? candidateRuntimeInspect(component, releaseRoot) : (component === 'backend' ? BACKEND_IMAGE_ID : GATEWAY_IMAGE_ID), stderr: '' };
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
    await mutateStateFile(statePath, (state) => takeoverExpiredLease(state, { expectedGeneration: 4, expectedFencingEpoch: 1, approvalId: 'approval-2',
      leaseId: 'lease-2', holderId: 'owner-2', now: '2026-09-09T15:11:00.000Z', expiresAt: '2026-09-09T16:11:00.000Z' }));
    await assert.rejects(runFencedAction(args({ 'action-id': 'old-after-takeover' }), { deployStateRoot: root, now: at('2026-09-09T15:12:00.000Z'), planBuilder, commandRunner: async () => { calls += 1; return successRunner(); } }), /generation mismatch/);
    assert.equal(calls, 2);
    const receipt = await runFencedAction(args({ 'approval-id': 'approval-2', 'expected-generation': '5', 'expected-fencing-epoch': '2',
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
