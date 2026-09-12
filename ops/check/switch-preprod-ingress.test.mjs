import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EDGE_NETWORK, FIXED_REMOTE_SERVICE, LOGICAL_ALIAS, PREPROD_HOSTNAME, PREPROD_PROJECT, recoverStaleIngressLock, runIngressHelper } from '../release/switch-preprod-ingress.mjs';

const OLD_RELEASE = 'booking-20260908T202714Z-317be4dec675';
const NEW_RELEASE = 'booking-20260909T120000Z-bbbbbbbb';
const OLD_MANIFEST = `sha256:${'1'.repeat(64)}`;
const NEW_MANIFEST = `sha256:${'2'.repeat(64)}`;
const GREEN_ID = 'eb38bbd0b092d1cdc8c30e62faa400421d0764f5fc5f3997e3986f3a7b10800d';
const BLUE_ID = 'b'.repeat(64);
const GREEN_BACKEND_ID = '50dbe86316e2bdfe2b84727fe7407ef435eec3c91f3c764d605c7fc8a552d4fb';
const BLUE_BACKEND_ID = 'a'.repeat(64);
const CF_ID = '6dd504b5bdb5e5f204da97d7c34eb1043449697b7cfab1d63affd4389bf0d3b8';
const GREEN_IMAGE_ID = 'sha256:0a26e5415496cd1227d80833fa2a4bae5fdb41d558119ed2ec5d6df0b0fd5593';
const BLUE_IMAGE_ID = `sha256:${'c'.repeat(64)}`;
const GREEN_CONFIG_HASH = '67ca960d4f4dc4266ea8b003e22e26545a8f0418d3bad6e83a76be6bece8791e';
const BLUE_CONFIG_HASH = 'd'.repeat(64);
const binding = (slot) => slot === 'green'
  ? { container: GREEN_ID, backend: GREEN_BACKEND_ID, image: GREEN_IMAGE_ID, configImage: `booking-preprod-gateway:${OLD_RELEASE}`, configHash: GREEN_CONFIG_HASH }
  : { container: BLUE_ID, backend: BLUE_BACKEND_ID, image: BLUE_IMAGE_ID, configImage: `booking-preprod-gateway:${NEW_RELEASE}`, configHash: BLUE_CONFIG_HASH };
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = (value) => `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
async function forensicArtifactDigest(path) {
  const metadata = await lstat(path);
  if (metadata.isFile()) return digest({ kind: 'file', value: await readFile(path, 'utf8') });
  const entries = [];
  for (const name of (await readdir(path)).sort()) entries.push({ name, value: await readFile(join(path, name), 'utf8') });
  return digest({ kind: 'directory', entries });
}

function actionArgs(sequence, overrides = {}) {
  const rollback = { upstream: 'gateway-green:8080', release: OLD_RELEASE, manifest: OLD_MANIFEST };
  const candidate = { upstream: 'gateway-blue:8080', release: NEW_RELEASE, manifest: NEW_MANIFEST };
  const target = sequence === 2 ? rollback : candidate;
  const sourceBinding = binding(sequence === 2 ? 'blue' : 'green'); const targetBinding = binding(sequence === 2 ? 'green' : 'blue');
  const v = { ...target, operation: 'op-1', approval: 'approval-1', lease: 'lease-1', holder: 'holder-1',
    kind: sequence === 2 ? 'preprod-rollback-ingress' : 'preprod-switch-ingress', action: `ingress-${sequence}`, sequence, epoch: 7, ...overrides };
  return ['--execute', 'true', '--environment', 'preprod', '--project', PREPROD_PROJECT, '--hostname', PREPROD_HOSTNAME,
    '--upstream', v.upstream, '--release', v.release, '--manifest-digest', v.manifest, '--operation-id', v.operation,
    '--approval-id', v.approval, '--lease-id', v.lease, '--holder-id', v.holder, '--action-kind', v.kind, '--action-id', v.action,
    '--sequence', String(v.sequence), '--fencing-epoch', String(v.epoch), '--rollback-upstream', rollback.upstream,
    '--rollback-release', rollback.release, '--rollback-manifest-digest', rollback.manifest,
    '--source-container-id', sourceBinding.container, '--source-backend-container-id', sourceBinding.backend,
    '--source-image-id', sourceBinding.image, '--source-config-image', sourceBinding.configImage, '--source-config-hash', sourceBinding.configHash,
    '--target-container-id', targetBinding.container, '--target-backend-container-id', targetBinding.backend,
    '--target-image-id', targetBinding.image, '--target-config-image', targetBinding.configImage, '--target-config-hash', targetBinding.configHash];
}

function gateway(slot, id, release, image, aliases) {
  return { Id: id, Name: `/booking-preprod-gateway-${slot}-1`, Image: image, ConfigImage: `booking-preprod-gateway:${release}`,
    User: '101', Entrypoint: ['/docker-entrypoint.sh'], Cmd: ['nginx'], Labels: {
      'com.docker.compose.project': PREPROD_PROJECT, 'com.docker.compose.service': `gateway-${slot}`,
      'com.docker.compose.config-hash': slot === 'green' ? '67ca960d4f4dc4266ea8b003e22e26545a8f0418d3bad6e83a76be6bece8791e' : 'd'.repeat(64),
      ...(slot === 'blue' ? { 'uk.happybooking.release-id': release } : {}),
    }, Running: true, Health: { Status: 'healthy' }, StartedAt: '2026-09-12T10:00:00.000Z', ReadonlyRootfs: true,
    Privileged: false, CapAdd: ['NET_BIND_SERVICE'], CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'],
    PortBindings: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: slot === 'green' ? '18082' : '18083' }] }, Mounts: [],
    Networks: { [EDGE_NETWORK]: { Aliases: [...aliases] } } };
}
function cloudflared() {
  return { Id: CF_ID, Name: '/booking-preprod-cloudflared', Image: 'sha256:c1d35f78a5f68601e349d12fed690bc5cb3a0d64d0d25dd7297d415aa399c179',
    ConfigImage: 'cloudflare/cloudflared@sha256:6b599ca3e974349ead3286d178da61d291961182ec3fe9c505e1dd02c8ac31b0', User: '65532:65532',
    Entrypoint: ['cloudflared', '--no-autoupdate'], Cmd: ['tunnel', '--no-autoupdate', 'run', '--token-file', '/run/secrets/tunnel-token'], Labels: null,
    Running: true, Health: null, StartedAt: '2026-09-12T10:00:00.000Z', ReadonlyRootfs: true, Privileged: false, CapAdd: null,
    CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], PortBindings: {},
    Mounts: [{ Type: 'bind', Source: '/etc/happybooking/secrets/cloudflare-preprod-tunnel-token', Destination: '/run/secrets/tunnel-token', RW: false, Propagation: 'rprivate' }],
    Networks: { [EDGE_NETWORK]: { Aliases: ['booking-preprod-cloudflared', CF_ID.slice(0, 12)] } } };
}
function backend(slot, id) {
  return { Id: id, Name: `/booking-preprod-backend-${slot}-1`, Image: `sha256:${slot === 'green' ? '8' : '9'}`.padEnd(71, slot === 'green' ? '8' : '9'),
    ConfigImage: `booking-preprod-backend:${slot === 'green' ? OLD_RELEASE : NEW_RELEASE}`, User: 'node', Labels: {
      'com.docker.compose.project': PREPROD_PROJECT, 'com.docker.compose.service': `backend-${slot}`,
    }, Running: true, Health: { Status: 'healthy' }, StartedAt: '2026-09-12T10:00:00.000Z', ReadonlyRootfs: true,
    Privileged: false, CapAdd: null, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], PortBindings: {}, Mounts: [],
    Networks: { [EDGE_NETWORK]: { Aliases: [`backend-${slot}`, `booking-preprod-backend-${slot}-1`, id.slice(0, 12)] }, 'booking-preprod-data': { Aliases: [`backend-${slot}`] },
      ...(slot === 'blue' ? { 'booking-preprod-telegram': { Aliases: [`backend-${slot}`] } } : {}) } };
}

function dockerFixture() {
  const byId = new Map();
  for (const value of [gateway('green', GREEN_ID, OLD_RELEASE, GREEN_IMAGE_ID, ['gateway-green', 'gateway-green', 'booking-preprod-gateway-green-1', GREEN_ID.slice(0, 12)]),
    gateway('blue', BLUE_ID, NEW_RELEASE, BLUE_IMAGE_ID, ['gateway-blue', 'gateway-blue', 'booking-preprod-gateway-blue-1', BLUE_ID.slice(0, 12)]),
    backend('green', GREEN_BACKEND_ID), backend('blue', BLUE_BACKEND_ID), cloudflared()]) byId.set(value.Id, value);
  const calls = []; let failDisconnect = false; let failRestartAfterStop = false; let omitStoppedFromNetwork = false; let restartCount = 0;
  const find = (key) => [...byId.values()].find((item) => item.Id === key || item.Name === `/${key}`);
  return { calls, byId, failNextDisconnect() { failDisconnect = true; }, failNextRestartAfterStop() { failRestartAfterStop = true; }, omitStoppedFromNetwork() { omitStoppedFromNetwork = true; }, async run(argv) {
    calls.push([...argv]);
    if (argv[0] === 'container' && argv[1] === 'inspect') return `${JSON.stringify(find(argv.at(-1)))}\n`;
    if (argv[0] === 'network' && argv[1] === 'inspect') return `${JSON.stringify(Object.fromEntries([...byId.values()].filter((item) => item.Networks[EDGE_NETWORK] && !(omitStoppedFromNetwork && item.Running === false)).map((item) => [item.Id, { Name: item.Name.slice(1) }])))}\n`;
    if (argv[0] === 'network' && argv[1] === 'disconnect') { delete find(argv[3]).Networks[EDGE_NETWORK]; if (failDisconnect) { failDisconnect = false; throw new Error('simulated crash'); } return ''; }
    if (argv[0] === 'network' && argv[1] === 'connect') {
      const id = argv.at(-1); const aliases = []; for (let i = 2; i < argv.length - 2; i += 2) if (argv[i] === '--alias') aliases.push(argv[i + 1]);
      find(id).Networks[EDGE_NETWORK] = { Aliases: [...aliases, find(id).Name.slice(1), id.slice(0, 12)] }; return '';
    }
    if (argv[0] === 'container' && argv[1] === 'restart') {
      const value = find(argv.at(-1)); value.Running = false;
      if (failRestartAfterStop) { failRestartAfterStop = false; throw new Error('simulated restart crash after stop'); }
      restartCount += 1; value.Running = true; value.StartedAt = `2026-09-12T10:0${restartCount}:00.000Z`; return `${argv.at(-1)}\n`;
    }
    if (argv[0] === 'container' && argv[1] === 'start') { const value = find(argv.at(-1)); restartCount += 1; value.Running = true; value.StartedAt = `2026-09-12T10:0${restartCount}:00.000Z`; return `${argv.at(-1)}\n`; }
    throw new Error(`unexpected Docker command: ${argv.join(' ')}`);
  } };
}

async function fixture(dockerState = dockerFixture()) {
  const root = await mkdtemp(join(tmpdir(), 'booking-local-ingress-')); const state = join(root, 'state'); await mkdir(state); await chmod(state, 0o700);
  return { root, dockerState, runtime: { runDocker: dockerState.run.bind(dockerState), proofFile: join(state, 'proof.json'), pendingFile: join(state, 'pending.json'),
    proofArchiveDirectory: join(state, 'proofs'), lockFile: join(state, 'lock'), allowInsecureTestPaths: true, now: () => new Date('2026-09-12T11:00:00.000Z') } };
}

test('switches the local logical alias, restarts exact cloudflared, and never contacts Cloudflare', async () => {
  const fx = await fixture();
  try {
    const value = await runIngressHelper(actionArgs(1), fx.runtime);
    assert.equal(value.schema, 'booking.ingress-readback/v3'); assert.equal(value.aliasState, 'desired');
    assert.equal(value.fixedRemoteService, FIXED_REMOTE_SERVICE); assert.equal(value.targetContainerId, BLUE_ID);
    assert.deepEqual(fx.dockerState.byId.get(GREEN_ID).Networks[EDGE_NETWORK].Aliases.sort(), [GREEN_ID.slice(0, 12), 'booking-preprod-gateway-green-1'].sort());
    assert.deepEqual(fx.dockerState.byId.get(BLUE_ID).Networks[EDGE_NETWORK].Aliases.sort(), [BLUE_ID.slice(0, 12), 'booking-preprod-gateway-blue-1', 'gateway-blue', 'gateway-green'].sort());
    assert.equal(fx.dockerState.calls.filter((c) => c[0] === 'container' && c[1] === 'restart').length, 1);
    assert.equal(JSON.stringify(fx.dockerState.calls).includes('cloudflare-preprod-api-token'), false);
    assert.equal((await readdir(fx.runtime.proofArchiveDirectory)).length, 1);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('exact replay is read-only and independent readback verifies exact IDs/images/aliases', async () => {
  const fx = await fixture();
  try {
    const first = await runIngressHelper(actionArgs(1), fx.runtime); const mutations = fx.dockerState.calls.filter((c) => ['network', 'container'].includes(c[0]) && ['disconnect', 'connect', 'restart'].includes(c[1])).length;
    const replay = await runIngressHelper(actionArgs(1), fx.runtime); const readback = await runIngressHelper(['--readback', '--project', PREPROD_PROJECT, '--hostname', PREPROD_HOSTNAME], fx.runtime);
    assert.equal(replay.proofDigest, first.proofDigest); assert.equal(readback.proofDigest, first.proofDigest);
    assert.equal(fx.dockerState.calls.filter((c) => ['network', 'container'].includes(c[0]) && ['disconnect', 'connect', 'restart'].includes(c[1])).length, mutations);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('rollback and second promotion transfer the same logical alias without Cloudflare PUT', async () => {
  const fx = await fixture();
  try {
    await runIngressHelper(actionArgs(1), fx.runtime); await runIngressHelper(actionArgs(2), fx.runtime); const final = await runIngressHelper(actionArgs(3), fx.runtime);
    assert.equal(final.sequence, 3); assert.equal(final.targetContainerId, BLUE_ID); assert.equal((await readdir(fx.runtime.proofArchiveDirectory)).length, 3);
    assert.equal(JSON.stringify(fx.dockerState.calls).includes('configurations'), false);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('crash after exact source disconnect converges from in-flight without repeating that disconnect', async () => {
  const state = dockerFixture(); const fx = await fixture(state);
  try {
    state.failNextDisconnect();
    await assert.rejects(runIngressHelper(actionArgs(1), fx.runtime), /simulated crash/);
    const firstDisconnects = state.calls.filter((c) => c[0] === 'network' && c[1] === 'disconnect' && c[3] === GREEN_ID).length;
    const recovered = await runIngressHelper([...actionArgs(1), '--recover-pending', 'true'], fx.runtime);
    assert.equal(recovered.aliasState, 'desired');
    assert.equal(state.calls.filter((c) => c[0] === 'network' && c[1] === 'disconnect' && c[3] === GREEN_ID).length, firstDisconnects);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('pending marker rejects extra keys and canonical-digest tampering before another mutation', async () => {
  for (const drift of ['extra-key', 'digest']) {
    const state = dockerFixture(); const fx = await fixture(state); state.failNextDisconnect();
    try {
      await assert.rejects(runIngressHelper(actionArgs(1), fx.runtime), /simulated crash/);
      const pending = JSON.parse(await readFile(fx.runtime.pendingFile, 'utf8'));
      if (drift === 'extra-key') pending.foreign = true; else pending.sourceImageId = `sha256:${'f'.repeat(64)}`;
      await writeFile(fx.runtime.pendingFile, `${JSON.stringify(pending)}\n`);
      const before = state.calls.length;
      await assert.rejects(runIngressHelper([...actionArgs(1), '--recover-pending', 'true'], fx.runtime), /invalid shape|digest is invalid/);
      assert.equal(state.calls.length, before);
    } finally { await rm(fx.root, { recursive: true, force: true }); }
  }
});

test('recovery reports previous state as not-applied and performs no mutation without pending marker', async () => {
  const fx = await fixture();
  try {
    const value = await runIngressHelper([...actionArgs(1), '--recover-pending', 'true'], fx.runtime);
    assert.equal(value.schema, 'booking.ingress-pending-recovery/v2'); assert.equal(value.aliasState, 'previous');
    assert.equal(fx.dockerState.calls.some((c) => (c[0] === 'network' && ['disconnect', 'connect'].includes(c[1])) || c[1] === 'restart'), false);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('duplicate alias, pure Image replacement, and config-hash drift freeze before mutation', async () => {
  for (const drift of ['duplicate', 'image', 'config-hash']) {
    const state = dockerFixture(); if (drift === 'duplicate') state.byId.get(BLUE_ID).Networks[EDGE_NETWORK].Aliases.push('gateway-green');
    else if (drift === 'image') state.byId.get(BLUE_ID).Image = `sha256:${'e'.repeat(64)}`;
    else state.byId.get(BLUE_ID).Labels['com.docker.compose.config-hash'] = 'e'.repeat(64);
    const fx = await fixture(state);
    try {
      if (drift === 'duplicate') await assert.rejects(runIngressHelper(actionArgs(1), fx.runtime), /multiple or foreign holders/);
      if (drift !== 'duplicate') await assert.rejects(runIngressHelper(actionArgs(1), fx.runtime), /identity, image, labels/);
      assert.equal(state.calls.some((c) => (c[0] === 'network' && ['disconnect', 'connect'].includes(c[1])) || c[1] === 'restart'), false);
    } finally { await rm(fx.root, { recursive: true, force: true }); }
  }
});

test('rollback and second promotion cannot drift from predecessor immutable rollback baseline', async () => {
  const fx = await fixture();
  try {
    await runIngressHelper(actionArgs(1), fx.runtime);
    const forged = actionArgs(2); forged[forged.indexOf('--rollback-manifest-digest') + 1] = `sha256:${'f'.repeat(64)}`;
    forged[forged.indexOf('--manifest-digest') + 1] = `sha256:${'f'.repeat(64)}`;
    await assert.rejects(runIngressHelper(forged, fx.runtime), /rollback baseline drifted from predecessor proof/);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('foreign endpoint with a syntactically allowed name and extra alias owner both freeze before mutation', async () => {
  for (const drift of ['foreign-id', 'backend-owner']) {
    const state = dockerFixture();
    if (drift === 'foreign-id') {
      const foreign = gateway('blue', 'f'.repeat(64), NEW_RELEASE, BLUE_IMAGE_ID, ['gateway-blue', 'f'.repeat(12)]);
      state.byId.set(foreign.Id, foreign);
    } else state.byId.get(BLUE_BACKEND_ID).Networks[EDGE_NETWORK].Aliases.push(LOGICAL_ALIAS);
    const fx = await fixture(state);
    try {
      await assert.rejects(runIngressHelper(actionArgs(1), fx.runtime), /foreign edge network member|foreign or impossible engine aliases/);
      assert.equal(state.calls.some((c) => (c[0] === 'network' && ['disconnect', 'connect'].includes(c[1])) || ['restart', 'start'].includes(c[1])), false);
    } finally { await rm(fx.root, { recursive: true, force: true }); }
  }
});

test('restart crash after stop converges by exact-ID start even when network list omits stopped endpoint', async () => {
  const state = dockerFixture(); state.failNextRestartAfterStop(); state.omitStoppedFromNetwork(); const fx = await fixture(state);
  try {
    await assert.rejects(runIngressHelper(actionArgs(1), fx.runtime), /simulated restart crash after stop/);
    assert.equal(state.byId.get(CF_ID).Running, false);
    const recovered = await runIngressHelper([...actionArgs(1), '--recover-pending', 'true'], fx.runtime);
    assert.equal(recovered.aliasState, 'desired');
    assert.equal(state.calls.filter((c) => c[0] === 'container' && c[1] === 'start' && c.at(-1) === CF_ID).length, 1);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('restart-response crashes converge from the advanced exact StartedAt without a second restart', async () => {
  for (const checkpoint of ['afterCloudflaredRestart', 'beforeProofWrite']) {
    const state = dockerFixture(); const fx = await fixture(state); let crash = true;
    fx.runtime[checkpoint] = async () => { if (crash) { crash = false; throw new Error(`${checkpoint} crash`); } };
    try {
      await assert.rejects(runIngressHelper(actionArgs(1), fx.runtime), new RegExp(`${checkpoint} crash`));
      const restartedAt = state.byId.get(CF_ID).StartedAt;
      assert.equal(state.calls.filter((c) => c[0] === 'container' && c[1] === 'restart').length, 1);
      const recovered = await runIngressHelper([...actionArgs(1), '--recover-pending', 'true'], fx.runtime);
      assert.equal(recovered.cloudflaredStartedAt, restartedAt);
      assert.equal(state.calls.filter((c) => c[0] === 'container' && c[1] === 'restart').length, 1);
      assert.match(await readFile(fx.runtime.proofFile, 'utf8'), /booking\.local-ingress-proof\/v3/);
    } finally { await rm(fx.root, { recursive: true, force: true }); }
  }
});

test('proof-written pending-cleanup crash is cleaned by exact replay and permits the inverse action', async () => {
  const fx = await fixture(); let crash = true; fx.runtime.beforePendingCleanup = async () => { if (crash) { crash = false; throw new Error('cleanup crash'); } };
  try {
    await assert.rejects(runIngressHelper(actionArgs(1), fx.runtime), /cleanup crash/);
    await readFile(fx.runtime.pendingFile, 'utf8');
    const replay = await runIngressHelper(actionArgs(1), fx.runtime); assert.equal(replay.aliasState, 'desired');
    await assert.rejects(readFile(fx.runtime.pendingFile, 'utf8'), /ENOENT/);
    const rollback = await runIngressHelper(actionArgs(2), fx.runtime); assert.equal(rollback.aliasState, 'desired');
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('atomic lock publication cleans every synchronous ENOSPC checkpoint or leaves one recoverable complete lock', async () => {
  for (const checkpoint of ['lock:temp-created', 'lock:owner-written', 'lock:owner-linked', 'lock:published']) {
    const fx = await fixture(); let callbackRan = false;
    try {
      await assert.rejects(runIngressHelper(actionArgs(1), { ...fx.runtime, lockCheckpoint: async (name) => {
        if (name === checkpoint) { const error = new Error('ENOSPC'); error.code = 'ENOSPC'; throw error; }
      }, afterCloudflaredRestart: async () => { callbackRan = true; } }), /lock could not be established/);
      assert.equal(callbackRan, false);
      const entries = await readdir(join(fx.root, 'state'));
      if (checkpoint !== 'lock:published') {
        assert.equal(entries.some((name) => name.startsWith('lock.')), false, `${checkpoint} must clean its transaction directory`);
        assert.equal(entries.includes('lock'), false);
      } else {
        const lock = JSON.parse(await readFile(join(fx.runtime.lockFile, 'owner.json'), 'utf8'));
        await recoverStaleIngressLock(lock.lockDigest, { ...fx.runtime,
          inspectDockerOwnerStatus: async () => ({ daemonAvailable: true, byName: null, byId: null }), ownerAlive: async () => false });
      }
    } finally { await rm(fx.root, { recursive: true, force: true }); }
  }
});

test('SIGKILL at each lock publication checkpoint leaves only a digest-recoverable temp or complete fixed lock', async () => {
  const moduleUrl = new URL('../release/switch-preprod-ingress.mjs', import.meta.url).href;
  for (const checkpoint of ['lock:temp-created', 'lock:owner-written', 'lock:owner-linked', 'lock:published']) {
    const fx = await fixture();
    const checkpointScript = `import { withIngressLock } from ${JSON.stringify(moduleUrl)}; await withIngressLock({lockFile:${JSON.stringify(fx.runtime.lockFile)},allowInsecureTestPaths:true,lockCheckpoint:async(name)=>{if(name===${JSON.stringify(checkpoint)})await new Promise(()=>{})}}, () => Promise.resolve());`;
    const child = spawn(process.execPath, ['--input-type=module', '--eval', checkpointScript], { stdio: 'ignore' }); child.unref();
    try {
      let artifact = null;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const names = await readdir(join(fx.root, 'state'));
        const temporaryName = names.find((name) => name.startsWith('lock.') && name.endsWith('.tmp'));
        artifact = checkpoint === 'lock:published'
          ? names.includes('lock') ? fx.runtime.lockFile : null
          : temporaryName ? join(fx.root, 'state', temporaryName) : null;
        if (artifact) {
          const artifactNames = (await lstat(artifact)).isDirectory() ? await readdir(artifact) : [];
          if (checkpoint === 'lock:temp-created' || checkpoint === 'lock:owner-written' && artifactNames.includes('.owner.json.tmp') ||
              checkpoint === 'lock:owner-linked' && artifactNames.includes('owner.json') || checkpoint === 'lock:published') break;
        }
        artifact = null; await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(artifact, `checkpoint ${checkpoint} artifact was not observed`);
      const exited = new Promise((resolve) => { const timer = setTimeout(resolve, 1000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
      child.kill('SIGKILL'); await exited;
      const expectedDigest = checkpoint === 'lock:published'
        ? JSON.parse(await readFile(join(artifact, 'owner.json'), 'utf8')).lockDigest
        : await forensicArtifactDigest(artifact);
      const recoveryRuntime = checkpoint === 'lock:published'
        ? { ...fx.runtime, inspectDockerOwnerStatus: async () => ({ daemonAvailable: true, byName: null, byId: null }), ownerAlive: async () => false }
        : { ...fx.runtime, inspectForensicOwnerName: async () => true };
      const recovered = await recoverStaleIngressLock(expectedDigest, recoveryRuntime);
      assert.equal(recovered.recoveredLockDigest, expectedDigest);
    } finally { if (child.exitCode === null) child.kill('SIGKILL'); await rm(fx.root, { recursive: true, force: true }); }
  }
});

test('forensic recovery handles empty or half-written temp/fixed artifacts only while the fixed owner name is absent', async () => {
  for (const shape of ['empty-temp', 'half-temp', 'empty-fixed', 'half-fixed']) {
    const fx = await fixture(); const temporary = `${fx.runtime.lockFile}.11111111-1111-4111-8111-111111111111.tmp`;
    const artifact = shape.endsWith('temp') ? temporary : fx.runtime.lockFile;
    try {
      if (shape.endsWith('temp')) await mkdir(artifact, { mode: 0o700 });
      else await writeFile(artifact, shape.startsWith('half') ? '{"schema":' : '', { mode: 0o600 });
      if (shape === 'half-temp') await writeFile(join(artifact, '.owner.json.tmp'), '{"schema":', { mode: 0o600 });
      const artifactDigest = await forensicArtifactDigest(artifact);
      await assert.rejects(recoverStaleIngressLock(artifactDigest, { ...fx.runtime,
        inspectForensicOwnerName: async () => false }), /owner exists/);
      await access(artifact);
      const recovered = await recoverStaleIngressLock(artifactDigest, { ...fx.runtime,
        inspectForensicOwnerName: async () => true });
      assert.equal(recovered.recoveredLockDigest, artifactDigest);
      await assert.rejects(access(artifact), /ENOENT/);
    } finally { await rm(fx.root, { recursive: true, force: true }); }
  }
});

test('stale lock Docker matrix distinguishes --rm absence, stopped owner, live owner, replacement, and daemon failure', async () => {
  const cases = [
    ['absent', { daemonAvailable: true, byName: null, byId: null }, true],
    ['stopped', { daemonAvailable: true, byName: 'same-stopped', byId: 'same-stopped' }, true],
    ['running', { daemonAvailable: true, byName: 'same-running', byId: 'same-running' }, false],
    ['replacement', { daemonAvailable: true, byName: 'replacement', byId: 'same-stopped' }, false],
    ['daemon', { daemonAvailable: false, byName: null, byId: null }, false],
  ];
  for (const [label, template, succeeds] of cases) {
    const fx = await fixture(); const body = { schema: 'booking.local-ingress-lock/v2', pid: 424242, bootId: 'old-boot', startTicks: '99',
      ownerContainerName: 'booking-preprod-control-plane', ownerContainerId: 'e'.repeat(64), createdAt: '2026-09-12T10:00:00.000Z' };
    const lock = { ...body, lockDigest: digest(body) }; await mkdir(fx.runtime.lockFile, { mode: 0o700 });
    await writeFile(join(fx.runtime.lockFile, 'owner.json'), `${JSON.stringify(lock)}\n`, { mode: 0o600 });
    const same = (running) => ({ Id: lock.ownerContainerId, Name: lock.ownerContainerName, Running: running });
    const replacement = { Id: 'f'.repeat(64), Name: lock.ownerContainerName, Running: true };
    const expand = (value) => value === 'same-stopped' ? same(false) : value === 'same-running' ? same(true) : value === 'replacement' ? replacement : value;
    const status = { ...template, byName: expand(template.byName), byId: expand(template.byId) };
    try {
      const operation = recoverStaleIngressLock(lock.lockDigest, { ...fx.runtime,
        inspectDockerOwnerStatus: async () => status, ownerAlive: async () => false });
      if (succeeds) { const recovered = await operation; assert.equal(recovered.recoveredLockDigest, lock.lockDigest); }
      else { await assert.rejects(operation, /running|replacement|unavailable/); await access(fx.runtime.lockFile); }
    } finally { await rm(fx.root, { recursive: true, force: true }); }
  }
});

test('persistent lock requires digest-bound independent stale recovery and rejects a live owner', async () => {
  const fx = await fixture(); const body = { schema: 'booking.local-ingress-lock/v2', pid: 424242, bootId: 'old-boot', startTicks: '99',
    ownerContainerName: 'booking-preprod-control-plane', ownerContainerId: 'e'.repeat(64), createdAt: '2026-09-12T10:00:00.000Z' };
  const lock = { ...body, lockDigest: digest(body) }; await mkdir(fx.runtime.lockFile, { mode: 0o700 });
  await writeFile(join(fx.runtime.lockFile, 'owner.json'), `${JSON.stringify(lock)}\n`, { mode: 0o600 });
  const stoppedOwner = async () => ({ daemonAvailable: true,
    byName: { Id: lock.ownerContainerId, Name: lock.ownerContainerName, Running: false },
    byId: { Id: lock.ownerContainerId, Name: lock.ownerContainerName, Running: false } });
  try {
    await assert.rejects(recoverStaleIngressLock(`sha256:${'0'.repeat(64)}`, { ...fx.runtime, inspectDockerOwnerStatus: stoppedOwner, ownerAlive: async () => false }), /digest mismatch/);
    await assert.rejects(recoverStaleIngressLock(lock.lockDigest, { ...fx.runtime,
      inspectDockerOwnerStatus: async () => ({ daemonAvailable: false, byName: null, byId: null }), ownerAlive: async () => false }), /daemon.*unavailable/);
    await assert.rejects(recoverStaleIngressLock(lock.lockDigest, { ...fx.runtime,
      inspectDockerOwnerStatus: async () => ({ daemonAvailable: true, byName: { Id: 'f'.repeat(64), Name: lock.ownerContainerName, Running: true }, byId: null }), ownerAlive: async () => false }), /replacement/);
    await assert.rejects(recoverStaleIngressLock(lock.lockDigest, { ...fx.runtime, inspectDockerOwnerStatus: stoppedOwner, ownerAlive: async () => true }), /still alive/);
    let inspections = 0;
    await assert.rejects(recoverStaleIngressLock(lock.lockDigest, { ...fx.runtime, ownerAlive: async () => false,
      inspectDockerOwnerStatus: async () => ({ daemonAvailable: true,
        byName: { Id: lock.ownerContainerId, Name: lock.ownerContainerName, Running: ++inspections === 2 },
        byId: { Id: lock.ownerContainerId, Name: lock.ownerContainerName, Running: inspections === 2 } }) }), /still running/);
    await readFile(join(fx.runtime.lockFile, 'owner.json'), 'utf8');
    const recovered = await runIngressHelper(['--recover-stale-lock', '--lock-digest', lock.lockDigest, '--project', PREPROD_PROJECT, '--hostname', PREPROD_HOSTNAME],
      { ...fx.runtime, inspectDockerOwnerStatus: async () => ({ daemonAvailable: true, byName: null, byId: null }), ownerAlive: async () => false });
    assert.equal(recovered.recoveredLockDigest, lock.lockDigest);
    await assert.rejects(access(fx.runtime.lockFile), /ENOENT/);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('SIGKILL leaves a digest-bound lock that independent recovery clears after owner death', async () => {
  const fx = await fixture(); const moduleUrl = new URL('../release/switch-preprod-ingress.mjs', import.meta.url).href;
  const script = `import { withIngressLock } from ${JSON.stringify(moduleUrl)}; await withIngressLock(${JSON.stringify({ lockFile: fx.runtime.lockFile, allowInsecureTestPaths: true })}, () => new Promise(() => {}));`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], { stdio: 'ignore' }); child.unref();
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) { try { await access(fx.runtime.lockFile); break; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); } }
    const lock = JSON.parse(await readFile(join(fx.runtime.lockFile, 'owner.json'), 'utf8')); const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill('SIGKILL');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1000))]);
    const result = await recoverStaleIngressLock(lock.lockDigest, { ...fx.runtime,
      inspectDockerOwnerStatus: async () => ({ daemonAvailable: true, byName: null, byId: null }), ownerAlive: async () => false });
    assert.equal(result.recoveredLockDigest, lock.lockDigest);
  } finally { if (!child.killed) child.kill('SIGKILL'); await rm(fx.root, { recursive: true, force: true }); }
});

test('scope remains pinned to preprod and helper has no token/fetch input', async () => {
  const fx = await fixture();
  try {
    await assert.rejects(runIngressHelper([...actionArgs(1), '--token-file', '/tmp/token'], fx.runtime), /invalid shape/);
    const prod = actionArgs(1); prod[prod.indexOf('--environment') + 1] = 'production';
    await assert.rejects(runIngressHelper(prod, fx.runtime), /preproduction/);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});
