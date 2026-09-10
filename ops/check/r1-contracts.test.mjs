import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  ContractError,
  EXIT,
  readJsonFile,
  sha256,
  validateIngressContract,
  validateReleaseManifest,
} from '../release/lib/contracts.mjs';
import { assertTransition, validateDeployState } from '../release/lib/state-machine.mjs';
import { validateComposeContracts } from '../release/validate-compose.mjs';
import { probeIngress, probeSlot } from './lib/probes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const manifestPath = resolve(root, 'ops/contracts/examples/release-manifest.example.json');
const ingressPath = resolve(root, 'ops/contracts/examples/ingress-contract.example.json');
const statePath = resolve(root, 'ops/contracts/examples/deploy-state.example.json');

async function fixtures() {
  return Promise.all([readJsonFile(manifestPath), readJsonFile(ingressPath), readJsonFile(statePath)]);
}

test('release and ingress examples satisfy executable contracts', async () => {
  const [manifest, ingress] = await fixtures();
  assert.equal(validateReleaseManifest(manifest), manifest);
  assert.equal(validateIngressContract(ingress), ingress);
});

test('release contract rejects mutable image identity and secret-like fields', async () => {
  const [manifest] = await fixtures();
  const latest = structuredClone(manifest);
  latest.artifacts.backend.image = 'booking/backend:latest';
  assert.throws(() => validateReleaseManifest(latest), ContractError);

  const secret = structuredClone(manifest);
  secret.apiToken = 'must-not-enter-a-manifest';
  assert.throws(() => validateReleaseManifest(secret), /secret material/);
});

test('ingress contract fixes Telegram webhook at the non-api root path', async () => {
  const [, ingress] = await fixtures();
  const invalid = { ...ingress, webhookPath: '/api/telegram/webhook' };
  assert.throws(() => validateIngressContract(invalid), /exactly \/telegram\/webhook/);
});

test('state machine allows forward promotion and rejects stale or unsafe rollback', async () => {
  const [, , state] = await fixtures();
  validateDeployState(state);
  assert.equal(assertTransition(state, 'SINGLETON_TRANSFERRED', 18), true);
  assert.throws(() => assertTransition(state, 'SWITCHED', 17), /generation mismatch/);

  const switched = { ...state, phase: 'SWITCHED', contractMigrationApplied: true };
  assert.throws(
    () => assertTransition(switched, 'ROLLBACK_PENDING', switched.generation),
    (error) => error instanceof ContractError && error.exitCode === EXIT.ROLLBACK,
  );
});

test('compose and Nginx contracts reject mutable production behavior', async () => {
  const paths = {
    dev: resolve(root, 'ops/compose/compose.dev.yml'),
    data: resolve(root, 'ops/compose/compose.data.yml'),
    edge: resolve(root, 'ops/compose/compose.edge.yml'),
    release: resolve(root, 'ops/compose/compose.release.yml'),
    network: resolve(root, 'ops/network/edge/nginx.conf.template'),
    ingress: ingressPath,
    edgeBindAddress: '127.0.0.1',
    trustedProxyCidr: '172.31.0.0/24',
  };
  await validateComposeContracts(paths);
  await assert.rejects(
    validateComposeContracts({ ...paths, edgeBindAddress: '0.0.0.0' }),
    (error) => error instanceof ContractError && error.exitCode === EXIT.INGRESS,
  );
  await assert.rejects(
    validateComposeContracts({ ...paths, trustedProxyCidr: '0.0.0.0/0' }),
    (error) => error instanceof ContractError && error.exitCode === EXIT.INGRESS,
  );
});

test('preproduction Telegram profile enforces migration, readiness and exact evidence inputs', async () => {
  const [compose, dockerfile, frontendDockerfile, routeContract] = await Promise.all([
    readFile(resolve(root, 'ops/compose/compose.preprod.yml'), 'utf8'),
    readFile(resolve(root, 'backend/Dockerfile'), 'utf8'),
    readFile(resolve(root, 'frontend/Dockerfile'), 'utf8'),
    readFile(resolve(root, 'frontend/nginx.preprod.conf'), 'utf8'),
  ]);
  assert.match(compose, /schema-migrate:\s*\n\s*profiles:\s*\[migrate\]/);
  assert.match(compose, /schema-migration-readback:\s*\n\s*profiles:\s*\[migrate-readback\]/);
  assert.match(compose, /BOOKING_MIGRATION_APPROVED_PENDING_JSON:\s*\$\{BOOKING_MIGRATION_APPROVED_PENDING_JSON:\?/);
  assert.match(compose, /BOOKING_MIGRATION_BACKUP_RECEIPT_DIGEST:\s*\$\{BOOKING_MIGRATION_BACKUP_RECEIPT_DIGEST:\?/);
  assert.match(compose, /--ready-url=https:\/\/booking-preprod\.happybooking\.uk\/readyz/);
  const webhookService = /telegram-webhook-set:[\s\S]*?(?=\n  [a-z][a-z0-9-]+:|$)/.exec(compose)?.[0] || '';
  assert.doesNotMatch(webhookService, /depends_on:|schema-migrate/);
  assert.match(compose, /telegram-webhook-readback:\s*\n\s*profiles:\s*\[telegram-webhook-readback\]/);
  assert.match(compose, /backend-blue:/);
  assert.match(compose, /gateway-blue:/);
  assert.match(compose, /BOOKING_BACKEND_UPSTREAM:\s*backend-blue:3001/);
  assert.match(compose, /NGINX_ENVSUBST_FILTER:\s*BOOKING_BACKEND_UPSTREAM/);
  assert.match(compose, /target:\s*\/etc\/nginx\/conf\.d/);
  assert.match(compose, /target:\s*\/etc\/nginx\/templates\/default\.conf\.template/);
  assert.match(routeContract, /proxy_pass http:\/\/\$\{BOOKING_BACKEND_UPSTREAM\}/);
  assert.match(routeContract, /\^\/\(s\|r\)\/\[\^\/\]\+\$/);
  assert.doesNotMatch(routeContract, /proxy_pass http:\/\/backend-(?:green|blue)/);
  assert.match(compose, /BOOKING_SLOT:\s*blue/);
  assert.match(compose, /BOOKING_GREEN_PORT:-18082/);
  assert.match(compose, /BOOKING_BLUE_PORT:-18083/);
  assert.doesNotMatch(compose, /BOOKING_(?:GREEN|BLUE)_PORT:-18081/);
  for (const slot of ['blue', 'green']) {
    const api = new RegExp(`backend-${slot}:[\\s\\S]*?(?=\\n  [a-z][a-z0-9-]+:|$)`).exec(compose)?.[0] || '';
    const worker = new RegExp(`order-worker-${slot}:[\\s\\S]*?(?=\\n  [a-z][a-z0-9-]+:|$)`).exec(compose)?.[0] || '';
    assert.match(api, /BOOKING_WORKERS_ENABLED:\s*"false"/);
    assert.match(api, /ORDER_OUTBOX_DISPATCH_ENABLED:\s*"false"/);
    assert.match(api, /TELEGRAM_WEBHOOK_SECRET_TOKEN_FILE:\s*\/run\/secrets\/telegram_webhook_secret/);
    assert.match(api, /source:\s*\/volume1\/happybooking\/booking-preprod\/\.g4\/secrets\/telegram-webhook-secret/);
    assert.match(api, /target:\s*\/run\/secrets\/telegram_webhook_secret/);
    assert.match(worker, /BOOKING_RUNTIME_ROLE:\s*worker/);
    assert.match(worker, /BOOKING_WORKERS_ENABLED:\s*"true"/);
    assert.match(worker, /ORDER_OUTBOX_DISPATCH_ENABLED:\s*"true"/);
    assert.match(worker, /TELEGRAM_BOT_MODE:\s*polling/);
    assert.match(worker, /TELEGRAM_ENABLE_WEBHOOK:\s*"false"/);
    assert.doesNotMatch(worker, /telegram[_-]webhook[_-]secret/i);
    assert.doesNotMatch(worker, /^\s+ports:\s*$/m);
    assert.match(worker, /networks:\s*\[preprod-data\]/);
    for (const block of [api, worker]) {
      assert.match(block, /TELEGRAM_DATA_ENCRYPTION_SECRET_FILE:\s*\/run\/secrets\/telegram_data_encryption_secret/);
      assert.match(block, /source:\s*\/volume1\/happybooking\/booking-preprod\/\.g4\/secrets\/telegram-data-encryption-secret/);
      assert.match(block, /target:\s*\/run\/secrets\/telegram_data_encryption_secret/);
    }
  }
  assert.equal((compose.match(/TELEGRAM_DATA_ENCRYPTION_SECRET_FILE:/g) || []).length, 4);
  assert.equal((compose.match(/source:\s*\/volume1\/happybooking\/booking-preprod\/\.g4\/secrets\/telegram-data-encryption-secret/g) || []).length, 4);
  for (const service of ['telegram-webhook-set', 'telegram-webhook-readback']) {
    const block = new RegExp(`${service}:[\\s\\S]*?(?=\\n  [a-z][a-z0-9-]+:|$)`).exec(compose)?.[0] || '';
    assert.match(block, /TELEGRAM_WEBHOOK_SECRET_TOKEN_FILE:\s*\/run\/secrets\/telegram_webhook_secret/);
    assert.match(block, /source:\s*\/volume1\/happybooking\/booking-preprod\/\.g4\/secrets\/telegram-webhook-secret/);
    assert.match(block, /target:\s*\/run\/secrets\/telegram_webhook_secret/);
  }
  assert.equal((compose.match(/TELEGRAM_WEBHOOK_SECRET_TOKEN_FILE:/g) || []).length, 4);
  assert.equal((compose.match(/source:\s*\/volume1\/happybooking\/booking-preprod\/\.g4\/secrets\/telegram-webhook-secret/g) || []).length, 4);
  assert.match(dockerfile, /COPY --from=build \/app\/src\/migrations \.\/migration-source/);
  assert.match(dockerfile, /npm ci --omit=dev --omit=optional --ignore-scripts/);
  assert.doesNotMatch(dockerfile, /npm ci[^\n]*--omit=peer/);
  assert.match(dockerfile, /\['@nestjs\/platform-express','multer'\]/);
  assert.match(dockerfile, /\['sqlite3','tar'\]/);
  assert.match(dockerfile, /org\.opencontainers\.image\.revision=\$BOOKING_GIT_SHA/);
  assert.match(frontendDockerfile, /org\.opencontainers\.image\.revision=\$BOOKING_GIT_SHA/);
  assert.match(frontendDockerfile, /uk\.happybooking\.component=gateway/);
  assert.match(compose, /BOOKING_MIGRATION_CATALOG_DIR:\s*\/app\/migration-source/);
  assert.match(compose, /schema-baseline-ledger:\s*\n\s*profiles:\s*\[baseline-ledger\]/);
  assert.match(compose, /schema-baseline-readback:\s*\n\s*profiles:\s*\[baseline-readback\]/);
  assert.match(compose, /BOOKING_BASELINE_SCHEMA_DIFF_RECEIPT_DIGEST:\s*\$\{BOOKING_BASELINE_SCHEMA_DIFF_RECEIPT_DIGEST:\?/);
  assert.match(compose, /BOOKING_BASELINE_APPROVED_HISTORY_JSON:\s*\$\{BOOKING_BASELINE_APPROVED_HISTORY_JSON:\?/);
  const rootOnlyEvidenceReaders = [
    'schema-baseline-ledger',
    'schema-migrate',
    'schema-migration-readback',
  ];
  for (const service of rootOnlyEvidenceReaders) {
    const block = new RegExp(`${service}:[\\s\\S]*?(?=\\n  [a-z][a-z0-9-]+:|$)`).exec(compose)?.[0] || '';
    assert.match(block, /user:\s*"0:0"/, `${service} must own the root-only receipt read`);
    assert.match(block, /read_only:\s*true/, `${service} must keep a read-only root filesystem`);
    assert.match(block, /cap_drop:\s*\["ALL"\]/, `${service} must drop every Linux capability`);
    assert.match(block, /security_opt:\s*\["no-new-privileges:true"\]/, `${service} must forbid privilege escalation`);
  }
  for (const service of [
    'schema-baseline-readback',
    'telegram-webhook-set',
    'telegram-webhook-readback',
    'telegram-bot-identity',
  ]) {
    const block = new RegExp(`${service}:[\\s\\S]*?(?=\\n  [a-z][a-z0-9-]+:|$)`).exec(compose)?.[0] || '';
    assert.doesNotMatch(block, /user:\s*"0:0"/, `${service} must not inherit the receipt-reader exception`);
  }
  const releaseCompose = await readFile(resolve(root, 'ops/compose/compose.release.yml'), 'utf8');
  assert.doesNotMatch(releaseCompose, /schema-baseline-ledger|BOOKING_SCHEMA_BASELINE/);
  const productionMigration = /^  schema-migrate:[\s\S]*?(?=\n  [a-z][a-z0-9-]+:|(?![\s\S]))/m.exec(releaseCompose)?.[0] || '';
  assert.match(productionMigration, /user:\s*"0:0"/, 'production migration must own its root-only backup receipt');
  assert.match(productionMigration, /<<:\s*\*backend-common/, 'production migration must retain the hardened backend anchor');
  const executor = await readFile(resolve(root, 'ops/release/execute-fenced-action.mjs'), 'utf8');
  assert.match(executor, /\[\.\.\.composePrefix, '--profile', '\*', 'config', '--format', 'json'\]/,
    'rendered admission must activate every one-shot Compose profile');
});

async function withProbeServer(manifest, callback) {
  const digest = sha256(manifest);
  const server = createServer((request, response) => {
    response.setHeader('cache-control', 'no-store');
    if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>fixture</title>');
      return;
    }
    const bodies = {
      [manifest.probes.live]: { status: 'up', releaseId: manifest.releaseId, slot: 'green' },
      [manifest.probes.ready]: {
        status: 'ready',
        releaseId: manifest.releaseId,
        slot: 'green',
        checks: { postgres: 'up', redis: 'up', migrationFloor: 'satisfied', config: 'valid', workerRole: 'standby' },
      },
      [manifest.probes.version]: { status: 'up', releaseId: manifest.releaseId, slot: 'green', manifestDigest: digest },
      '/__ops/readyz': { status: 'ready', releaseId: manifest.releaseId, slot: 'green' },
      '/__ops/version': { status: 'up', releaseId: manifest.releaseId, slot: 'green', manifestDigest: digest },
    };
    if (!bodies[request.url]) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(bodies[request.url]));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('slot probe requires liveness, readiness, and exact release identity', async () => {
  const [manifest] = await fixtures();
  await withProbeServer(manifest, async (baseUrl) => {
    const result = await probeSlot({ baseUrl, manifest, slot: 'green', timeoutMs: 1000 });
    assert.equal(result.status, 'pass');
    assert.equal(result.checks.length, 3);

    const wrongSlot = await probeSlot({ baseUrl, manifest, slot: 'blue', timeoutMs: 1000 });
    assert.equal(wrongSlot.status, 'fail');
  });
});

test('ingress probe verifies public identity without sending a webhook request', async () => {
  const [manifest, ingress] = await fixtures();
  await withProbeServer(manifest, async (localBaseUrl) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const requested = new URL(input);
      const local = new URL(localBaseUrl);
      requested.protocol = local.protocol;
      requested.hostname = local.hostname;
      requested.port = local.port;
      return originalFetch(requested, init);
    };
    try {
      const result = await probeIngress({
        baseUrl: `https://${ingress.hostname}`,
        manifest,
        ingress,
        timeoutMs: 1000,
      });
      assert.equal(result.status, 'pass');
      assert.equal(result.checks.at(-1).code, 'DECLARATION_ONLY_NO_WEBHOOK_REQUEST');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
