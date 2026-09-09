import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_TUNNEL_ID, PREPROD_HOSTNAME, PREPROD_PROJECT, runIngressHelper,
} from '../release/switch-preprod-ingress.mjs';

const SECRET = 'cf_test_secret_that_must_never_escape';
const RELEASE = 'booking-20260909T120000Z-bbbbbbbb';
const MANIFEST = `sha256:${'a'.repeat(64)}`;
const MUTATION_ARGS = ['--project', PREPROD_PROJECT, '--hostname', PREPROD_HOSTNAME, '--upstream', 'gateway-blue:8080',
  '--release', RELEASE, '--manifest-digest', MANIFEST, '--operation-id', 'op-1', '--fencing-epoch', '7'];

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function envelope(config, version) {
  return { success: true, errors: [], messages: [], result: {
    account_id: CLOUDFLARE_ACCOUNT_ID, tunnel_id: CLOUDFLARE_TUNNEL_ID, source: 'cloudflare', version, config,
  } };
}

function response(value, status = 200, etag = null) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(value), headers: { get: (name) => name === 'etag' ? etag : null } };
}

function mockCloudflare(initialConfig, hooks = {}) {
  let config = clone(initialConfig);
  let version = 3;
  let gets = 0;
  const calls = [];
  return {
    calls,
    setState(nextConfig, nextVersion = version + 1) { config = clone(nextConfig); version = nextVersion; },
    fetch: async (url, options) => {
      calls.push({ url, method: options.method, body: options.body || null, hasAuthorization: Boolean(options.headers.Authorization), ifMatch: options.headers['If-Match'] || null });
      if (options.method === 'GET') {
        gets += 1;
        if (hooks.beforeGet) ({ config, version } = hooks.beforeGet({ config: clone(config), version, gets }) || { config, version });
        return response(envelope(clone(config), version), 200, `\"v${version}\"`);
      }
      const requested = JSON.parse(options.body).config;
      if (hooks.beforePut) ({ config, version } = hooks.beforePut({ config: clone(config), version, requested: clone(requested) }) || { config, version });
      config = clone(requested);
      version += 1;
      if (hooks.afterPut) ({ config, version } = hooks.afterPut({ config: clone(config), version }) || { config, version });
      return response(envelope(clone(config), version), 200, `\"v${version}\"`);
    },
  };
}

async function fixture(api) {
  const root = await mkdtemp(join(tmpdir(), 'booking-ingress-helper-'));
  const state = join(root, 'state');
  await mkdir(state);
  await chmod(state, 0o700);
  const tokenFile = join(root, 'token');
  await writeFile(tokenFile, `${SECRET}\n`, { mode: 0o600 });
  return {
    root,
    proofFile: join(state, 'proof.json'),
    runtime: { tokenFile, proofFile: join(state, 'proof.json'), lockFile: join(state, 'helper.lock'), allowInsecureTestPaths: true,
      fetchImpl: api.fetch, now: () => new Date('2026-09-09T15:05:00.000Z') },
  };
}

function baseConfig() {
  return {
    ingress: [
      { hostname: PREPROD_HOSTNAME, path: '/kept', service: 'http://gateway-green:8080', originRequest: { connectTimeout: 10, httpHostHeader: 'kept.example' } },
      { hostname: 'unrelated.example.net', service: 'https://unchanged:8443', originRequest: { noTLSVerify: false } },
      { service: 'http_status:404' },
    ],
    originRequest: { keepAliveConnections: 97 },
    'warp-routing': { enabled: false },
  };
}

test('updates only the pinned hostname service and independently reads back a release-bound proof', async () => {
  const before = baseConfig();
  const api = mockCloudflare(before);
  const fx = await fixture(api);
  try {
    const result = await runIngressHelper(MUTATION_ARGS, fx.runtime);
    assert.deepEqual(Object.keys(result).sort(), ['schema', 'project', 'hostname', 'upstream', 'releaseId', 'manifestDigest', 'operationId', 'fencingEpoch', 'observedAt'].sort());
    assert.equal(result.upstream, 'gateway-blue:8080');
    const put = api.calls.find((call) => call.method === 'PUT');
    const sent = JSON.parse(put.body).config;
    assert.equal(sent.ingress[0].service, 'http://gateway-blue:8080');
    assert.deepEqual({ ...sent.ingress[0], service: before.ingress[0].service }, before.ingress[0]);
    assert.deepEqual(sent.ingress.slice(1), before.ingress.slice(1));
    assert.deepEqual(sent.originRequest, before.originRequest);
    assert.deepEqual(sent['warp-routing'], before['warp-routing']);
    assert.equal(put.ifMatch, '"v3"');

    const readback = await runIngressHelper(['--readback', '--project', PREPROD_PROJECT, '--hostname', PREPROD_HOSTNAME], fx.runtime);
    assert.equal(readback.releaseId, RELEASE);
    assert.equal(readback.manifestDigest, MANIFEST);
    assert.equal(readback.operationId, 'op-1');
    assert.equal(readback.fencingEpoch, 7);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('rejects concurrent configuration drift between guarded GETs before PUT', async () => {
  const api = mockCloudflare(baseConfig(), { beforeGet: ({ config, version, gets }) => {
    if (gets === 2) { config.ingress[1].service = 'https://concurrent:9443'; version += 1; }
    return { config, version };
  } });
  const fx = await fixture(api);
  try {
    await assert.rejects(runIngressHelper(MUTATION_ARGS, fx.runtime), /changed during guarded preflight/);
    assert.equal(api.calls.some((call) => call.method === 'PUT'), false);
    await assert.rejects(readFile(fx.proofFile, 'utf8'));
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('rejects drift after PUT and does not create a local proof', async () => {
  const api = mockCloudflare(baseConfig(), { beforeGet: ({ config, version, gets }) => {
    if (gets === 3) { config.ingress[1].service = 'https://post-put-drift:9443'; version += 1; }
    return { config, version };
  } });
  const fx = await fixture(api);
  try {
    await assert.rejects(runIngressHelper(MUTATION_ARGS, fx.runtime), /changed before post-update readback/);
    await assert.rejects(readFile(fx.proofFile, 'utf8'));
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('rejects every caller-controlled scope escape before a network request', async () => {
  const cases = [
    MUTATION_ARGS.map((value) => value === PREPROD_PROJECT ? 'booking-prod' : value),
    MUTATION_ARGS.map((value) => value === PREPROD_HOSTNAME ? 'app.happybooking.uk' : value),
    MUTATION_ARGS.map((value) => value === 'gateway-blue:8080' ? 'backend-blue:8080' : value),
    [...MUTATION_ARGS, '--tunnel-id', CLOUDFLARE_TUNNEL_ID],
  ];
  for (const argv of cases) {
    const api = mockCloudflare(baseConfig());
    await assert.rejects(runIngressHelper(argv, { fetchImpl: api.fetch }), /invalid shape|pinned|allowlist/);
    assert.equal(api.calls.length, 0);
  }
});

test('rejects a production hostname found inside the dedicated preproduction tunnel', async () => {
  const config = baseConfig();
  config.ingress.splice(1, 0, { hostname: 'app.happybooking.uk', service: 'http://production:8080' });
  const api = mockCloudflare(config);
  const fx = await fixture(api);
  try {
    await assert.rejects(runIngressHelper(MUTATION_ARGS, fx.runtime), /production hostname is forbidden/);
    assert.equal(api.calls.some((call) => call.method === 'PUT'), false);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('rejects another Cloudflare account, tunnel, source, or duplicate target rule', async () => {
  const identities = [
    { account_id: '0'.repeat(32), tunnel_id: CLOUDFLARE_TUNNEL_ID, source: 'cloudflare' },
    { account_id: CLOUDFLARE_ACCOUNT_ID, tunnel_id: '11111111-1111-4111-8111-111111111111', source: 'cloudflare' },
    { account_id: CLOUDFLARE_ACCOUNT_ID, tunnel_id: CLOUDFLARE_TUNNEL_ID, source: 'local' },
  ];
  for (const identity of identities) {
    const fx = await fixture({ fetch: async () => response({ success: true, result: { ...identity, version: 3, config: baseConfig() } }) });
    try { await assert.rejects(runIngressHelper(MUTATION_ARGS, fx.runtime), /outside the pinned preproduction tunnel/); }
    finally { await rm(fx.root, { recursive: true, force: true }); }
  }

  const duplicated = baseConfig();
  duplicated.ingress.unshift({ ...duplicated.ingress[0], path: '/duplicate' });
  const api = mockCloudflare(duplicated);
  const fx = await fixture(api);
  try { await assert.rejects(runIngressHelper(MUTATION_ARGS, fx.runtime), /exactly one ingress rule/); }
  finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('never writes the token to argv, output, proof, URL, body, or surfaced errors', async () => {
  const api = mockCloudflare(baseConfig());
  const fx = await fixture(api);
  try {
    const result = await runIngressHelper(MUTATION_ARGS, fx.runtime);
    const proof = await readFile(fx.proofFile, 'utf8');
    const publicEvidence = JSON.stringify({ argv: MUTATION_ARGS, result, proof, calls: api.calls.map(({ url, method, body }) => ({ url, method, body })) });
    assert.equal(publicEvidence.includes(SECRET), false);
    assert.equal(api.calls.every((call) => call.hasAuthorization), true);

    const failing = { ...fx.runtime, fetchImpl: async () => response({ success: false, errors: [{ message: SECRET }] }, 403) };
    await assert.rejects(runIngressHelper(['--readback', '--project', PREPROD_PROJECT, '--hostname', PREPROD_HOSTNAME], failing), (error) => {
      assert.equal(error.message.includes(SECRET), false);
      return true;
    });
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('fencing epoch cannot be reused for a different ingress identity', async () => {
  const api = mockCloudflare(baseConfig());
  const fx = await fixture(api);
  try {
    await runIngressHelper(MUTATION_ARGS, fx.runtime);
    const before = api.calls.length;
    const changedOperation = MUTATION_ARGS.map((value) => value === 'op-1' ? 'op-2' : value);
    await assert.rejects(runIngressHelper(changedOperation, fx.runtime), /already bound to another operation/);
    assert.equal(api.calls.length, before);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('readback rejects remote service or version drift from the root-owned local proof', async () => {
  const api = mockCloudflare(baseConfig());
  const fx = await fixture(api);
  try {
    await runIngressHelper(MUTATION_ARGS, fx.runtime);
    const drifted = baseConfig();
    api.setState(drifted, 5);
    await assert.rejects(runIngressHelper(['--readback', '--project', PREPROD_PROJECT, '--hostname', PREPROD_HOSTNAME], fx.runtime), /drifted from the local fenced proof/);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});
