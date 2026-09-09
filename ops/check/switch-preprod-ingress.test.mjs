import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_TUNNEL_ID, PREPROD_HOSTNAME, PREPROD_PROJECT, runIngressHelper,
} from '../release/switch-preprod-ingress.mjs';

const SECRET = 'cf_test_secret_that_must_never_escape';
const OLD_RELEASE = 'booking-20260908T120000Z-aaaaaaaa';
const CANDIDATE_RELEASE = 'booking-20260909T120000Z-bbbbbbbb';
const NEXT_RELEASE = 'booking-20260910T120000Z-cccccccc';
const OLD_MANIFEST = `sha256:${'1'.repeat(64)}`;
const CANDIDATE_MANIFEST = `sha256:${'2'.repeat(64)}`;
const NEXT_MANIFEST = `sha256:${'3'.repeat(64)}`;

function actionArgs(sequence, overrides = {}) {
  const rollback = { upstream: 'gateway-green:8080', release: OLD_RELEASE, manifest: OLD_MANIFEST };
  const candidate = { upstream: 'gateway-blue:8080', release: CANDIDATE_RELEASE, manifest: CANDIDATE_MANIFEST };
  const target = sequence === 2 ? rollback : candidate;
  const values = {
    project: PREPROD_PROJECT, hostname: PREPROD_HOSTNAME, upstream: target.upstream, release: target.release,
    manifest: target.manifest, operation: 'op-1', approval: 'approval-1', lease: 'lease-1', holder: 'holder-1',
    kind: sequence === 2 ? 'preprod-rollback-ingress' : 'preprod-switch-ingress', action: `ingress-${sequence}`,
    sequence, epoch: 7, rollbackUpstream: rollback.upstream, rollbackRelease: rollback.release, rollbackManifest: rollback.manifest,
    ...overrides,
  };
  return ['--execute', 'true', '--environment', 'preprod', '--project', values.project, '--hostname', values.hostname, '--upstream', values.upstream,
    '--release', values.release, '--manifest-digest', values.manifest, '--operation-id', values.operation,
    '--approval-id', values.approval, '--lease-id', values.lease, '--holder-id', values.holder,
    '--action-kind', values.kind, '--action-id', values.action, '--sequence', String(values.sequence),
    '--fencing-epoch', String(values.epoch), '--rollback-upstream', values.rollbackUpstream,
    '--rollback-release', values.rollbackRelease, '--rollback-manifest-digest', values.rollbackManifest];
}

const FIRST_PROMOTION = actionArgs(1);
const READBACK_ARGS = ['--readback', '--project', PREPROD_PROJECT, '--hostname', PREPROD_HOSTNAME];

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function envelope(config, version, identity = {}) {
  return { success: true, errors: [], messages: [], result: {
    account_id: CLOUDFLARE_ACCOUNT_ID, tunnel_id: CLOUDFLARE_TUNNEL_ID, source: 'cloudflare', version, config, ...identity,
  } };
}

function response(value, status = 200, etag = null) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(value),
    headers: { get: (name) => name === 'etag' ? etag : null } };
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
      calls.push({ url, method: options.method, body: options.body || null,
        hasAuthorization: Boolean(options.headers.Authorization), ifMatch: options.headers['If-Match'] || null });
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
  const proofFile = join(state, 'proof.json');
  const proofArchiveDirectory = join(state, 'proofs');
  return {
    root, proofFile, proofArchiveDirectory,
    runtime: { tokenFile, proofFile, proofArchiveDirectory, lockFile: join(state, 'helper.lock'), allowInsecureTestPaths: true,
      fetchImpl: api.fetch, now: () => new Date('2026-09-09T15:05:00.000Z') },
  };
}

function baseConfig() {
  return {
    ingress: [
      { hostname: PREPROD_HOSTNAME, service: 'http://gateway-green:8080', originRequest: { connectTimeout: 10, httpHostHeader: 'kept.example' } },
      { service: 'http_status:404' },
    ],
    originRequest: { keepAliveConnections: 97 },
    'warp-routing': { enabled: false },
  };
}

async function archiveProofs(fx) {
  const names = (await readdir(fx.proofArchiveDirectory)).sort();
  return Promise.all(names.map(async (name) => ({ name, proof: JSON.parse(await readFile(join(fx.proofArchiveDirectory, name), 'utf8')) })));
}

test('binds candidate to rollback to identical candidate in one operation and fencing epoch', async () => {
  const api = mockCloudflare(baseConfig());
  const fx = await fixture(api);
  try {
    const first = await runIngressHelper(actionArgs(1), fx.runtime);
    const rollback = await runIngressHelper(actionArgs(2), fx.runtime);
    const second = await runIngressHelper(actionArgs(3), fx.runtime);

    assert.equal(first.sequence, 1);
    assert.equal(rollback.sequence, 2);
    assert.equal(second.sequence, 3);
    assert.equal(first.releaseId, second.releaseId);
    assert.equal(first.manifestDigest, second.manifestDigest);
    assert.equal(first.upstream, second.upstream);
    assert.equal(rollback.releaseId, OLD_RELEASE);
    assert.equal(api.calls.filter((call) => call.method === 'PUT').length, 3);
    assert.equal(api.calls.filter((call) => call.method === 'PUT').every((call) => call.ifMatch), true);
    const firstPut = JSON.parse(api.calls.find((call) => call.method === 'PUT').body).config;
    assert.deepEqual({ ...firstPut.ingress[0], service: 'http://gateway-green:8080' }, baseConfig().ingress[0]);
    assert.deepEqual(firstPut.ingress.slice(1), baseConfig().ingress.slice(1));
    assert.deepEqual(firstPut.originRequest, baseConfig().originRequest);
    assert.deepEqual(firstPut['warp-routing'], baseConfig()['warp-routing']);

    const proofs = await archiveProofs(fx);
    assert.equal(proofs.length, 3);
    assert.equal(proofs[0].proof.previousProofDigest, null);
    assert.equal(proofs[1].proof.previousProofDigest, proofs[0].proof.proofDigest);
    assert.equal(proofs[2].proof.previousProofDigest, proofs[1].proof.proofDigest);
    assert.equal(JSON.parse(await readFile(fx.proofFile, 'utf8')).proofDigest, proofs[2].proof.proofDigest);

    const readback = await runIngressHelper(READBACK_ARGS, fx.runtime);
    for (const key of ['proofDigest', 'remoteVersion', 'remoteConfigDigest', 'guard', 'approvalId', 'leaseId', 'holderId',
      'actionKind', 'actionId', 'sequence', 'rollbackUpstream', 'rollbackReleaseId', 'rollbackManifestDigest']) {
      assert.ok(Object.hasOwn(readback, key), `${key} must be present in independently bindable readback`);
    }
    assert.equal(readback.schema, 'booking.ingress-readback/v2');
    assert.equal(readback.proofDigest, second.proofDigest);
    assert.deepEqual(readback.guard, { mode: 'double-read-version-and-digest', atomicRemoteCas: false,
      opportunisticIfMatch: true, exclusiveWriteRequired: true });
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('an exact replay is read-only and remote drift fails closed', async () => {
  const api = mockCloudflare(baseConfig());
  const fx = await fixture(api);
  try {
    const first = await runIngressHelper(FIRST_PROMOTION, fx.runtime);
    const beforeReplay = api.calls.length;
    const replay = await runIngressHelper(FIRST_PROMOTION, fx.runtime);
    assert.equal(api.calls.length, beforeReplay + 1);
    assert.equal(api.calls.slice(beforeReplay).every((call) => call.method === 'GET'), true);
    assert.equal((await archiveProofs(fx)).length, 1);
    assert.equal(replay.proofDigest, first.proofDigest);

    const drifted = baseConfig();
    api.setState(drifted, first.remoteVersion + 1);
    await assert.rejects(runIngressHelper(FIRST_PROMOTION, fx.runtime), /drifted from the local fenced proof/);
    assert.equal((await archiveProofs(fx)).length, 1);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('pending recovery proves an already-applied PUT without repeating mutation and distinguishes not-applied', async () => {
  const appliedConfig = baseConfig();
  appliedConfig.ingress[0].service = 'http://gateway-blue:8080';
  const appliedApi = mockCloudflare(baseConfig());
  appliedApi.setState(appliedConfig, 4);
  const appliedFx = await fixture(appliedApi);
  try {
    const recovered = await runIngressHelper([...FIRST_PROMOTION, '--recover-pending', 'true'], appliedFx.runtime);
    assert.equal(recovered.schema, 'booking.ingress-readback/v2');
    assert.equal(recovered.actionId, 'ingress-1');
    assert.equal(recovered.upstream, 'gateway-blue:8080');
    assert.equal(appliedApi.calls.every((call) => call.method === 'GET'), true);
    assert.equal((await archiveProofs(appliedFx)).length, 1);
  } finally { await rm(appliedFx.root, { recursive: true, force: true }); }

  const untouchedApi = mockCloudflare(baseConfig());
  const untouchedFx = await fixture(untouchedApi);
  try {
    const result = await runIngressHelper([...FIRST_PROMOTION, '--recover-pending', 'true'], untouchedFx.runtime);
    assert.equal(result.schema, 'booking.ingress-pending-recovery/v1');
    assert.equal(result.outcome, 'not-applied');
    assert.equal(result.expectedPreviousUpstream, 'gateway-green:8080');
    assert.equal(untouchedApi.calls.every((call) => call.method === 'GET'), true);
    await assert.rejects(readdir(untouchedFx.proofArchiveDirectory), /ENOENT/);
  } finally { await rm(untouchedFx.root, { recursive: true, force: true }); }
});

test('same epoch rejects another operation, holder, lease, approval, repeated or skipped sequence before network', async () => {
  const api = mockCloudflare(baseConfig());
  const fx = await fixture(api);
  try {
    await runIngressHelper(actionArgs(1), fx.runtime);
    for (const argv of [
      actionArgs(2, { operation: 'op-2' }), actionArgs(2, { holder: 'holder-old' }), actionArgs(2, { lease: 'lease-old' }),
      actionArgs(2, { approval: 'approval-old' }), actionArgs(1, { action: 'repeat-sequence' }), actionArgs(3),
    ]) {
      const before = api.calls.length;
      await assert.rejects(runIngressHelper(argv, fx.runtime), /canonical operation sequence/);
      assert.equal(api.calls.length, before);
    }
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('rejects a false rollback target, a candidate equal to baseline, and a different second candidate', async () => {
  for (const scenario of ['false-rollback', 'candidate-is-baseline', 'different-second-candidate']) {
    const api = mockCloudflare(baseConfig());
    const fx = await fixture(api);
    try {
      if (scenario !== 'candidate-is-baseline') await runIngressHelper(actionArgs(1), fx.runtime);
      if (scenario === 'different-second-candidate') await runIngressHelper(actionArgs(2), fx.runtime);
      const argv = scenario === 'false-rollback'
        ? actionArgs(2, { upstream: 'gateway-blue:8080', release: CANDIDATE_RELEASE, manifest: CANDIDATE_MANIFEST })
        : scenario === 'candidate-is-baseline'
          ? actionArgs(1, { upstream: 'gateway-green:8080', release: OLD_RELEASE, manifest: OLD_MANIFEST })
          : actionArgs(3, { release: NEXT_RELEASE, manifest: NEXT_MANIFEST });
      const before = api.calls.length;
      await assert.rejects(runIngressHelper(argv, fx.runtime), /rollback target|candidate target|second promotion/);
      assert.equal(api.calls.length, before);
    } finally { await rm(fx.root, { recursive: true, force: true }); }
  }
});

test('stale epochs and a new epoch with a false active baseline fail before network', async () => {
  const api = mockCloudflare(baseConfig());
  const fx = await fixture(api);
  try {
    await runIngressHelper(actionArgs(1), fx.runtime);
    for (const argv of [
      actionArgs(1, { epoch: 6, operation: 'stale-op', action: 'stale-action' }),
      actionArgs(1, { epoch: 8, operation: 'op-2', approval: 'approval-2', lease: 'lease-2', holder: 'holder-2', action: 'next-action' }),
    ]) {
      const before = api.calls.length;
      await assert.rejects(runIngressHelper(argv, fx.runtime), /stale|completed cycle/);
      assert.equal(api.calls.length, before);
    }
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('a new epoch can only start from the exact previously proven active release', async () => {
  const api = mockCloudflare(baseConfig());
  const fx = await fixture(api);
  try {
    await runIngressHelper(actionArgs(1), fx.runtime);
    await runIngressHelper(actionArgs(2), fx.runtime);
    await runIngressHelper(actionArgs(3), fx.runtime);
    const result = await runIngressHelper(actionArgs(1, {
      epoch: 8, operation: 'op-2', approval: 'approval-2', lease: 'lease-2', holder: 'holder-2', action: 'next-action',
      upstream: 'gateway-green:8080', release: NEXT_RELEASE, manifest: NEXT_MANIFEST,
      rollbackUpstream: 'gateway-blue:8080', rollbackRelease: CANDIDATE_RELEASE, rollbackManifest: CANDIDATE_MANIFEST,
    }), fx.runtime);
    assert.equal(result.fencingEpoch, 8);
    assert.equal(result.sequence, 1);
    assert.equal(result.releaseId, NEXT_RELEASE);
    assert.equal((await archiveProofs(fx)).length, 4);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('mid-cycle takeover adopts exact applied targets and continues the same operation without backward or skipped steps', async () => {
  const api = mockCloudflare(baseConfig());
  const fx = await fixture(api);
  try {
    await runIngressHelper(actionArgs(1), fx.runtime);
    const callsBeforeRejected = api.calls.length;
    await assert.rejects(runIngressHelper(actionArgs(1, { epoch: 8, approval: 'approval-2', lease: 'lease-2',
      holder: 'holder-1', action: 'ingress-1-adopt-old-holder' }), fx.runtime), /takeover ingress action/);
    assert.equal(api.calls.length, callsBeforeRejected);

    const takeover1 = { epoch: 8, approval: 'approval-2', lease: 'lease-2', holder: 'holder-2' };
    const adopted1 = await runIngressHelper(actionArgs(1, { ...takeover1, action: 'ingress-1-adopt' }), fx.runtime);
    assert.equal(adopted1.sequence, 1);
    assert.equal(adopted1.remoteVersion, 4);
    const rolledBack = await runIngressHelper(actionArgs(2, { ...takeover1, action: 'ingress-2-takeover' }), fx.runtime);
    assert.equal(rolledBack.sequence, 2);

    const takeover2 = { epoch: 9, approval: 'approval-3', lease: 'lease-3', holder: 'holder-3' };
    const adopted2 = await runIngressHelper(actionArgs(2, { ...takeover2, action: 'ingress-2-adopt' }), fx.runtime);
    assert.equal(adopted2.sequence, 2);
    assert.equal(adopted2.remoteVersion, rolledBack.remoteVersion);
    await assert.rejects(runIngressHelper(actionArgs(1, { ...takeover2, action: 'ingress-backward' }), fx.runtime), /outside the canonical operation sequence/);
    const promotedAgain = await runIngressHelper(actionArgs(3, { ...takeover2, action: 'ingress-3-takeover' }), fx.runtime);
    assert.equal(promotedAgain.sequence, 3);
    assert.equal(promotedAgain.releaseId, CANDIDATE_RELEASE);
    assert.equal(api.calls.filter((call) => call.method === 'PUT').length, 3);
    assert.equal((await archiveProofs(fx)).length, 5);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('rejects path-specific, non-leading, duplicate, or missing-fallback target rules', async () => {
  const configurations = [];
  const pathSpecific = baseConfig();
  pathSpecific.ingress[0].path = '/api/*';
  configurations.push(pathSpecific);
  const nonLeading = baseConfig();
  nonLeading.ingress.unshift({ hostname: 'earlier.example.net', service: 'https://earlier:8443' });
  configurations.push(nonLeading);
  const duplicate = baseConfig();
  duplicate.ingress.splice(1, 0, { hostname: PREPROD_HOSTNAME, service: 'http://gateway-green:8080' });
  configurations.push(duplicate);
  const badFallback = baseConfig();
  badFallback.ingress.at(-1).service = 'http_status:503';
  configurations.push(badFallback);

  for (const config of configurations) {
    const api = mockCloudflare(config);
    const fx = await fixture(api);
    try {
      await assert.rejects(runIngressHelper(FIRST_PROMOTION, fx.runtime), /first pathless|exactly one|exact pathless 404 fallback|exactly the hostname rule/);
      assert.equal(api.calls.some((call) => call.method === 'PUT'), false);
    } finally { await rm(fx.root, { recursive: true, force: true }); }
  }
});

test('rejects concurrent configuration drift between guarded GETs before PUT', async () => {
  const api = mockCloudflare(baseConfig(), { beforeGet: ({ config, version, gets }) => {
    if (gets === 2) { config.ingress[0].originRequest.connectTimeout = 11; version += 1; }
    return { config, version };
  } });
  const fx = await fixture(api);
  try {
    await assert.rejects(runIngressHelper(FIRST_PROMOTION, fx.runtime), /changed during guarded preflight/);
    assert.equal(api.calls.some((call) => call.method === 'PUT'), false);
    await assert.rejects(readFile(fx.proofFile, 'utf8'));
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('rejects drift after PUT and does not create a local proof', async () => {
  const api = mockCloudflare(baseConfig(), { beforeGet: ({ config, version, gets }) => {
    if (gets === 3) { config.ingress[0].originRequest.connectTimeout = 12; version += 1; }
    return { config, version };
  } });
  const fx = await fixture(api);
  try {
    await assert.rejects(runIngressHelper(FIRST_PROMOTION, fx.runtime), /changed before post-update readback/);
    await assert.rejects(readFile(fx.proofFile, 'utf8'));
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('archive tampering and a missing predecessor both fail before remote readback', async () => {
  for (const mutation of ['tamper', 'remove-predecessor']) {
    const api = mockCloudflare(baseConfig());
    const fx = await fixture(api);
    try {
      await runIngressHelper(actionArgs(1), fx.runtime);
      if (mutation === 'remove-predecessor') await runIngressHelper(actionArgs(2), fx.runtime);
      const archived = await archiveProofs(fx);
      if (mutation === 'tamper') {
        archived[0].proof.upstream = 'gateway-green:8080';
        await writeFile(join(fx.proofArchiveDirectory, archived[0].name), JSON.stringify(archived[0].proof));
      } else {
        await unlink(join(fx.proofArchiveDirectory, archived[0].name));
      }
      const before = api.calls.length;
      await assert.rejects(runIngressHelper(READBACK_ARGS, fx.runtime), /failed validation|predecessor is missing/);
      assert.equal(api.calls.length, before);
    } finally { await rm(fx.root, { recursive: true, force: true }); }
  }
});

test('rejects caller scope escapes and production identity without leaking the token', async () => {
  const cases = [
    FIRST_PROMOTION.map((value) => value === 'true' ? 'false' : value),
    FIRST_PROMOTION.map((value) => value === 'preprod' ? 'production' : value),
    FIRST_PROMOTION.map((value) => value === PREPROD_PROJECT ? 'booking-prod' : value),
    FIRST_PROMOTION.map((value) => value === PREPROD_HOSTNAME ? 'app.happybooking.uk' : value),
    FIRST_PROMOTION.map((value) => value === 'gateway-blue:8080' ? 'backend-blue:8080' : value),
    [...FIRST_PROMOTION, '--tunnel-id', CLOUDFLARE_TUNNEL_ID],
  ];
  for (const argv of cases) {
    const api = mockCloudflare(baseConfig());
    await assert.rejects(runIngressHelper(argv, { fetchImpl: api.fetch }), /invalid shape|pinned|allowlist|preproduction mutation mode/);
    assert.equal(api.calls.length, 0);
  }

  const readbackWithMutationFlag = [...READBACK_ARGS, '--execute', 'true'];
  await assert.rejects(runIngressHelper(readbackWithMutationFlag, {}), /invalid shape/);

  const production = baseConfig();
  production.ingress.splice(1, 0, { hostname: 'app.happybooking.uk', service: 'http://production:8080' });
  const api = mockCloudflare(production);
  const fx = await fixture(api);
  try {
    await assert.rejects(runIngressHelper(FIRST_PROMOTION, fx.runtime), /production hostname is forbidden/);
    assert.equal(api.calls.some((call) => call.method === 'PUT'), false);

    const safeApi = mockCloudflare(baseConfig());
    fx.runtime.fetchImpl = safeApi.fetch;
    const result = await runIngressHelper(FIRST_PROMOTION, fx.runtime);
    const proof = await readFile(fx.proofFile, 'utf8');
    const publicEvidence = JSON.stringify({ argv: FIRST_PROMOTION, result, proof,
      calls: safeApi.calls.map(({ url, method, body }) => ({ url, method, body })) });
    assert.equal(publicEvidence.includes(SECRET), false);
    assert.equal(safeApi.calls.every((call) => call.hasAuthorization), true);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('rejects another Cloudflare account, tunnel, or source', async () => {
  const identities = [
    { account_id: '0'.repeat(32), tunnel_id: CLOUDFLARE_TUNNEL_ID, source: 'cloudflare' },
    { account_id: CLOUDFLARE_ACCOUNT_ID, tunnel_id: '11111111-1111-4111-8111-111111111111', source: 'cloudflare' },
    { account_id: CLOUDFLARE_ACCOUNT_ID, tunnel_id: CLOUDFLARE_TUNNEL_ID, source: 'local' },
  ];
  for (const identity of identities) {
    const fx = await fixture({ fetch: async () => response(envelope(baseConfig(), 3, identity)) });
    try { await assert.rejects(runIngressHelper(FIRST_PROMOTION, fx.runtime), /outside the pinned preproduction tunnel/); }
    finally { await rm(fx.root, { recursive: true, force: true }); }
  }
});
