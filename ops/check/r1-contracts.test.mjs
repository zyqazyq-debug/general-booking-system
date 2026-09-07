import assert from 'node:assert/strict';
import { once } from 'node:events';
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
