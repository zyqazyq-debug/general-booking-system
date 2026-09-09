import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runSingletonAction } from '../release/manage-preprod-singletons.mjs';
import { LEGACY_OLD_BINDING } from '../release/lib/legacy-preprod.mjs';

const ID = (value) => value.repeat(64);
const IMAGE_ID = `sha256:${'c'.repeat(64)}`;
const ARGS = {
  action: 'transfer', project: 'booking-preprod', 'target-slot': 'blue', 'source-slot': 'green',
  'release-id': 'booking-20260909T120000Z-bbbbbbbb', 'git-sha': 'b'.repeat(40),
  'manifest-digest': `sha256:${'d'.repeat(64)}`, 'backend-image': 'registry.test/booking/backend', 'backend-digest': IMAGE_ID,
  'source-release-id': 'booking-20260908T120000Z-aaaaaaaa', 'source-git-sha': 'a'.repeat(40),
  'source-manifest-digest': `sha256:${'a'.repeat(64)}`, 'source-backend-image': 'registry.test/booking/backend', 'source-backend-digest': IMAGE_ID,
};

function env(values) { return Object.entries(values).map(([key, value]) => `${key}=${value}`); }

function api(slot, id = ID(slot === 'blue' ? '1' : '2'), actionArgs = ARGS) {
  const identity = slot === actionArgs['target-slot']
    ? { release: actionArgs['release-id'], git: actionArgs['git-sha'], manifest: actionArgs['manifest-digest'] }
    : { release: actionArgs['source-release-id'], git: actionArgs['source-git-sha'], manifest: actionArgs['source-manifest-digest'] };
  return { id, image: IMAGE_ID, project: 'booking-preprod', service: `backend-${slot}`,
    env: env({ BOOKING_RELEASE_ID: identity.release, BOOKING_GIT_SHA: identity.git, BOOKING_MANIFEST_DIGEST: identity.manifest,
      BOOKING_WORKERS_ENABLED: 'false', ORDER_OUTBOX_DISPATCH_ENABLED: 'false' }), portBindings: {}, ports: {}, status: 'running', health: 'healthy' };
}

function worker(slot, status = 'running', overrides = {}) {
  return { id: ID(slot === 'blue' ? '3' : '4'), image: IMAGE_ID, project: 'booking-preprod', service: `order-worker-${slot}`,
    env: env({ BOOKING_RELEASE_ID: ARGS['release-id'], BOOKING_GIT_SHA: ARGS['git-sha'], BOOKING_MANIFEST_DIGEST: ARGS['manifest-digest'],
      BOOKING_SLOT: slot, BOOKING_RUNTIME_ROLE: 'worker', BOOKING_WORKERS_ENABLED: 'true', ORDER_OUTBOX_DISPATCH_ENABLED: 'true',
      TELEGRAM_BOT_MODE: 'polling', TELEGRAM_ENABLE_WEBHOOK: 'false', TELEGRAM_POLLING_DELETE_WEBHOOK_ON_STARTUP: 'false' }),
    portBindings: {}, ports: { '3001/tcp': null }, status, health: status === 'running' ? 'healthy' : '', ...overrides };
}

async function fixture() {
  const releaseRoot = await mkdtemp(join(tmpdir(), 'booking-singletons-'));
  const directory = join(releaseRoot, ARGS['release-id'], 'ops', 'compose');
  await mkdir(directory, { recursive: true });
  const composeFile = join(directory, 'compose.preprod.yml');
  await writeFile(composeFile, 'services: {}\n');
  return { releaseRoot, composeFile };
}

function mockRuntime(fixtureValue, initial, options = {}) {
  const containers = new Map(initial.map((item) => [item.id, structuredClone(item)]));
  const calls = [];
  const services = options.services || ['backend-blue', 'backend-green', 'order-worker-blue', 'order-worker-green'];
  const runner = async (_executable, argv) => {
    calls.push([...argv]);
    if (argv.includes('config') && argv.includes('--services')) return ok(services.join('\n'));
    if (argv[0] === 'image' && argv[1] === 'inspect') {
      const actionArgs = options.actionArgs || ARGS;
      const source = String(argv.at(-1)).endsWith(`:${actionArgs['source-release-id']}`);
      if (argv.at(-1) === LEGACY_OLD_BINDING.uniqueTag) {
        return ok(`${JSON.stringify(LEGACY_OLD_BINDING.imageId)}|[]|${JSON.stringify([LEGACY_OLD_BINDING.uniqueTag])}|null`);
      }
      const releaseId = source ? actionArgs['source-release-id'] : actionArgs['release-id'];
      const gitSha = source ? actionArgs['source-git-sha'] : actionArgs['git-sha'];
      const labels = { 'org.opencontainers.image.revision': gitSha, 'uk.happybooking.release-id': releaseId, 'uk.happybooking.component': 'backend' };
      const id = source ? (options.sourceImageId || IMAGE_ID) : (options.imageId || IMAGE_ID);
      const repository = source ? actionArgs['source-backend-image'] : actionArgs['backend-image'];
      return ok(`${JSON.stringify(id)}|[]|${JSON.stringify([`${repository}:${releaseId}`])}|${JSON.stringify(labels)}`);
    }
    if (argv[0] === 'container' && argv[1] === 'ls') return ok([...containers.keys()].join('\n'));
    if (argv[0] === 'container' && argv[1] === 'inspect') return ok(JSON.stringify(containers.get(argv.at(-1))));
    if (argv[0] === 'container' && argv[1] === 'stop') {
      if (!options.stopLeavesRunning) containers.get(argv.at(-1)).status = 'exited';
      return ok(argv.at(-1));
    }
    if (argv.includes('up')) {
      const slot = argv.at(-1).endsWith('blue') ? 'blue' : 'green';
      const value = worker(slot, 'running', options.targetOverrides || {});
      containers.set(value.id, value);
      return ok('started');
    }
    throw new Error(`unexpected command ${argv.join(' ')}`);
  };
  return { releaseRoot: fixtureValue.releaseRoot, dockerExecutable: '/trusted/docker', commandRunner: runner,
    nowMs: Date.parse('2026-09-09T15:00:00.000Z'), calls, containers };
}

function ok(stdout = '') { return { exitCode: 0, signal: null, overflow: false, stdout, stderr: '' }; }

test('blue activation stops and proves the old worker before starting one healthy manifest-bound worker', async () => {
  const value = await fixture();
  const runtime = mockRuntime(value, [api('blue'), api('green'), worker('green')]);
  try {
    const result = await runSingletonAction({ ...ARGS, 'compose-file': value.composeFile }, runtime);
    assert.equal(result.targetService, 'order-worker-blue');
    assert.equal(result.workerHealth, 'healthy');
    const stop = runtime.calls.findIndex((argv) => argv[0] === 'container' && argv[1] === 'stop');
    const up = runtime.calls.findIndex((argv) => argv.includes('up'));
    assert.ok(stop >= 0 && up > stop);
    assert.equal(runtime.calls.some((argv) => argv.includes('backend-blue') && argv.includes('up')), false);
  } finally { await rm(value.releaseRoot, { recursive: true, force: true }); }
});

test('a residual old worker after stop fails closed before target activation', async () => {
  const value = await fixture();
  const runtime = mockRuntime(value, [api('blue'), api('green'), worker('green')], { stopLeavesRunning: true });
  try {
    await assert.rejects(runSingletonAction({ ...ARGS, 'compose-file': value.composeFile }, runtime), /remains running after stop/);
    assert.equal(runtime.calls.some((argv) => argv.includes('up')), false);
  } finally { await rm(value.releaseRoot, { recursive: true, force: true }); }
});

test('two running workers are rejected without stopping or starting either', async () => {
  const value = await fixture();
  const runtime = mockRuntime(value, [api('blue'), api('green'), worker('green'), worker('blue')]);
  try {
    await assert.rejects(runSingletonAction({ ...ARGS, 'compose-file': value.composeFile }, runtime), /two singleton workers/);
    assert.equal(runtime.calls.some((argv) => argv[0] === 'container' && argv[1] === 'stop'), false);
    assert.equal(runtime.calls.some((argv) => argv.includes('up')), false);
  } finally { await rm(value.releaseRoot, { recursive: true, force: true }); }
});

test('worker image, flags, and host-port drift are rejected by real container readback', async () => {
  const cases = [
    { targetOverrides: { image: `sha256:${'e'.repeat(64)}` }, pattern: /image drifted/ },
    { targetOverrides: { env: env({ BOOKING_RELEASE_ID: ARGS['release-id'], BOOKING_GIT_SHA: ARGS['git-sha'], BOOKING_MANIFEST_DIGEST: ARGS['manifest-digest'], BOOKING_SLOT: 'blue', BOOKING_RUNTIME_ROLE: 'worker', BOOKING_WORKERS_ENABLED: 'false', ORDER_OUTBOX_DISPATCH_ENABLED: 'true', TELEGRAM_BOT_MODE: 'polling', TELEGRAM_ENABLE_WEBHOOK: 'false', TELEGRAM_POLLING_DELETE_WEBHOOK_ON_STARTUP: 'false' }) }, pattern: /BOOKING_WORKERS_ENABLED drifted/ },
    { targetOverrides: { portBindings: { '3001/tcp': [{ HostPort: '19001' }] } }, pattern: /must not publish host ports/ },
  ];
  for (const item of cases) {
    const value = await fixture();
    const runtime = mockRuntime(value, [api('blue'), api('green')], item);
    try { await assert.rejects(runSingletonAction({ ...ARGS, 'compose-file': value.composeFile }, runtime), item.pattern); }
    finally { await rm(value.releaseRoot, { recursive: true, force: true }); }
  }
});

test('receipt replay readback never executes stop or compose up', async () => {
  const value = await fixture();
  const runtime = mockRuntime(value, [api('blue'), api('green'), worker('blue')]);
  try {
    const result = await runSingletonAction({ ...ARGS, 'compose-file': value.composeFile, readback: 'true' }, runtime);
    assert.equal(result.workerHealth, 'healthy');
    assert.equal(runtime.calls.some((argv) => argv[0] === 'container' && argv[1] === 'stop'), false);
    assert.equal(runtime.calls.some((argv) => argv.includes('up')), false);
  } finally { await rm(value.releaseRoot, { recursive: true, force: true }); }
});

test('first transfer permits the missing outbox flag only for the exact observed legacy green source', async () => {
  const value = await fixture();
  const legacyArgs = { ...ARGS, 'source-release-id': LEGACY_OLD_BINDING.releaseId, 'source-git-sha': LEGACY_OLD_BINDING.gitSha,
    'source-manifest-digest': LEGACY_OLD_BINDING.manifestRawDigest, 'source-backend-image': LEGACY_OLD_BINDING.manifestRepository,
    'source-backend-digest': LEGACY_OLD_BINDING.imageId, 'compose-file': value.composeFile };
  const legacyGreen = api('green', ID('2'), legacyArgs);
  legacyGreen.image = LEGACY_OLD_BINDING.imageId;
  legacyGreen.env = legacyGreen.env.filter((item) => !item.startsWith('ORDER_OUTBOX_DISPATCH_ENABLED='));
  const runtime = mockRuntime(value, [api('blue', ID('1'), legacyArgs), legacyGreen], { actionArgs: legacyArgs, sourceImageId: LEGACY_OLD_BINDING.imageId, legacySource: true });
  try {
    const result = await runSingletonAction(legacyArgs, runtime);
    assert.equal(result.legacySourceNoOutbox, true);
    const wrong = { ...legacyArgs, 'source-manifest-digest': `sha256:${'e'.repeat(64)}` };
    await assert.rejects(runSingletonAction({ ...wrong, readback: 'true' }, { ...runtime, calls: [] }), /drifted|missing|image does not match/);
  } finally { await rm(value.releaseRoot, { recursive: true, force: true }); }
});

test('rollback to a legacy release without a worker service stops the failed worker and proves zero workers', async () => {
  const value = await fixture();
  const legacyDirectory = join(value.releaseRoot, LEGACY_OLD_BINDING.releaseId, 'ops', 'compose');
  await mkdir(legacyDirectory, { recursive: true });
  const legacyCompose = join(legacyDirectory, 'compose.preprod.yml');
  await writeFile(legacyCompose, 'services: {}\n');
  const rollbackArgs = { ...ARGS, action: 'rollback', 'target-slot': 'green', 'source-slot': 'blue',
    'release-id': LEGACY_OLD_BINDING.releaseId, 'git-sha': LEGACY_OLD_BINDING.gitSha, 'manifest-digest': LEGACY_OLD_BINDING.manifestRawDigest,
    'backend-image': LEGACY_OLD_BINDING.manifestRepository, 'backend-digest': LEGACY_OLD_BINDING.imageId,
    'source-release-id': ARGS['release-id'], 'source-git-sha': ARGS['git-sha'], 'source-manifest-digest': ARGS['manifest-digest'],
    'compose-file': legacyCompose };
  const legacyGreen = api('green', ID('2'), rollbackArgs);
  legacyGreen.image = LEGACY_OLD_BINDING.imageId;
  legacyGreen.env = legacyGreen.env.filter((item) => !item.startsWith('ORDER_OUTBOX_DISPATCH_ENABLED='));
  const runtime = mockRuntime(value, [api('blue', ID('1'), rollbackArgs), legacyGreen, worker('blue')],
    { services: ['backend-blue', 'backend-green'], actionArgs: rollbackArgs });
  try {
    const result = await runSingletonAction(rollbackArgs, runtime);
    assert.equal(result.targetSupported, false);
    assert.equal(result.workerHealth, 'absent');
    assert.equal(result.legacyTargetNoOutbox, true);
    assert.equal(runtime.calls.some((argv) => argv.includes('up')), false);
  } finally { await rm(value.releaseRoot, { recursive: true, force: true }); }
});

test('production and path scope escapes are rejected before Docker', async () => {
  const value = await fixture();
  let calls = 0;
  try {
    await assert.rejects(runSingletonAction({ ...ARGS, project: 'booking-prod', 'compose-file': value.composeFile }, {
      releaseRoot: value.releaseRoot, dockerExecutable: '/trusted/docker', commandRunner: async () => { calls += 1; return ok(); },
    }), /scope is invalid/);
    await assert.rejects(runSingletonAction({ ...ARGS, 'compose-file': 'relative.yml' }, {
      releaseRoot: value.releaseRoot, dockerExecutable: '/trusted/docker', commandRunner: async () => { calls += 1; return ok(); },
    }), /must be absolute/);
    assert.equal(calls, 0);
  } finally { await rm(value.releaseRoot, { recursive: true, force: true }); }
});
