import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, parse } from 'node:path';
import {
  runLegacyActiveMigration, listDockerContainers, hasExactSelfSecurityOptions, parseMountInfo, parseProcessStat, processMountInfos, assertNoProcessCommands, mountedObjectIdentity, mountReferencesProtected, SimulatedLegacyMigrationCrash,
} from '../release/migrate-booking-preprod-legacy-active-root.mjs';

const MIGRATION = 'booking-legacy-active-20260913T010203Z-536b435723ae';
const APPROVAL = 'approval.g4.legacy-active.r1';
const MIGRATE_TX = '10000000-0000-4000-8000-000000000011';
const ROLLBACK_TX = '10000000-0000-4000-8000-000000000012';
const canonicalForTest = (value) => Array.isArray(value) ? `[${value.map(canonicalForTest).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalForTest(value[key])}`).join(',')}}` : JSON.stringify(value);
const EXPECTED_TOP = [
  'control-plane',
  'control-plane.backup-before-59a70af',
  'control-plane.backup-before-61995f9',
  'control-plane.backup-before-8464ed5',
  'control-plane.backup-before-9462592',
  'control-plane.backup-before-c45a916',
  'control-plane.backup-before-c5d85c9',
  'control-plane.prev-before-booking-20260910T063250Z-b330dd295c6a',
  'run-booking-preprod-control-plane',
  'run-booking-preprod-control-plane.prev-before-booking-20260910T063250Z-b330dd295c6a',
  'run-booking-preprod-control-plane.prev-booking-20260910T014542Z-39513f7d6914',
  'run-booking-preprod-control-plane.prev-booking-20260910T050934Z-c0fa6d98dc3b',
  'switch-preprod-ingress',
  'switch-preprod-ingress.mjs',
].sort();

async function legacyTree(root) {
  await mkdir(join(root, 'control-plane', 'ops', 'release', 'lib'), { recursive: true });
  const files = new Map([
    ['run-booking-preprod-control-plane', '#!/bin/sh\n# current\n'],
    ['switch-preprod-ingress', '#!/bin/sh\n# switch\n'],
    ['switch-preprod-ingress.mjs', 'export const current=true;\n'],
    ['control-plane/ops/release/run-booking-preprod-control-plane', '#!/bin/sh\n# nested\n'],
    ['control-plane/ops/release/switch-preprod-ingress', '#!/bin/sh\n# nested-switch\n'],
    ['control-plane/ops/release/lib/state.mjs', 'export const state=true;\n'],
  ]);
  for (const [name, value] of files) { const path = join(root, ...name.split('/')); await writeFile(path, value); await chmod(path, name.startsWith('run-') || name === 'switch-preprod-ingress' ? 0o555 : 0o644); }
  for (const name of EXPECTED_TOP.filter((entry) => !['control-plane', 'run-booking-preprod-control-plane', 'switch-preprod-ingress', 'switch-preprod-ingress.mjs'].includes(entry))) {
    const path = join(root, name);
    if (name.startsWith('control-plane')) { await mkdir(join(path, 'ops'), { recursive: true }); await writeFile(join(path, 'ops', 'legacy.mjs'), `export const marker='${name}';\n`); }
    else { await writeFile(path, `#!/bin/sh\n# ${name}\n`); await chmod(path, 0o555); }
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'booking-legacy-migration-')); const parent = join(root, 'usr', 'local', 'libexec'); const active = join(parent, 'happybooking');
  const receipts = join(root, 'volume1', 'happybooking', 'booking-preprod', '.g4', 'receipts');
  const deployState = join(root, 'var', 'lib', 'happybooking', 'deploy-state', 'preprod', 'booking-preprod', 'deploy-state.json');
  await mkdir(active, { recursive: true }); await mkdir(receipts, { recursive: true }); await mkdir(dirname(deployState), { recursive: true }); await legacyTree(active);
  const runtime = { parent, active, receipts, deployState, runtimeLock: join(parent, '.happybooking-control-plane-runtime.lock'), installLock: join(parent, '.happybooking-control-plane-install.lock'), installJournal: join(parent, '.happybooking-control-plane-install.journal.json'), expectedUid: null, enforceMode: false, portableReplace: true,
    now: '2026-09-13T01:02:03.000Z', syncDirectory: async () => {}, syncFile: async () => {}, assertQuiescent: async () => {}, assertNoMounts: async () => {}, assertNoProcessCommands: async () => {} };
  const identity = ['--migration-id', MIGRATION, '--approval-id', APPROVAL];
  const inventory = await runLegacyActiveMigration(['--action', 'inventory', ...identity], runtime);
  return { root, parent, active, receipts, deployState, runtime, identity, inventory,
    journal: join(parent, '.happybooking-legacy-active-migration.journal.json'), lock: join(parent, '.happybooking-legacy-active-migration.lock'),
    raw: join(parent, `.happybooking-legacy-raw-${MIGRATION}`) };
}

const exists = async (path) => { try { await readFile(path); return true; } catch { try { await readdir(path); return true; } catch { return false; } } };
const migrationArgs = (f) => ['--action', 'migrate', ...f.identity, '--transaction-id', MIGRATE_TX, '--expected-raw-inventory-digest', f.inventory.inventoryDigest, '--execute', 'true'];
const rollbackArgs = (f, migration) => ['--action', 'rollback', ...f.identity, '--transaction-id', ROLLBACK_TX, '--expected-raw-inventory-digest', migration.rawInventoryDigest,
  '--expected-normalized-inventory-digest', migration.normalizedInventoryDigest, '--predecessor-receipt-digest', migration.receiptDigest, '--execute', 'true'];
const recoverArgs = async (f) => {
  if (await exists(f.journal)) { const journal = JSON.parse(await readFile(f.journal, 'utf8')); return ['--action', 'recover', ...f.identity, '--transaction-id', journal.transactionId, '--expected-raw-inventory-digest', f.inventory.inventoryDigest,
    ...(journal.action === 'rollback' ? ['--expected-normalized-inventory-digest', journal.normalizedInventoryDigest, '--predecessor-receipt-digest', journal.predecessorReceiptDigest] : []), '--execute', 'true']; }
  if (await exists(f.lock)) { const owner = JSON.parse(await readFile(f.lock, 'utf8')); return ['--action', 'recover', ...f.identity, '--transaction-id', owner.transactionId, '--expected-raw-inventory-digest', f.inventory.inventoryDigest, '--execute', 'true']; }
  const temp = (await readdir(f.parent)).find((name) => name.startsWith(`${basename(f.lock)}.`) && name.endsWith('.tmp')); const transactionId = temp.slice(`${basename(f.lock)}.`.length, -'.tmp'.length);
  return ['--action', 'recover', ...f.identity, '--transaction-id', transactionId, '--expected-raw-inventory-digest', f.inventory.inventoryDigest, '--execute', 'true'];
};

test('mountinfo identity exposes the actual mounted object rather than a stale Docker source alias', () => {
  const mounts = parseMountInfo('100 1 0:36 /@syno / rw - btrfs /dev/vg rw\n101 100 0:36 /@syno/usr/local/libexec/happybooking /alias rw - btrfs /dev/vg rw\n50 23 0:3 net:[4026531957] /run/docker/netns/default rw - nsfs nsfs rw\n');
  assert.deepEqual(mountedObjectIdentity('/usr/local/libexec/happybooking', mounts), { device: '0:36', root: '/@syno/usr/local/libexec/happybooking' });
  assert.deepEqual(mountedObjectIdentity('/alias/child', mounts), { device: '0:36', root: '/@syno/usr/local/libexec/happybooking/child' });
  assert.equal(mounts[2].root, 'net:[4026531957]');
  const protectedIdentity = { device: '9:0', root: '/usr/local/libexec/happybooking' };
  assert.equal(mountReferencesProtected({ device: '9:0', root: '/', mountPoint: '/' }, protectedIdentity), false);
  for (const root of ['/usr/local/libexec', '/usr/local/libexec/happybooking', '/usr/local/libexec/happybooking/child']) {
    assert.equal(mountReferencesProtected({ device: '9:0', root, mountPoint: '/' }, protectedIdentity), true, root);
  }
  assert.equal(mountReferencesProtected({ device: '8:0', root: '/usr/local/libexec', mountPoint: '/' }, protectedIdentity), false);
  assert.throws(() => parseMountInfo('malformed'), /mountinfo row is invalid/);
});

test('process stat parsing distinguishes live and zombie identities without trusting the command name', () => {
  const fields = ['S', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '987654'];
  assert.deepEqual(parseProcessStat(`42 (worker ) name) ${fields.join(' ')}\n`, 42), { state: 'S', startTime: '987654' });
  fields[0] = 'Z';
  assert.deepEqual(parseProcessStat(`42 (defunct) ${fields.join(' ')}\n`, 42), { state: 'Z', startTime: '987654' });
  fields[0] = 't';
  assert.deepEqual(parseProcessStat(`42 (traced) ${fields.join(' ')}\n`, 42), { state: 't', startTime: '987654' });
  assert.throws(() => parseProcessStat(`43 (worker) ${fields.join(' ')}\n`, 42), /process stat row is invalid/);
});

test('live proc scanner enumerates the current process thread group with stable task identities', { skip: process.platform === 'win32' }, async () => {
  const records = await processMountInfos();
  assert.ok(records.some((record) => record.groupId === process.pid && record.pid === process.pid));
  assert.ok(records.every((record) => Number.isSafeInteger(record.groupId) && Number.isSafeInteger(record.pid) && record.value.length > 0));
  await assertNoProcessCommands('/definitely-not-a-real-happybooking-protected-path');
});

test('running-process mount identity rejects a stale safe-looking Docker source alias', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const selfMounts = parseMountInfo(await readFile('/proc/self/mountinfo', 'utf8'));
  const activeIdentity = mountedObjectIdentity(await (await import('node:fs/promises')).realpath(f.active), selfMounts);
  const actualMount = `901 1 ${activeIdentity.device} ${activeIdentity.root} /foreign rw - testfs none rw\n`;
  const runtime = { ...f.runtime, assertQuiescent: undefined, assertNoMounts: undefined,
    listContainers: async () => [{ Name: '/foreign', State: { Running: true, Pid: 42 }, Mounts: [{ Source: '/safe-looking-alias', Destination: '/foreign', RW: false }] }],
    processMountInfos: async () => [{ pid: process.pid + 100000, groupId: process.pid + 100000, value: actualMount }], assertNoProcessCommands: async () => {} };
  await assert.rejects(runLegacyActiveMigration(migrationArgs(f), runtime), /mount referencing protected migration tree/);
  assert.equal(await exists(f.raw), false); assert.equal(await exists(f.active), true);
});

test('mount inspection skips every task in the trusted migration executor thread group', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const selfMounts = parseMountInfo(await readFile('/proc/self/mountinfo', 'utf8'));
  const activeIdentity = mountedObjectIdentity(await (await import('node:fs/promises')).realpath(f.active), selfMounts);
  const selfSiblingMount = `902 1 ${activeIdentity.device} ${activeIdentity.root} /executor-sibling rw - testfs none rw\n`;
  const runtime = { ...f.runtime, assertQuiescent: undefined, assertNoMounts: undefined,
    listContainers: async () => [], processMountInfos: async () => [{ pid: process.pid + 1, groupId: process.pid, value: selfSiblingMount }], assertNoProcessCommands: async () => {} };
  const receipt = await runLegacyActiveMigration(migrationArgs(f), runtime);
  assert.equal(receipt.status, 'pass');
});

test('one-time migration keeps the entire raw tree and installs only the normalized reviewed payload', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const receipt = await runLegacyActiveMigration(migrationArgs(f), f.runtime);
  assert.equal(receipt.rawInventoryDigest, f.inventory.inventoryDigest); assert.equal(receipt.status, 'pass');
  assert.deepEqual((await readdir(f.active)).sort(), ['control-plane', 'run-booking-preprod-control-plane', 'switch-preprod-ingress', 'switch-preprod-ingress.mjs']);
  assert.deepEqual((await readdir(f.raw)).sort(), EXPECTED_TOP); assert.equal(await exists(f.lock), false); assert.equal(await exists(f.journal), false);
  const normalized = await runLegacyActiveMigration(['--action', 'inventory', ...f.identity], { ...f.runtime, active: f.raw });
  assert.equal(normalized.inventoryDigest, f.inventory.inventoryDigest);
  if (process.platform !== 'win32') {
    assert.equal((await (await import('node:fs/promises')).stat(f.active)).mode & 0o777, 0o555);
    const rootRunnerMode = (await import('node:fs/promises')).stat(f.active + '/run-booking-preprod-control-plane');
    assert.equal((await rootRunnerMode).mode & 0o777, 0o555);
    assert.equal((await (await import('node:fs/promises')).stat(f.active + '/switch-preprod-ingress.mjs')).mode & 0o777, 0o444);
  }
});

test('migration rejects root-entry drift, symbolic links, raw digest drift and every safety gate before rename', async (t) => {
  for (const scenario of ['extra', 'symlink', 'hardlink', 'digest', 'quiescent', 'mount', 'command']) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); let runtime = f.runtime; let args = migrationArgs(f);
    if (scenario === 'extra') await writeFile(join(f.active, 'unexpected'), 'x');
    if (scenario === 'symlink') { await rm(join(f.active, 'switch-preprod-ingress.mjs')); await symlink(join(f.active, 'run-booking-preprod-control-plane'), join(f.active, 'switch-preprod-ingress.mjs')); }
    if (scenario === 'hardlink') { await rm(join(f.active, 'switch-preprod-ingress.mjs')); await link(join(f.active, 'run-booking-preprod-control-plane'), join(f.active, 'switch-preprod-ingress.mjs')); }
    if (scenario === 'digest') args[args.indexOf('--expected-raw-inventory-digest') + 1] = `sha256:${'0'.repeat(64)}`;
    if (scenario === 'quiescent') runtime = { ...runtime, assertQuiescent: async () => { throw new Error('busy'); } };
    if (scenario === 'mount') runtime = { ...runtime, assertNoMounts: async () => { throw new Error('mounted'); } };
    if (scenario === 'command') runtime = { ...runtime, assertQuiescent: undefined, assertNoProcessCommands: async () => { throw new Error('command'); } };
    await assert.rejects(runLegacyActiveMigration(args, runtime));
    assert.equal(await exists(f.raw), false, scenario); assert.equal(await exists(f.active), true, scenario);
  }
});

test('runtime lock appearing after migration precheck aborts migrate and rollback before journal, stage, or rename', async (t) => {
  await t.test('migrate', async (st) => {
    const f = await fixture(); st.after(() => rm(f.root, { recursive: true, force: true })); let checks = 0;
    const runtime = { ...f.runtime, assertQuiescent: async () => {
      checks += 1; if (checks === 2) { await writeFile(f.runtime.runtimeLock, 'runtime-owner'); throw new Error('runtime acquired'); }
    } };
    await assert.rejects(runLegacyActiveMigration(migrationArgs(f), runtime), /runtime acquired/);
    assert.equal(checks, 2); assert.equal(await exists(f.lock), false); assert.equal(await exists(f.journal), false);
    assert.equal(await exists(f.raw), false); assert.deepEqual((await readdir(f.active)).sort(), EXPECTED_TOP);
    assert.equal((await readdir(f.parent)).some((name) => name.includes('normalized-stage')), false);
  });
  await t.test('rollback', async (st) => {
    const f = await fixture(); st.after(() => rm(f.root, { recursive: true, force: true }));
    const migration = await runLegacyActiveMigration(migrationArgs(f), f.runtime); const normalizedBefore = (await readdir(f.active)).sort(); let checks = 0;
    const runtime = { ...f.runtime, assertQuiescent: async () => {
      checks += 1; if (checks === 2) { await writeFile(f.runtime.runtimeLock, 'runtime-owner'); throw new Error('runtime acquired'); }
    } };
    await assert.rejects(runLegacyActiveMigration(rollbackArgs(f, migration), runtime), /runtime acquired/);
    assert.equal(checks, 2); assert.equal(await exists(f.lock), false); assert.equal(await exists(f.journal), false);
    assert.equal(await exists(f.raw), true); assert.deepEqual((await readdir(f.active)).sort(), normalizedBefore);
    assert.equal((await readdir(f.parent)).some((name) => name.includes('normalized-retired')), false);
  });
});

test('installer lock appearing after migrator fixed-lock publication is rejected by production quiescence and safely clears pre-journal migration state', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  let injected = false; let migrationLockWasPublished = false; const parentSyncStates = [];
  const runtime = { ...f.runtime, assertQuiescent: undefined, listContainers: async () => [],
    syncDirectory: async (path) => { if (path === f.parent) parentSyncStates.push(await exists(f.lock) ? 'lock-present' : 'lock-absent'); },
    checkpoint: async (point) => {
    if (point === 'lock:acquired' && !injected) {
      migrationLockWasPublished = await exists(f.lock);
      await mkdir(f.runtime.installLock);
      injected = true;
    }
  } };
  await assert.rejects(runLegacyActiveMigration(migrationArgs(f), runtime), /conflicting lock or journal exists: \.happybooking-control-plane-install\.lock/);
  assert.equal(injected, true); assert.equal(migrationLockWasPublished, true);
  assert.equal(await exists(f.lock), false); assert.equal(await exists(f.journal), false);
  assert.ok(parentSyncStates.includes('lock-present')); assert.equal(parentSyncStates.at(-1), 'lock-absent');
  assert.equal(await exists(f.raw), false); assert.deepEqual((await readdir(f.active)).sort(), EXPECTED_TOP);
  assert.equal((await readdir(f.parent)).some((name) => name.includes('normalized-stage')), false);
});

test('every migrate rename, journal and receipt crash point recovers to an exact raw or completed normalized state', async (t) => {
  const points = ['lock:temp-created', 'lock:owner-written', 'lock:prepared', 'lock:published', 'lock:acquired', 'journal:PREPARED', 'journal:STAGED', 'rename:raw-retired', 'journal:RAW_RETIRED', 'rename:normalized-active', 'journal:NORMALIZED_ACTIVE', 'receipt:prepared', 'receipt:published', 'journal:RECEIPT_PUBLISHED', 'journal:COMPLETE'];
  for (const point of points) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runLegacyActiveMigration(migrationArgs(f), { ...f.runtime, crashAt: point }), SimulatedLegacyMigrationCrash, point);
    const recovered = await runLegacyActiveMigration(await recoverArgs(f), f.runtime);
    assert.ok(['cleared-incomplete-lock', 'cleared-pre-journal-lock', 'rolled-back-before-retire', 'raw-active-restored', 'completed'].includes(recovered.status), point);
    assert.equal(await exists(f.lock), false, point); assert.equal(await exists(f.journal), false, point);
    if (recovered.status === 'completed') assert.deepEqual((await readdir(f.active)).sort(), ['control-plane', 'run-booking-preprod-control-plane', 'switch-preprod-ingress', 'switch-preprod-ingress.mjs']);
    else assert.deepEqual((await readdir(f.active)).sort(), EXPECTED_TOP);
  }
});

test('migration rollback restores the byte/mode-bound raw tree and retains the normalized tree for forensics', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const migration = await runLegacyActiveMigration(migrationArgs(f), f.runtime);
  const rollback = await runLegacyActiveMigration(rollbackArgs(f, migration), f.runtime);
  assert.equal(rollback.action, 'rollback'); assert.deepEqual((await readdir(f.active)).sort(), EXPECTED_TOP); assert.equal(await exists(f.raw), false);
  assert.equal(await exists(join(f.parent, rollback.normalizedArchiveName)), true);
});

test('every rollback rename, journal and receipt crash point recovers to one exact pre- or post-rollback state', async (t) => {
  const points = [
    ['lock:temp-created'], ['lock:owner-written'], ['lock:prepared'], ['lock:published'], ['lock:acquired'], ['journal:PREPARED', 1], ['rename:normalized-retired'], ['journal:NORMALIZED_RETIRED'],
    ['rename:raw-restored'], ['journal:RAW_RESTORED'], ['receipt:prepared'], ['receipt:published'], ['journal:RECEIPT_PUBLISHED'], ['journal:COMPLETE'],
  ];
  for (const [point, occurrence] of points) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const migration = await runLegacyActiveMigration(migrationArgs(f), f.runtime);
    await assert.rejects(runLegacyActiveMigration(rollbackArgs(f, migration), { ...f.runtime, checkpointCounts: new Map(), crashAt: point, crashAtOccurrence: occurrence }), SimulatedLegacyMigrationCrash, `${point}#${occurrence || 1}`);
    const recovered = await runLegacyActiveMigration(await recoverArgs(f), f.runtime);
    assert.ok(['cleared-incomplete-lock', 'cleared-pre-journal-lock', 'rollback-not-started', 'normalized-active-restored', 'rollback-completed'].includes(recovered.status), point);
    assert.equal(await exists(f.lock), false, point); assert.equal(await exists(f.journal), false, point);
    const top = (await readdir(f.active)).sort();
    if (recovered.status === 'rollback-completed') assert.deepEqual(top, EXPECTED_TOP, point);
    else assert.deepEqual(top, ['control-plane', 'run-booking-preprod-control-plane', 'switch-preprod-ingress', 'switch-preprod-ingress.mjs'], point);
  }
});

test('ENOSPC during lock owner publication is forensically receipted before exact cleanup', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(runLegacyActiveMigration(migrationArgs(f), { ...f.runtime, failLockWrite: 'ENOSPC' }), { code: 'ENOSPC' });
  const recovered = await runLegacyActiveMigration(await recoverArgs(f), f.runtime); assert.equal(recovered.status, 'cleared-incomplete-lock');
  assert.equal(recovered.receipt.action, 'recover-incomplete-lock'); assert.equal(await exists(f.lock), false);
});

test('POSIX immutable-mode lock partials recover under production mode enforcement', { skip: process.platform === 'win32' }, async (t) => {
  for (const code of ['ENOSPC', 'EIO']) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const runtime = { ...f.runtime, enforceMode: true };
    await assert.rejects(runLegacyActiveMigration(migrationArgs(f), { ...runtime, failLockWrite: code }), { code });
    const recovered = await runLegacyActiveMigration(await recoverArgs(f), runtime); assert.equal(recovered.status, 'cleared-incomplete-lock');
  }
});

test('every journal temporary is reconciled after crashes before and after atomic replacement', async (t) => {
  for (const checkpoint of ['journal:prepared', 'journal:linked']) {
    for (const occurrence of [1, 2, 3, 4, 5]) {
      const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
      await assert.rejects(runLegacyActiveMigration(migrationArgs(f), { ...f.runtime, checkpointCounts: new Map(), crashAt: checkpoint, crashAtOccurrence: occurrence }), SimulatedLegacyMigrationCrash, `${checkpoint}#${occurrence}`);
      const recovered = await runLegacyActiveMigration(await recoverArgs(f), f.runtime);
      assert.ok(['rolled-back-before-retire', 'raw-active-restored', 'completed'].includes(recovered.status), `${checkpoint}#${occurrence}`);
      assert.equal(await exists(f.lock), false); assert.equal(await exists(f.journal), false);
    }
  }
});

test('a second recovery completes after a crash while forensically clearing an incomplete lock', async (t) => {
  for (const point of ['receipt:prepared', 'receipt:published', 'lock-forensic:published', 'lock-forensic:revalidated']) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runLegacyActiveMigration(migrationArgs(f), { ...f.runtime, crashAt: 'lock:temp-created' }), SimulatedLegacyMigrationCrash);
    const args = await recoverArgs(f);
    await assert.rejects(runLegacyActiveMigration(args, { ...f.runtime, checkpointCounts: new Map(), crashAt: point }), SimulatedLegacyMigrationCrash, point);
    const recovered = await runLegacyActiveMigration(args, f.runtime); assert.equal(recovered.status, 'cleared-incomplete-lock', point);
    assert.equal(await exists(f.lock), false, point);
  }
});

test('recover freezes while any normal migration container identity still exists', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(runLegacyActiveMigration(migrationArgs(f), { ...f.runtime, crashAt: 'lock:acquired' }), SimulatedLegacyMigrationCrash);
  const args = await recoverArgs(f); const runtime = { ...f.runtime, assertQuiescent: undefined, listContainers: async () => [{ Name: '/booking-preprod-legacy-active-migration', State: { Running: false, Pid: 0 }, Mounts: [] }] };
  await assert.rejects(runLegacyActiveMigration(args, runtime), /normal legacy migration container still exists/);
  assert.equal(await exists(f.lock), true);
});

test('journal and receipt ENOSPC or EIO partials are quarantined before deterministic recovery', async (t) => {
  for (const code of ['ENOSPC', 'EIO']) {
    const journalCase = await fixture(); t.after(() => rm(journalCase.root, { recursive: true, force: true }));
    await assert.rejects(runLegacyActiveMigration(migrationArgs(journalCase), { ...journalCase.runtime, failJournalWrite: code }), { code });
    assert.equal(await exists(journalCase.lock), true);
    const journalRecovered = await runLegacyActiveMigration(await recoverArgs(journalCase), journalCase.runtime);
    assert.equal(journalRecovered.status, 'cleared-pre-journal-lock');
    assert.ok((await readdir(journalCase.parent)).some((name) => name.includes('.journal.json.') && name.includes('.corrupt-sha256-')));

    const receiptCase = await fixture(); t.after(() => rm(receiptCase.root, { recursive: true, force: true }));
    await assert.rejects(runLegacyActiveMigration(migrationArgs(receiptCase), { ...receiptCase.runtime, failReceiptWrite: code }), { code });
    const receiptRecovered = await runLegacyActiveMigration(await recoverArgs(receiptCase), receiptCase.runtime);
    assert.equal(receiptRecovered.status, 'completed');
    assert.ok((await readdir(receiptCase.receipts)).some((name) => name.includes('.tmp.corrupt-sha256-')));
  }
});

test('a partial next journal never overrides any durable migration phase', async (t) => {
  for (const code of ['ENOSPC', 'EIO']) for (const occurrence of [2, 3, 4, 5, 6]) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runLegacyActiveMigration(migrationArgs(f), { ...f.runtime, failJournalWrite: code, failJournalWriteAtOccurrence: occurrence }), { code });
    const recovered = await runLegacyActiveMigration(await recoverArgs(f), f.runtime);
    assert.ok(['rolled-back-before-retire', 'raw-active-restored', 'completed'].includes(recovered.status), `${code}#${occurrence}`);
    assert.equal(await exists(f.lock), false); assert.equal(await exists(f.journal), false);
  }
});

test('half-written forensic receipt is quarantined and the exact incomplete lock is then receipted', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(runLegacyActiveMigration(migrationArgs(f), { ...f.runtime, failLockWrite: 'ENOSPC' }), { code: 'ENOSPC' }); const args = await recoverArgs(f);
  await assert.rejects(runLegacyActiveMigration(args, { ...f.runtime, failReceiptWrite: 'EIO' }), { code: 'EIO' });
  const recovered = await runLegacyActiveMigration(args, f.runtime); assert.equal(recovered.status, 'cleared-incomplete-lock');
  assert.ok((await readdir(f.receipts)).some((name) => name.includes('lock-recovery') && name.includes('.corrupt-sha256-')));
});

test('partial quarantine is restart-safe before rename, after rename and on directory fsync EIO', async (t) => {
  for (const failure of ['quarantine:before-rename', 'quarantine:renamed', 'EIO']) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runLegacyActiveMigration(migrationArgs(f), { ...f.runtime, failJournalWrite: 'ENOSPC' }), { code: 'ENOSPC' }); const args = await recoverArgs(f);
    const runtime = failure === 'EIO' ? { ...f.runtime, failQuarantineSync: 'EIO' } : { ...f.runtime, crashAt: failure };
    await assert.rejects(runLegacyActiveMigration(args, runtime), failure === 'EIO' ? { code: 'EIO' } : SimulatedLegacyMigrationCrash);
    const recovered = await runLegacyActiveMigration(args, f.runtime); assert.equal(recovered.status, 'cleared-pre-journal-lock', failure);
    assert.ok((await readdir(f.parent)).some((name) => name.includes('.corrupt-sha256-')), failure);
  }
});

test('quarantine duplicate handling requires exact bytes and safe metadata', async (t) => {
  for (const scenario of ['same', 'different', 'hardlink', 'oversize']) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runLegacyActiveMigration(migrationArgs(f), { ...f.runtime, failJournalWrite: 'ENOSPC' }), { code: 'ENOSPC' }); const args = await recoverArgs(f);
    const source = `${f.journal}.${MIGRATE_TX}.tmp`;
    if (scenario === 'oversize') {
      await chmod(source, 0o600); await writeFile(source, Buffer.alloc(1024 * 1024 + 1)); await chmod(source, 0o400);
      await assert.rejects(runLegacyActiveMigration(args, f.runtime), /bounded immutable/); continue;
    }
    await assert.rejects(runLegacyActiveMigration(args, { ...f.runtime, crashAt: 'quarantine:renamed' }), SimulatedLegacyMigrationCrash);
    const quarantineName = (await readdir(f.parent)).find((name) => name.includes('.journal.json.') && name.includes('.corrupt-sha256-')); const quarantine = join(f.parent, quarantineName);
    await writeFile(source, scenario === 'different' ? 'different' : await readFile(quarantine)); await chmod(source, 0o400);
    if (scenario === 'hardlink') await link(quarantine, join(f.parent, 'quarantine-alias'));
    if (['same', 'different'].includes(scenario)) {
      assert.equal((await runLegacyActiveMigration(args, f.runtime)).status, 'cleared-pre-journal-lock');
      if (scenario === 'different') assert.equal((await readdir(f.parent)).filter((name) => name.includes('.corrupt-sha256-')).length, 2);
    } else await assert.rejects(runLegacyActiveMigration(args, f.runtime), /conflicts|bounded immutable/);
  }
});

test('completed migrate and rollback replays are idempotent only after fresh tree readback', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const migration = await runLegacyActiveMigration(migrationArgs(f), f.runtime);
  assert.deepEqual(await runLegacyActiveMigration(migrationArgs(f), f.runtime), migration);
  await chmod(join(f.active, 'switch-preprod-ingress.mjs'), 0o600); await writeFile(join(f.active, 'switch-preprod-ingress.mjs'), 'drift\n'); await chmod(join(f.active, 'switch-preprod-ingress.mjs'), 0o444);
  await assert.rejects(runLegacyActiveMigration(migrationArgs(f), f.runtime), /replay readback/);
  await rm(f.root, { recursive: true, force: true });

  const r = await fixture(); t.after(() => rm(r.root, { recursive: true, force: true })); const migrated = await runLegacyActiveMigration(migrationArgs(r), r.runtime);
  const rollback = await runLegacyActiveMigration(rollbackArgs(r, migrated), r.runtime); assert.deepEqual(await runLegacyActiveMigration(rollbackArgs(r, migrated), r.runtime), rollback);
  await chmod(join(r.active, 'switch-preprod-ingress.mjs'), 0o600); await writeFile(join(r.active, 'switch-preprod-ingress.mjs'), 'drift\n'); await chmod(join(r.active, 'switch-preprod-ingress.mjs'), 0o644);
  await assert.rejects(runLegacyActiveMigration(rollbackArgs(r, migrated), r.runtime), /replay readback/);
});

test('migration receipts reject extra fields, wrong schema and derived path escape', async (t) => {
  for (const scenario of ['extra', 'schema', 'path']) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); await runLegacyActiveMigration(migrationArgs(f), f.runtime);
    const path = join(f.receipts, `control-plane-legacy-migration-${MIGRATION}.json`); const receipt = JSON.parse(await readFile(path, 'utf8'));
    if (scenario === 'extra') receipt.extra = 'forged';
    if (scenario === 'schema') receipt.schema = 'booking.preprod-legacy-active-migration-receipt/v0';
    if (scenario === 'path') receipt.rawArchiveName = '../escape';
    const { receiptDigest: ignored, ...body } = receipt; receipt.receiptDigest = `sha256:${createHash('sha256').update(canonicalForTest(body)).digest('hex')}`;
    await chmod(path, 0o600); await writeFile(path, `${canonicalForTest(receipt)}\n`); await chmod(path, 0o400);
    await assert.rejects(runLegacyActiveMigration(migrationArgs(f), f.runtime), /receipt fields|paths or schema/);
  }
});

test('parseable forged journal identity and PREPARED pre-existing active plus archive freeze recovery', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(runLegacyActiveMigration(migrationArgs(f), { ...f.runtime, crashAt: 'journal:PREPARED' }), SimulatedLegacyMigrationCrash);
  const args = await recoverArgs(f); const journal = JSON.parse(await readFile(f.journal, 'utf8')); journal.stageName = '../escape';
  await chmod(f.journal, 0o600); await writeFile(f.journal, `${JSON.stringify(journal)}\n`); await chmod(f.journal, 0o400);
  await assert.rejects(runLegacyActiveMigration(args, f.runtime), /journal paths/); assert.equal(await exists(f.lock), true);

  const g = await fixture(); t.after(() => rm(g.root, { recursive: true, force: true }));
  await assert.rejects(runLegacyActiveMigration(migrationArgs(g), { ...g.runtime, crashAt: 'journal:PREPARED' }), SimulatedLegacyMigrationCrash);
  await mkdir(g.raw); await writeFile(join(g.raw, 'foreign'), 'foreign');
  await assert.rejects(runLegacyActiveMigration(await recoverArgs(g), g.runtime), /ambiguous pre-commit/); assert.equal(await exists(g.active), true);
});

test('foreign container mounts of root, ancestor, active or active child all fail closed', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  for (const source of [parse(f.active).root, dirname(f.parent), f.parent, f.active, join(f.active, 'control-plane')]) {
    const runtime = { ...f.runtime, assertQuiescent: undefined, listContainers: async () => [{ Name: '/foreign', State: { Running: true, Pid: 42 }, Mounts: [{ Source: source, Destination: '/foreign', RW: false }] }],
      assertNoProcessCommands: async () => {}, assertNoMounts: async () => {} };
    await assert.rejects(runLegacyActiveMigration(migrationArgs(f), runtime), /foreign container mount overlaps/, source);
  }
});

test('the post-stage quiescence gate rejects a newly mounted or command-referenced normalized stage', async (t) => {
  for (const scenario of ['mount', 'command']) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const stage = join(f.parent, `.happybooking-legacy-normalized-stage-${MIGRATE_TX}`); let lists = 0;
    const runtime = { ...f.runtime, assertQuiescent: undefined,
      listContainers: async () => { lists += 1; return scenario === 'mount' && lists >= 2 ? [{ Name: '/foreign', State: { Running: true, Pid: 42 }, Mounts: [{ Source: stage, Destination: '/stage', RW: false }] }] : []; },
      assertNoMounts: async () => {}, assertNoProcessCommands: async (path) => { if (scenario === 'command' && path === stage) throw new Error('stage command'); } };
    await assert.rejects(runLegacyActiveMigration(migrationArgs(f), runtime), scenario === 'mount' ? /foreign container mount overlaps/ : /stage command/);
    assert.equal(await exists(f.raw), false, scenario); assert.equal(await exists(f.active), true, scenario);
  }
});

test('post-rename quiescence failures preserve the journal and recovery cannot cross a busy gate', async (t) => {
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); let checks = 0;
    const runtime = { ...f.runtime, assertQuiescent: async () => { checks += 1; if (checks === 4) throw new Error('busy after raw retire'); } };
    await assert.rejects(runLegacyActiveMigration(migrationArgs(f), runtime), /busy after raw retire/);
    assert.equal(await exists(f.active), false); assert.equal(await exists(f.raw), true); assert.equal(await exists(f.journal), true);
    const args = await recoverArgs(f); await assert.rejects(runLegacyActiveMigration(args, { ...f.runtime, assertQuiescent: async () => { throw new Error('still busy'); } }), /still busy/);
    assert.equal(await exists(f.active), false); assert.equal(await exists(f.raw), true);
    assert.equal((await runLegacyActiveMigration(args, f.runtime)).status, 'raw-active-restored'); assert.equal(await exists(f.active), true);
  }
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const migration = await runLegacyActiveMigration(migrationArgs(f), f.runtime); let checks = 0;
    const runtime = { ...f.runtime, assertQuiescent: async () => { checks += 1; if (checks === 3) throw new Error('busy after normalized retire'); } };
    await assert.rejects(runLegacyActiveMigration(rollbackArgs(f, migration), runtime), /busy after normalized retire/);
    assert.equal(await exists(f.active), false); assert.equal(await exists(f.raw), true); assert.equal(await exists(f.journal), true);
    const args = await recoverArgs(f); await assert.rejects(runLegacyActiveMigration(args, { ...f.runtime, assertQuiescent: async () => { throw new Error('still busy'); } }), /still busy/);
    assert.equal(await exists(f.active), false); assert.equal(await exists(f.raw), true);
    assert.equal((await runLegacyActiveMigration(args, f.runtime)).status, 'normalized-active-restored'); assert.equal(await exists(f.active), true);
  }
});

test('Docker list API never inspects an unrelated container and rechecks every fixed identity', async () => {
  const foreignId = 'a'.repeat(64); const fixedId = 'b'.repeat(64); const calls = [];
  const foreign = { Id: foreignId, Names: ['/clash-mihomo'], State: 'running', Mounts: [{ Type: 'bind', Source: '/volume1/docker/clash', Destination: '/config', RW: true }] };
  const fixedSummary = { Id: fixedId, Names: ['/booking-preprod-legacy-active-migration'], State: 'running', Mounts: [] };
  const fixedInspect = { Id: fixedId, Name: '/booking-preprod-legacy-active-migration', State: { Running: true, Pid: 123 }, Mounts: [], Config: { Image: 'fixed' }, HostConfig: {} };
  const containers = await listDockerContainers({ dockerJson: async (path) => {
    calls.push(path); if (path === '/containers/json?all=1') return [foreign, fixedSummary];
    if (path === `/containers/${fixedId}/json`) return fixedInspect;
    throw new Error(`unexpected Docker API path: ${path}`);
  } });
  assert.deepEqual(calls, ['/containers/json?all=1', `/containers/${fixedId}/json`]);
  assert.deepEqual(containers[0].Mounts, foreign.Mounts); assert.deepEqual(containers[1], fixedInspect);
  calls.length = 0; fixedSummary.State = 'paused'; fixedInspect.State.Paused = true;
  await listDockerContainers({ dockerJson: async (path) => { calls.push(path); return path === '/containers/json?all=1' ? [fixedSummary] : fixedInspect; } });
  assert.deepEqual(calls, ['/containers/json?all=1', `/containers/${fixedId}/json`]);
  for (const inspected of [
    { ...fixedInspect, State: {} }, { ...fixedInspect, State: { Running: true, Pid: '123' } }, { ...fixedInspect, Mounts: null },
    { ...fixedInspect, Mounts: [{ Source: 'relative', Destination: '/x', RW: false }] }, { ...fixedInspect, Config: null },
    { ...fixedInspect, Config: { Image: '' } }, { ...fixedInspect, HostConfig: null },
  ]) {
    await assert.rejects(listDockerContainers({ dockerJson: async (path) => path === '/containers/json?all=1' ? [fixedSummary] : inspected }), /(inspection|mount) is invalid/);
  }
  await assert.rejects(listDockerContainers({ dockerJson: async () => [{ Id: foreignId, Names: ['/foreign'], State: 'running' }] }), /summary is invalid/);
  await assert.rejects(listDockerContainers({ dockerJson: async () => [{ ...foreign, State: 'unknown' }] }), /summary is invalid/);
  const volumeName = 'a'.repeat(64); const volumeSummary = { ...foreign, Mounts: [
    { Type: 'tmpfs', Source: '', Destination: '/tmp', RW: true },
    { Type: 'volume', Name: volumeName, Source: '', Destination: '/data', RW: true },
  ] };
  calls.length = 0;
  const resolved = await listDockerContainers({ dockerJson: async (path) => {
    calls.push(path); return path === '/containers/json?all=1' ? [volumeSummary]
      : { Name: volumeName, Driver: 'local', Scope: 'local', Mountpoint: '/volume1/@docker/volumes/resolved/_data', Options: null };
  } });
  assert.deepEqual(calls, ['/containers/json?all=1', `/volumes/${volumeName}`]);
  assert.deepEqual(resolved[0].Mounts.map((mount) => mount.Source), ['/volume1/@docker/volumes/resolved/_data']);
  const ordinaryVolume = { Name: volumeName, Driver: 'local', Scope: 'local', Mountpoint: '/volume1/@docker/volumes/resolved/_data', Options: {} };
  const populatedSummary = { ...volumeSummary, Mounts: [{ Type: 'volume', Name: volumeName, Source: ordinaryVolume.Mountpoint, Destination: '/data', RW: true }] };
  calls.length = 0; await listDockerContainers({ dockerJson: async (path) => { calls.push(path); return path === '/containers/json?all=1' ? [populatedSummary] : ordinaryVolume; } });
  assert.deepEqual(calls, ['/containers/json?all=1', `/volumes/${volumeName}`], 'even a populated volume source must be independently resolved');
  await assert.rejects(listDockerContainers({ dockerJson: async (path) => path === '/containers/json?all=1' ? [volumeSummary] : { ...ordinaryVolume, Mountpoint: 'relative' } }), /volume inspection is invalid/);
  await assert.rejects(listDockerContainers({ dockerJson: async (path) => path === '/containers/json?all=1' ? [populatedSummary] : { ...ordinaryVolume, Mountpoint: '/different' } }), /source differs/);
  await assert.rejects(listDockerContainers({ dockerJson: async (path) => path === '/containers/json?all=1' ? [populatedSummary] : { ...ordinaryVolume, Options: { type: 'none', o: 'bind', device: '/usr/local/libexec/happybooking' } } }), /volume inspection is invalid/);
  await assert.rejects(listDockerContainers({ dockerJson: async (path) => path === '/containers/json?all=1' ? [populatedSummary] : { ...ordinaryVolume, Driver: 'plugin' } }), /volume inspection is invalid/);
});

test('Docker socket transport fails closed on deadline, size, status and truncation', async (t) => {
  let sequence = 0;
  async function serve(handler, task) {
    sequence += 1;
    const socketPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\booking-docker-api-${process.pid}-${sequence}`
      : join(await mkdtemp(join(tmpdir(), 'booking-docker-api-')), 'docker.sock');
    const server = createServer(handler);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    try { await task(socketPath); } finally {
      await new Promise((resolve) => server.close(resolve));
      if (process.platform !== 'win32') await rm(dirname(socketPath), { recursive: true, force: true });
    }
  }

  await serve((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' }); response.write('[');
    const drip = setInterval(() => response.write(' '), 5); response.once('close', () => clearInterval(drip));
  }, async (socketPath) => {
    const started = Date.now();
    await assert.rejects(listDockerContainers({ dockerSocketPath: socketPath, dockerTimeoutMs: 40 }), /cannot enumerate containers/);
    assert.ok(Date.now() - started < 1_000, 'wall-clock deadline must stop a continuously active response');
  });
  await serve((request, response) => {
    if (request.url === '/containers/json?all=1') {
      setTimeout(() => { response.writeHead(200); response.end(JSON.stringify([{ Id: 'b'.repeat(64), Names: ['/booking-preprod-control-plane'], State: 'running', Mounts: [] }])); }, 25);
    } else {
      response.writeHead(200); response.write('{'); const drip = setInterval(() => response.write(' '), 5); response.once('close', () => clearInterval(drip));
    }
  }, async (socketPath) => {
    const started = Date.now();
    await assert.rejects(listDockerContainers({ dockerSocketPath: socketPath, dockerTimeoutMs: 40 }), /cannot inspect fixed control container/);
    assert.ok(Date.now() - started < 1_000, 'one wall-clock deadline must cover list and every fixed inspect');
  });
  await serve((_request, response) => { response.writeHead(200); response.end(JSON.stringify([{ value: 'x'.repeat(256) }])); }, async (socketPath) => {
    await assert.rejects(listDockerContainers({ dockerSocketPath: socketPath, dockerResponseLimit: 64 }), /cannot enumerate containers/);
  });
  await serve((_request, response) => { response.writeHead(503); response.end('{}'); }, async (socketPath) => {
    await assert.rejects(listDockerContainers({ dockerSocketPath: socketPath }), /cannot enumerate containers/);
  });
  await serve((_request, response) => { response.writeHead(200); response.write('['); response.destroy(); }, async (socketPath) => {
    await assert.rejects(listDockerContainers({ dockerSocketPath: socketPath }), /cannot enumerate containers/);
  });
});

test('self migration security options admit only the exact daemon-normalized Synology variant', () => {
  assert.equal(hasExactSelfSecurityOptions(['no-new-privileges:true']), true);
  assert.equal(hasExactSelfSecurityOptions(['no-new-privileges:true', 'label=disable']), true);
  for (const value of [[], ['label=disable'], ['no-new-privileges:true', 'label=disable', 'apparmor=unconfined'],
    ['no-new-privileges:true', 'no-new-privileges:true'], null, 'no-new-privileges:true']) assert.equal(hasExactSelfSecurityOptions(value), false);
});
