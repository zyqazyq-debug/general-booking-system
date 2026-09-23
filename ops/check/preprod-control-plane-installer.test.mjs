import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, link, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectControlPlaneInventory, inspectControlPlaneSourceArchive, runControlPlaneInstaller, SimulatedInstallCrash } from '../release/install-booking-preprod-control-plane.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GIT = 'b2c3d4e567890123456789012345678901234567';
const OLD_GIT = 'a1b2c3d456789012345678901234567890123456';
const ID = `booking-control-20260912T020304Z-${GIT.slice(0, 12)}`;
const APPROVAL = 'approval.user.g4.control-plane.r1';
const INSTALLER_NAME = 'booking-preprod-control-plane-installer';
const RECOVERY_NAME = 'booking-preprod-control-plane-installer-recovery';
const CONTROL_IMAGE = 'node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5';
const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);

function tarHeader(name, mode, size, type = '0') {
  const header = Buffer.alloc(512); const write = (value, offset, length) => header.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'ascii');
  write(name, 0, 100); write(mode.toString(8).padStart(7, '0') + '\0', 100, 8); write('0000000\0', 108, 8); write('0000000\0', 116, 8);
  write(size.toString(8).padStart(11, '0') + '\0', 124, 12); write('00000000000\0', 136, 12); header.fill(0x20, 148, 156); header[156] = type.charCodeAt(0);
  write('ustar\0', 257, 6); write('00', 263, 2); write('root', 265, 32); write('root', 297, 32);
  let sum = 0; for (const value of header) sum += value; write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8); return header;
}
function paxComment(gitSha) {
  const body = `comment=${gitSha}\n`; let length = Buffer.byteLength(body) + 3;
  while (true) { const record = `${length} ${body}`; if (Buffer.byteLength(record) === length) return Buffer.from(record); length = Buffer.byteLength(record); }
}
async function sourceArchive(source, inv, gitSha) {
  const blocks = []; const append = (header, content = Buffer.alloc(0)) => { blocks.push(header, content); const padding = (512 - (content.length % 512)) % 512; if (padding) blocks.push(Buffer.alloc(padding)); };
  const pax = paxComment(gitSha); append(tarHeader('pax_global_header', 0o644, pax.length, 'g'), pax); append(tarHeader('source/', 0o755, 0, '5'));
  for (const entry of inv.entries) {
    const name = `source/${entry.path}${entry.type === 'directory' ? '/' : ''}`; const mode = entry.mode === '0555' ? 0o755 : 0o644;
    if (entry.type === 'directory') append(tarHeader(name, mode, 0, '5'));
    else { const content = await readFile(join(source, ...entry.path.split('/'))); append(tarHeader(name, mode, content.length), content); }
  }
  blocks.push(Buffer.alloc(1024)); return Buffer.concat(blocks);
}

async function payload(root, marker, cliGuardMarker = null) {
  await mkdir(join(root, 'control-plane', 'ops', 'release'), { recursive: true });
  const files = new Map([
    ['run-booking-preprod-control-plane', `#!/bin/sh\n# ${marker}\n`], ['switch-preprod-ingress', `#!/bin/sh\n# ${marker}\n`],
    ['switch-preprod-ingress.mjs', `export const marker='${marker}';\n`],
    ['control-plane/ops/release/execute-fenced-action.mjs', cliGuardMarker
      ? `import { writeFileSync } from 'node:fs';\nimport { resolve } from 'node:path';\nimport { fileURLToPath } from 'node:url';\nexport const marker='${marker}-execute';\nif (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) writeFileSync(${JSON.stringify(cliGuardMarker)}, 'CLI guard executed\\n');\n`
      : `export const marker='${marker}-execute';\n`],
    ['control-plane/ops/release/manage-deploy-state.mjs', `export const marker='${marker}-state';\n`],
    ['control-plane/ops/release/generate-database-backup-receipt.mjs', `export const marker='${marker}-backup';\n`],
    ['control-plane/ops/release/generate-schema-diff-receipt.mjs', `export const marker='${marker}-schema';\n`],
    ['control-plane/ops/release/run-booking-preprod-control-plane-installer', `#!/bin/sh\n# ${marker}-installer-launcher\n`],
  ]);
  for (const [name, value] of files) {
    const path = join(root, ...name.split('/')); await writeFile(path, value);
    await chmod(path, name === 'run-booking-preprod-control-plane' || name === 'switch-preprod-ingress' || name.endsWith('run-booking-preprod-control-plane-installer') ? 0o555 : 0o444);
  }
  for (const path of [join(root, 'control-plane', 'ops', 'release'), join(root, 'control-plane', 'ops'), join(root, 'control-plane'), root]) await chmod(path, 0o555);
}

async function fixture({ cliGuard = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'booking-installer-v2-'));
  const cliGuardMarker = cliGuard ? join(root, 'cli-guard-executed.txt') : null;
  const parent = join(root, 'usr', 'local', 'libexec'); const installRoot = join(parent, 'happybooking'); const rollbackRoot = join(parent, 'happybooking.rollback');
  const g4 = join(root, 'volume1', 'happybooking', 'booking-preprod', '.g4'); const bundleRoot = join(g4, 'control-plane-install', 'bundles'); const approvalRoot = join(g4, 'control-plane-install', 'approvals'); const receiptRoot = join(g4, 'receipts');
  const paths = { installRoot, rollbackRoot, bundleRoot, receiptRoot, lockPath: join(parent, '.happybooking-control-plane-install.lock'),
    approvalRoot, hostIdentityPath: join(root, 'etc', 'machine-id'), journalPath: join(parent, '.happybooking-control-plane-install.journal.json'),
    runtimeLockPath: join(parent, '.happybooking-control-plane-runtime.lock'),
    migrationLockPath: join(parent, '.happybooking-legacy-active-migration.lock'),
    migrationJournalPath: join(parent, '.happybooking-legacy-active-migration.journal.json'),
    deployStatePath: join(root, 'var', 'lib', 'happybooking', 'deploy-state', 'preprod', 'booking-preprod', 'deploy-state.json') };
  await mkdir(parent, { recursive: true }); await mkdir(bundleRoot, { recursive: true }); await mkdir(approvalRoot, { recursive: true }); await mkdir(receiptRoot, { recursive: true });
  await mkdir(dirname(paths.hostIdentityPath), { recursive: true }); await writeFile(paths.hostIdentityPath, '0123456789abcdef0123456789abcdef\n');
  await payload(installRoot, 'old'); await payload(rollbackRoot, 'older');
  const bundle = join(bundleRoot, ID); const source = join(bundle, 'payload'); await mkdir(source, { recursive: true }); await payload(source, 'new', cliGuardMarker);
  const installerBytes = await readFile(join(repo, 'ops', 'release', 'install-booking-preprod-control-plane.mjs'));
  await writeFile(join(bundle, 'installer.mjs'), installerBytes); await chmod(join(bundle, 'installer.mjs'), 0o555);
  const inv = await inspectControlPlaneInventory(source, { uid: null, source: true, enforceMode: false });
  const archiveBytes = await sourceArchive(source, inv, GIT); await writeFile(join(bundle, 'source-archive.tar'), archiveBytes); await chmod(join(bundle, 'source-archive.tar'), 0o444);
  const trackedFiles = inv.entries.filter((entry) => entry.type === 'file').map((entry) => entry.path).sort();
  const payloadMap = trackedFiles.map((path) => ({ payloadPath: path, sourcePath: path }));
  const archiveCommand = ['git', 'archive', '--format=tar', '--prefix=source/', GIT, '--', ...trackedFiles];
  const declaration = { schema: 'booking.preprod-control-plane-bundle/v1', installId: ID, gitSha: GIT, approvalId: APPROVAL,
    sourceArchiveDigest: digest(archiveBytes), installerDigest: digest(installerBytes),
    inventoryDigest: inv.digest, trackedAllowlistDigest: digest(canonical(trackedFiles)), trackedFiles,
    payloadMap, payloadMapDigest: digest(canonical(payloadMap)), archiveCommand, archiveCommandDigest: digest(canonical(archiveCommand)) };
  await writeFile(join(bundle, 'bundle-declaration.json'), `${canonical(declaration)}\n`); await chmod(join(bundle, 'bundle-declaration.json'), 0o444);
  const approvalDirectory = join(approvalRoot, ID); await mkdir(approvalDirectory, { recursive: true });
  const bootstrapInstallerLauncherDigest = digest(await readFile(join(source, 'control-plane', 'ops', 'release', 'run-booking-preprod-control-plane-installer')));
  const tupleBody = { schema: 'booking.preprod-control-plane-approval-tuple/v1', status: 'awaiting-independent-approval', installId: ID, gitSha: GIT, approvalId: APPROVAL,
    archiveCommand, archiveCommandDigest: declaration.archiveCommandDigest, sourceArchiveDigest: declaration.sourceArchiveDigest, payloadMapDigest: declaration.payloadMapDigest,
    inventoryDigest: declaration.inventoryDigest, installerDigest: declaration.installerDigest, bootstrapInstallerLauncherDigest, declarationDigest: digest(canonical(declaration)) };
  const tuple = { ...tupleBody, tupleDigest: digest(canonical(tupleBody)) };
  const active = await inspectControlPlaneInventory(installRoot, { uid: null, enforceMode: false });
  const approverBody = { schema: 'booking.preprod.control-plane-approval-receipt/v2', status: 'approved', environment: 'preprod', project: 'booking-preprod',
    installId: ID, gitSha: GIT, approvalId: APPROVAL, tupleDigest: tuple.tupleDigest, approverIdentity: 'release.approver.test', publicKeyDigest: digest('approver-public-key'),
    hostIdentityDigest: digest(await readFile(paths.hostIdentityPath)), expectedActiveInventoryDigest: active.digest,
    activeInventoryObservedAt: '2026-09-12T02:03:02.000Z', approvedAt: '2026-09-12T02:03:03.000Z' };
  const approverReceipt = { ...approverBody, receiptDigest: digest(canonical(approverBody)) };
  await writeFile(join(approvalDirectory, 'approval-tuple.json'), `${canonical(tuple)}\n`); await writeFile(join(approvalDirectory, 'approver-receipt.json'), `${canonical(approverReceipt)}\n`); await writeFile(join(approvalDirectory, 'approver-receipt.sig'), 'test-signature\n');
  const runtime = { paths, expectedUid: null, enforceMode: false, portableReplace: true, now: '2026-09-12T02:03:04.000Z',
    processIdentity: { pid: 4242, bootId: '11111111-1111-4111-8111-111111111111', processStartTicks: '100', containerId: 'c'.repeat(64) }, isProcessAlive: async () => false,
    assertNormalInstallerAbsent: async () => {}, syncDirectory: async () => {}, syncFile: async () => {}, assertQuiescent: async () => {}, assertNotMountpoints: async () => {}, smokeStage: async () => {}, verifyApprovalSignature: async () => {} };
  const installArgs = ['--action', 'install', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL,
    '--source-archive-digest', declaration.sourceArchiveDigest, '--installer-digest', declaration.installerDigest,
    '--bundle-declaration-digest', digest(canonical(declaration)), '--tracked-allowlist-digest', declaration.trackedAllowlistDigest,
    '--expected-inventory-digest', inv.digest,
    '--approval-tuple-digest', tuple.tupleDigest, '--approver-receipt-digest', approverReceipt.receiptDigest];
  return { root, paths, source, runtime, inv, active, declaration, tuple, approverReceipt, installArgs, cliGuardMarker };
}
const recoverArgs = (journal) => ['--action', 'recover', '--install-id', journal.installId, '--git-sha', journal.gitSha, '--approval-id', journal.approvalId, '--transaction-id', journal.transactionId];
async function recoveryIdentity(paths) {
  if (await existsLocal(paths.journalPath)) return JSON.parse(await readFile(paths.journalPath, 'utf8'));
  if (await existsLocal(join(paths.lockPath, 'owner.json'))) return JSON.parse(await readFile(join(paths.lockPath, 'owner.json'), 'utf8'));
  const prefix = `${basename(paths.lockPath)}.`; const suffix = '.tmp';
  const entry = (await readdir(dirname(paths.lockPath))).find((name) => name.startsWith(prefix) && name.endsWith(suffix));
  if (!entry) throw new Error('no recoverable identity');
  return { transactionId: entry.slice(prefix.length, -suffix.length), installId: ID, gitSha: GIT, approvalId: APPROVAL };
}

const inspectedContainer = (id, name, running, pid = 4242) => ({ Id: id, Name: `/${name}`, State: { Running: running, Pid: pid },
  HostConfig: { PidMode: 'host' }, Config: { Image: CONTROL_IMAGE } });

function dockerRecoveryRuntime(f, inspectContainer) {
  const runtime = { ...f.runtime, processIdentity: { pid: 5252, bootId: '22222222-2222-4222-8222-222222222222', processStartTicks: '200', containerId: 'd'.repeat(64), containerName: RECOVERY_NAME }, inspectContainer };
  delete runtime.isProcessAlive; delete runtime.assertNormalInstallerAbsent; return runtime;
}

test('full identity-bound install, receipt-derived readback, exclusive receipt and old-tree rollback pass', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const listed = await runControlPlaneInstaller(['--action', 'inventory', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL], f.runtime);
  assert.equal(listed.inventoryDigest, f.inv.digest); assert.equal(listed.declarationDigest, digest(canonical(f.declaration)));
  const receipt = await runControlPlaneInstaller(f.installArgs, f.runtime);
  for (const key of ['gitSha', 'approvalId', 'sourceArchiveDigest', 'installerDigest', 'bundleDeclarationDigest', 'trackedAllowlistDigest', 'payloadMapDigest', 'archiveCommandDigest', 'approvalTupleDigest', 'approverReceiptDigest', 'approverIdentity', 'approverPublicKeyDigest', 'oldActiveInventoryDigest', 'receiptDigest']) assert.ok(receipt[key]);
  const readback = await runControlPlaneInstaller(['--action', 'readback', '--install-id', ID, '--expected-receipt-digest', receipt.receiptDigest], f.runtime);
  assert.equal(readback.gitSha, GIT); assert.equal(readback.inventoryDigest, f.inv.digest);
  const rollback = await runControlPlaneInstaller(['--action', 'rollback', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL,
    '--rollback-id', ID, '--expected-active-inventory-digest', f.inv.digest, '--expected-rollback-inventory-digest', f.active.digest], f.runtime);
  assert.equal(rollback.inventoryDigest, f.active.digest); assert.match(await readFile(join(f.paths.installRoot, 'run-booking-preprod-control-plane'), 'utf8'), /old/);
});

test('active inventory is fixed-path, strict, host-bound and read-only', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const result = await runControlPlaneInstaller(['--action', 'active-inventory', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL], f.runtime);
  assert.equal(result.schema, 'booking.preprod-control-plane-active-inventory/v1');
  assert.equal(result.inventoryDigest, f.active.digest);
  assert.equal(result.hostIdentityDigest, digest(await readFile(f.paths.hostIdentityPath)));
  assert.equal(result.observedAt, f.runtime.now);
  await assert.rejects(runControlPlaneInstaller(['--action', 'active-inventory', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL,
    '--path', f.paths.installRoot], f.runtime), /unsupported option/);
  const real = `${f.paths.installRoot}.real`; await rename(f.paths.installRoot, real); await symlink(real, f.paths.installRoot);
  await assert.rejects(runControlPlaneInstaller(['--action', 'active-inventory', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL], f.runtime), /real directory|symlink/);
});

test('bundle inventory verifies only the immutable bundle before receipt and quiescence gates', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const missingParent = join(f.root, 'missing-install-parent');
  const result = await runControlPlaneInstaller(['--action', 'bundle-inventory', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL], {
    ...f.runtime, paths: { ...f.paths, installRoot: join(missingParent, 'happybooking'), rollbackRoot: join(missingParent, 'happybooking.rollback'),
      lockPath: join(missingParent, '.install.lock'), journalPath: join(missingParent, '.install.journal.json'),
      migrationLockPath: join(missingParent, '.migration.lock'), migrationJournalPath: join(missingParent, '.migration.journal.json'), receiptRoot: join(f.root, 'missing-receipts') },
    assertQuiescent: async () => { throw new Error('must not run'); },
  });
  assert.equal(result.action, 'bundle-inventory'); assert.equal(result.inventoryDigest, f.inv.digest);
});

test('bundle inventory rejects hardlink aliases and actual payload mode drift', async (t) => {
  for (const scenario of ['hardlink', 'file-mode', 'directory-mode', 'root-mode']) {
    if (process.platform === 'win32' && scenario !== 'hardlink') continue;
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    const payloadRoot = join(f.paths.bundleRoot, ID, 'payload');
    if (scenario === 'hardlink') await link(join(payloadRoot, 'switch-preprod-ingress.mjs'), join(f.root, 'outside-alias'));
    if (scenario === 'file-mode') await chmod(join(payloadRoot, 'switch-preprod-ingress'), 0o744);
    if (scenario === 'directory-mode') await chmod(join(payloadRoot, 'control-plane', 'ops'), 0o755);
    if (scenario === 'root-mode') await chmod(payloadRoot, 0o755);
    await assert.rejects(runControlPlaneInstaller(['--action', 'bundle-inventory', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL], { ...f.runtime, enforceMode: scenario !== 'hardlink' }), /hard-linked|mode drift/, scenario);
  }
});

test('install re-inventories active and rejects mutation after independently approved inventory', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const target = join(f.paths.installRoot, 'run-booking-preprod-control-plane');
  await chmod(target, 0o600); await writeFile(target, '#!/bin/sh\n# changed-after-approval\n'); await chmod(target, 0o555);
  await assert.rejects(runControlPlaneInstaller(f.installArgs, f.runtime), /independently approved inventory/);
  assert.match(await readFile(target, 'utf8'), /changed-after-approval/);
  assert.equal(await existsLocal(f.paths.journalPath), false);
});

test('approval cannot predate the active inventory observation', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const path = join(f.paths.approvalRoot, ID, 'approver-receipt.json');
  const receipt = JSON.parse(await readFile(path, 'utf8')); receipt.approvedAt = '2026-09-12T02:03:01.000Z';
  const { receiptDigest: ignored, ...body } = receipt; receipt.receiptDigest = digest(canonical(body)); await chmod(path, 0o600); await writeFile(path, `${canonical(receipt)}\n`); await chmod(path, 0o400);
  const args = [...f.installArgs]; args[args.indexOf('--approver-receipt-digest') + 1] = receipt.receiptDigest;
  await assert.rejects(runControlPlaneInstaller(args, f.runtime), /not bound to the approval tuple/);
});

test('migration approval-check binds v3 action, migration, transaction and verification time', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const migrationId = 'booking-legacy-active-20260913T010203Z-536b435723ae'; const transactionId = '10000000-0000-4000-8000-000000000013';
  const path = join(f.paths.approvalRoot, ID, 'approver-receipt.json');
  async function save(overrides = {}) {
    const base = { ...f.approverReceipt, schema: 'booking.preprod.control-plane-approval-receipt/v3', migrationContext: { migrationId, allowedActions: ['migrate', 'recover'], transactionId,
      predecessorReceiptDigest: null, expectedNormalizedInventoryDigest: null }, ...overrides }; delete base.receiptDigest;
    const receipt = { ...base, receiptDigest: digest(canonical(base)) }; await chmod(path, 0o600); await writeFile(path, `${canonical(receipt)}\n`); await chmod(path, 0o400); return receipt;
  }
  const receipt = await save();
  const args = ['--action', 'approval-check', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL, '--approval-tuple-digest', f.tuple.tupleDigest,
    '--approver-receipt-digest', receipt.receiptDigest, '--migration-id', migrationId, '--migration-action', 'migrate', '--transaction-id', transactionId];
  const result = await runControlPlaneInstaller(args, f.runtime); assert.equal(result.status, 'pass'); assert.equal(result.transactionId, transactionId);
  const wrongAction = [...args]; wrongAction[wrongAction.indexOf('--migration-action') + 1] = 'rollback';
  await assert.rejects(runControlPlaneInstaller(wrongAction, f.runtime), /migration approval context/);
  const wrongId = [...args]; wrongId[wrongId.indexOf('--migration-id') + 1] = 'booking-legacy-active-20260913T010203Z-000000000000';
  await assert.rejects(runControlPlaneInstaller(wrongId, f.runtime), /migration approval context/);
  const future = await save({ approvedAt: '2026-09-12T02:03:05.000Z' }); const futureArgs = [...args]; futureArgs[futureArgs.indexOf('--approver-receipt-digest') + 1] = future.receiptDigest;
  await assert.rejects(runControlPlaneInstaller(futureArgs, f.runtime), /verification time/);
});

test('rollback and rollback-recovery approval-check bind the immutable predecessor receipt', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const migrationId = 'booking-legacy-active-20260913T010203Z-536b435723ae'; const transactionId = '10000000-0000-4000-8000-000000000014';
  const normalized = digest('normalized-tree');
  const predecessorBody = { schema: 'booking.preprod-legacy-active-migration-receipt/v1', status: 'pass', action: 'migrate', environment: 'preprod', project: 'booking-preprod',
    transactionId: '10000000-0000-4000-8000-000000000013', migrationId, approvalId: 'approval.g4.legacy.migrate', rawInventoryDigest: f.active.digest,
    normalizedInventoryDigest: normalized, rawArchiveName: `.happybooking-legacy-raw-${migrationId}`, migratedAt: '2026-09-12T02:03:03.000Z' };
  const predecessor = { ...predecessorBody, receiptDigest: digest(canonical(predecessorBody)) };
  const predecessorPath = join(f.paths.receiptRoot, `control-plane-legacy-migration-${migrationId}.json`); await writeFile(predecessorPath, `${canonical(predecessor)}\n`); await chmod(predecessorPath, 0o400);
  const receiptBody = { ...f.approverReceipt, schema: 'booking.preprod.control-plane-approval-receipt/v3', migrationContext: { migrationId, allowedActions: ['rollback', 'recover'], transactionId,
    predecessorReceiptDigest: predecessor.receiptDigest, expectedNormalizedInventoryDigest: normalized } }; delete receiptBody.receiptDigest;
  const receipt = { ...receiptBody, receiptDigest: digest(canonical(receiptBody)) }; const receiptPath = join(f.paths.approvalRoot, ID, 'approver-receipt.json');
  await chmod(receiptPath, 0o600); await writeFile(receiptPath, `${canonical(receipt)}\n`); await chmod(receiptPath, 0o400);
  const common = ['--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL, '--approval-tuple-digest', f.tuple.tupleDigest, '--approver-receipt-digest', receipt.receiptDigest,
    '--migration-id', migrationId, '--transaction-id', transactionId, '--predecessor-receipt-digest', predecessor.receiptDigest, '--expected-normalized-inventory-digest', normalized];
  for (const action of ['rollback', 'recover']) {
    const result = await runControlPlaneInstaller(['--action', 'approval-check', ...common, '--migration-action', action], f.runtime); assert.equal(result.action, action);
  }
  const wrong = ['--action', 'approval-check', ...common, '--migration-action', 'rollback']; wrong[wrong.indexOf('--predecessor-receipt-digest') + 1] = digest('wrong');
  await assert.rejects(runControlPlaneInstaller(wrong, f.runtime), /migration approval context|predecessor/);
});

test('every install rename/journal/receipt crash point is restart-recoverable without deleting the stale lock', async (t) => {
  const points = ['lock:acquired', 'journal:prepared', 'journal:linked', 'journal:PREPARED', 'rename:old-retired', 'journal:OLD_RETIRED', 'rename:active-moved', 'journal:ACTIVE_MOVED',
    'rename:new-active', 'journal:NEW_ACTIVE', 'receipt:published', 'journal:RECEIPT_PUBLISHED', 'journal:COMPLETE'];
  points.splice(7, 0, 'receipt:prepared', 'receipt:linked');
  points.push('journal:removed');
  for (const point of points) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, crashAt: point }), SimulatedInstallCrash, point);
    assert.equal(await existsLocal(f.paths.lockPath), true, `${point}: lock must survive crash`);
    await assert.rejects(runControlPlaneInstaller(f.installArgs, f.runtime), /requires recover/);
    const journal = await recoveryIdentity(f.paths);
    const recovered = await runControlPlaneInstaller(recoverArgs(journal), f.runtime);
    assert.ok(['completed', 'rolled-back', 'cleared-pre-journal-lock', 'cleared-incomplete-lock'].includes(recovered.status)); assert.equal(await existsLocal(f.paths.lockPath), false); assert.equal(await existsLocal(f.paths.journalPath), false);
    const active = await inspectControlPlaneInventory(f.paths.installRoot, { uid: null, enforceMode: false });
    const shouldBeNew = recovered.status === 'completed' || (point === 'journal:removed');
    assert.equal(active.digest, shouldBeNew ? f.inv.digest : f.active.digest, point);
  }
});

test('every rollback rename/journal/receipt crash point restores or completes one exact two-tree state', async (t) => {
  const points = ['lock:acquired', 'journal:prepared', 'journal:linked', 'journal:PREPARED', 'rename:rollback-retired', 'journal:OLD_RETIRED', 'rename:rollback-active-moved', 'journal:ACTIVE_MOVED',
    'rename:rollback-new-active', 'journal:NEW_ACTIVE', 'receipt:published', 'journal:RECEIPT_PUBLISHED', 'journal:COMPLETE'];
  points.splice(7, 0, 'receipt:prepared', 'receipt:linked');
  points.push('journal:removed');
  for (const point of points) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await runControlPlaneInstaller(f.installArgs, f.runtime);
    const args = ['--action', 'rollback', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL, '--rollback-id', ID,
      '--expected-active-inventory-digest', f.inv.digest, '--expected-rollback-inventory-digest', f.active.digest];
    await assert.rejects(runControlPlaneInstaller(args, { ...f.runtime, crashAt: point }), SimulatedInstallCrash, point);
    const journal = await recoveryIdentity(f.paths);
    const recovered = await runControlPlaneInstaller(recoverArgs(journal), f.runtime);
    const active = await inspectControlPlaneInventory(f.paths.installRoot, { uid: null, enforceMode: false });
    const shouldBeRolledBack = recovered.status === 'completed' || point === 'journal:removed';
    assert.equal(active.digest, shouldBeRolledBack ? f.active.digest : f.inv.digest, point);
  }
});

test('every repeated journal temp crash is reconciled before recovery writes COMPLETE', async (t) => {
  for (const action of ['install', 'rollback']) for (const point of ['journal:prepared', 'journal:linked']) for (let occurrence = 1; occurrence <= 6; occurrence += 1) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    let args = f.installArgs;
    if (action === 'rollback') {
      await runControlPlaneInstaller(f.installArgs, f.runtime);
      args = ['--action', 'rollback', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL, '--rollback-id', ID,
        '--expected-active-inventory-digest', f.inv.digest, '--expected-rollback-inventory-digest', f.active.digest];
    }
    await assert.rejects(runControlPlaneInstaller(args, { ...f.runtime, checkpointCounts: new Map(), crashAt: point, crashAtOccurrence: occurrence }), SimulatedInstallCrash, `${action}:${point}#${occurrence}`);
    const identity = await recoveryIdentity(f.paths); const recovered = await runControlPlaneInstaller(recoverArgs(identity), f.runtime);
    assert.ok(['completed', 'rolled-back', 'cleared-pre-journal-lock'].includes(recovered.status), `${action}:${point}#${occurrence}`);
    assert.equal(await existsLocal(f.paths.journalPath), false); assert.equal(await existsLocal(f.paths.lockPath), false);
  }
});

test('a second crash during install or rollback recovery remains restart-recoverable', async (t) => {
  for (const recoveryPoint of ['recover:new-quarantined', 'recover:active-restored', 'recover:rollback-restored']) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, crashAt: 'rename:new-active' }), SimulatedInstallCrash);
    const journal = JSON.parse(await readFile(f.paths.journalPath, 'utf8'));
    await assert.rejects(runControlPlaneInstaller(recoverArgs(journal), { ...f.runtime, crashAt: recoveryPoint }), SimulatedInstallCrash, recoveryPoint);
    const recovered = await runControlPlaneInstaller(recoverArgs(journal), f.runtime);
    assert.equal(recovered.status, 'rolled-back', recoveryPoint);
    assert.equal((await inspectControlPlaneInventory(f.paths.installRoot, { uid: null, enforceMode: false })).digest, f.active.digest);
  }
  for (const recoveryPoint of ['recover:rollback-active-quarantined', 'recover:rollback-active-restored', 'recover:rollback-target-restored']) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await runControlPlaneInstaller(f.installArgs, f.runtime);
    const args = ['--action', 'rollback', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL, '--rollback-id', ID,
      '--expected-active-inventory-digest', f.inv.digest, '--expected-rollback-inventory-digest', f.active.digest];
    await assert.rejects(runControlPlaneInstaller(args, { ...f.runtime, crashAt: 'rename:rollback-new-active' }), SimulatedInstallCrash);
    const journal = JSON.parse(await readFile(f.paths.journalPath, 'utf8'));
    await assert.rejects(runControlPlaneInstaller(recoverArgs(journal), { ...f.runtime, crashAt: recoveryPoint }), SimulatedInstallCrash, recoveryPoint);
    const recovered = await runControlPlaneInstaller(recoverArgs(journal), f.runtime);
    assert.equal(recovered.status, 'rolled-back', recoveryPoint);
    assert.equal((await inspectControlPlaneInventory(f.paths.installRoot, { uid: null, enforceMode: false })).digest, f.inv.digest);
  }
});

test('copy/smoke failures retain the durable journal and recover the exact old trees', async (t) => {
  for (const failure of ['copy', 'smoke']) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    const runtime = failure === 'copy'
      ? { ...f.runtime, syncFile: async (path) => { if (path.includes(`.happybooking-control-plane-stage-${ID}`)) throw new Error('copy fsync failed'); } }
      : { ...f.runtime, smokeStage: async () => { throw new Error('smoke failed'); } };
    await assert.rejects(runControlPlaneInstaller(f.installArgs, runtime), new RegExp(failure));
    const journal = JSON.parse(await readFile(f.paths.journalPath, 'utf8'));
    const recovered = await runControlPlaneInstaller(recoverArgs(journal), f.runtime);
    assert.equal(recovered.status, 'rolled-back');
    assert.equal((await inspectControlPlaneInventory(f.paths.installRoot, { uid: null, enforceMode: false })).digest, f.active.digest);
  }
});

test('import smoke keeps real module CLI main guards dormant', async (t) => {
  const f = await fixture({ cliGuard: true }); t.after(() => rm(f.root, { recursive: true, force: true }));
  const guardedModule = join(f.source, 'control-plane', 'ops', 'release', 'execute-fenced-action.mjs');
  const oldProgram = "import {pathToFileURL} from 'node:url'; for (const p of process.argv.slice(1)) await import(pathToFileURL(p).href);";
  const oldImport = spawnSync(process.execPath, ['--input-type=module', '--eval', oldProgram, guardedModule], { encoding: 'utf8' });
  assert.equal(oldImport.status, 0); assert.equal(await readFile(f.cliGuardMarker, 'utf8'), 'CLI guard executed\n'); await rm(f.cliGuardMarker);
  const runtime = { ...f.runtime }; delete runtime.smokeStage;
  await assert.rejects(runControlPlaneInstaller(f.installArgs, runtime), /launcher dry-run smoke failed/);
  assert.equal(await existsLocal(f.cliGuardMarker), false);
});

test('quiescence, mountpoint, dependency closure, receipt identity and readback path fail closed', async (t) => {
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, assertQuiescent: async () => { throw new Error('active lease'); } }), /active lease/);
    assert.equal(await existsLocal(f.paths.lockPath), false);
    await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, assertNotMountpoints: async () => { throw new Error('mountpoint'); } }), /mountpoint/);
    assert.equal(await existsLocal(f.paths.lockPath), false); assert.equal(await existsLocal(f.paths.journalPath), false);
  }
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); let checks = 0;
    await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, assertQuiescent: async () => { checks += 1; if (checks === 3) throw new Error('late runtime appeared'); } }), /late runtime/);
    assert.equal(checks, 3); assert.equal(await existsLocal(f.paths.journalPath), true);
    const journal = await recoveryIdentity(f.paths); assert.equal((await runControlPlaneInstaller(recoverArgs(journal), f.runtime)).status, 'rolled-back');
  }
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, assertNotMountpoints: undefined, mountedPaths: [join(f.paths.installRoot, 'nested')] }), /must not contain a mountpoint/);
    assert.equal(await existsLocal(f.paths.journalPath), false);
  }
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    const changed = join(f.source, 'control-plane', 'ops', 'release', 'execute-fenced-action.mjs');
    await chmod(changed, 0o644); await writeFile(changed, "import './not-declared.mjs';\n"); await chmod(changed, 0o444);
    const inv = await inspectControlPlaneInventory(f.source, { uid: null, source: true, enforceMode: false });
    const archivePath = join(f.paths.bundleRoot, ID, 'source-archive.tar'); const archiveBytes = await sourceArchive(f.source, inv, GIT); await chmod(archivePath, 0o600); await writeFile(archivePath, archiveBytes); await chmod(archivePath, 0o444);
    f.declaration.sourceArchiveDigest = digest(archiveBytes); f.declaration.inventoryDigest = inv.digest;
    const declarationPath = join(f.paths.bundleRoot, ID, 'bundle-declaration.json');
    await chmod(declarationPath, 0o644); await writeFile(declarationPath, `${canonical(f.declaration)}\n`); await chmod(declarationPath, 0o444);
    const args = [...f.installArgs]; args[args.indexOf('--source-archive-digest') + 1] = f.declaration.sourceArchiveDigest; args[args.indexOf('--expected-inventory-digest') + 1] = inv.digest; args[args.indexOf('--bundle-declaration-digest') + 1] = digest(canonical(f.declaration));
    await assert.rejects(runControlPlaneInstaller(args, f.runtime), /outside tracked closure/);
  }
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    const receipt = await runControlPlaneInstaller(f.installArgs, f.runtime);
    await assert.rejects(runControlPlaneInstaller(['--action', 'readback', '--install-id', '../../escape', '--expected-receipt-digest', receipt.receiptDigest], f.runtime), /install ID invalid/);
    await assert.rejects(runControlPlaneInstaller(['--action', 'readback', '--install-id', ID, '--expected-receipt-digest', digest('wrong')], f.runtime), /identity/);
    const receiptPath = join(f.paths.receiptRoot, `control-plane-install-${ID}.json`); const altered = JSON.parse(await readFile(receiptPath, 'utf8'));
    altered.unreviewed = true; delete altered.receiptDigest; altered.receiptDigest = digest(canonical(altered)); await chmod(receiptPath, 0o600); await writeFile(receiptPath, `${canonical(altered)}\n`); await chmod(receiptPath, 0o400);
    await assert.rejects(runControlPlaneInstaller(['--action', 'readback', '--install-id', ID, '--expected-receipt-digest', altered.receiptDigest], f.runtime), /fields are invalid/);
  }
});

test('installer refuses legacy migration lock and journal before any install transaction mutation', async (t) => {
  for (const [label, conflictPath, message] of [
    ['migration lock', 'migrationLockPath', /legacy active migration lock exists/],
    ['migration journal', 'migrationJournalPath', /legacy active migration journal exists/],
  ]) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    const activeBefore = await inspectControlPlaneInventory(f.paths.installRoot, { uid: null, enforceMode: false });
    const rollbackBefore = await inspectControlPlaneInventory(f.paths.rollbackRoot, { uid: null, enforceMode: false });
    await writeFile(f.paths[conflictPath], `${label}\n`);
    await assert.rejects(runControlPlaneInstaller(f.installArgs, f.runtime), message);
    assert.equal(await existsLocal(f.paths.lockPath), false, label);
    assert.equal(await existsLocal(f.paths.journalPath), false, label);
    assert.equal((await inspectControlPlaneInventory(f.paths.installRoot, { uid: null, enforceMode: false })).digest, activeBefore.digest, label);
    assert.equal((await inspectControlPlaneInventory(f.paths.rollbackRoot, { uid: null, enforceMode: false })).digest, rollbackBefore.digest, label);
  }
});

test('migration lock appearing after initial quiescence but before installer lock publication stops before stage or rename', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const activeBefore = await inspectControlPlaneInventory(f.paths.installRoot, { uid: null, enforceMode: false });
  const rollbackBefore = await inspectControlPlaneInventory(f.paths.rollbackRoot, { uid: null, enforceMode: false });
  let injected = false; let installerLockPublished = false;
  const runtime = { ...f.runtime, checkpoint: async (point) => {
    if (point === 'quiescence:before-install-lock' && !injected) {
      injected = true;
      await writeFile(f.paths.migrationLockPath, 'late migration lock\n');
    }
    if (point === 'lock:acquired') installerLockPublished = true;
  } };
  await assert.rejects(runControlPlaneInstaller(f.installArgs, runtime), /legacy active migration lock exists/);
  assert.equal(injected, true); assert.equal(installerLockPublished, true);
  assert.equal(await existsLocal(f.paths.lockPath), false);
  assert.equal(await existsLocal(f.paths.journalPath), false);
  assert.equal((await inspectControlPlaneInventory(f.paths.installRoot, { uid: null, enforceMode: false })).digest, activeBefore.digest);
  assert.equal((await inspectControlPlaneInventory(f.paths.rollbackRoot, { uid: null, enforceMode: false })).digest, rollbackBefore.digest);
});

test('archive bytes, lock owner and journal-derived paths cannot be forged during recovery', async (t) => {
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    const archive = join(f.paths.bundleRoot, ID, 'source-archive.tar'); await chmod(archive, 0o644); await writeFile(archive, 'changed'); await chmod(archive, 0o444);
    await assert.rejects(runControlPlaneInstaller(f.installArgs, f.runtime), /source archive digest/);
  }
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const oldInv = await inspectControlPlaneInventory(f.paths.installRoot, { uid: null, source: true, enforceMode: false });
    const archiveBytes = await sourceArchive(f.paths.installRoot, oldInv, GIT); const archive = join(f.paths.bundleRoot, ID, 'source-archive.tar'); await chmod(archive, 0o600); await writeFile(archive, archiveBytes); await chmod(archive, 0o444);
    f.declaration.sourceArchiveDigest = digest(archiveBytes); const declarationPath = join(f.paths.bundleRoot, ID, 'bundle-declaration.json'); await chmod(declarationPath, 0o600); await writeFile(declarationPath, `${canonical(f.declaration)}\n`); await chmod(declarationPath, 0o444);
    const args = [...f.installArgs]; args[args.indexOf('--source-archive-digest') + 1] = f.declaration.sourceArchiveDigest; args[args.indexOf('--bundle-declaration-digest') + 1] = digest(canonical(f.declaration));
    await assert.rejects(runControlPlaneInstaller(args, f.runtime), /archive mapping does not reproduce payload/);
  }
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const archiveBytes = await sourceArchive(f.source, f.inv, OLD_GIT);
    const archive = join(f.paths.bundleRoot, ID, 'source-archive.tar'); await chmod(archive, 0o600); await writeFile(archive, archiveBytes); await chmod(archive, 0o444);
    f.declaration.sourceArchiveDigest = digest(archiveBytes); const declarationPath = join(f.paths.bundleRoot, ID, 'bundle-declaration.json'); await chmod(declarationPath, 0o600); await writeFile(declarationPath, `${canonical(f.declaration)}\n`); await chmod(declarationPath, 0o444);
    const args = [...f.installArgs]; args[args.indexOf('--source-archive-digest') + 1] = f.declaration.sourceArchiveDigest; args[args.indexOf('--bundle-declaration-digest') + 1] = digest(canonical(f.declaration));
    await assert.rejects(runControlPlaneInstaller(args, f.runtime), /not bound to the declared Git SHA/);
  }
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, crashAt: 'lock:acquired' }), SimulatedInstallCrash);
    const owner = await recoveryIdentity(f.paths); const wrong = { ...owner, transactionId: '00000000-0000-4000-8000-000000000000' };
    await assert.rejects(runControlPlaneInstaller(recoverArgs(owner), { ...f.runtime, isProcessAlive: async () => true }), /still alive/); assert.equal(await existsLocal(f.paths.lockPath), true);
    await assert.rejects(runControlPlaneInstaller(recoverArgs(wrong), f.runtime), /lock owner/); assert.equal(await existsLocal(f.paths.lockPath), true);
    assert.equal((await runControlPlaneInstaller(recoverArgs(owner), f.runtime)).status, 'cleared-incomplete-lock');
  }
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, crashAt: 'rename:new-active' }), SimulatedInstallCrash);
    const journal = JSON.parse(await readFile(f.paths.journalPath, 'utf8')); journal.stageName = '../../escape';
    await chmod(f.paths.journalPath, 0o600); await writeFile(f.paths.journalPath, `${canonical(journal)}\n`); await chmod(f.paths.journalPath, 0o400);
    await assert.rejects(runControlPlaneInstaller(recoverArgs(journal), f.runtime), /journal path identity/); assert.equal(await existsLocal(f.paths.lockPath), true);
  }
});

test('atomic lock publication crashes and ENOSPC leave one recoverable, forensically receipted artifact', async (t) => {
  const points = ['lock:temp-created', 'lock:owner-written', 'lock:owner-prepared', 'lock:owner-linked', 'lock:published'];
  for (const point of points) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, crashAt: point }), SimulatedInstallCrash, point);
    const identity = await recoveryIdentity(f.paths);
    const recovered = await runControlPlaneInstaller(recoverArgs(identity), f.runtime);
    assert.equal(recovered.status, 'cleared-incomplete-lock', point);
    assert.equal(recovered.receipt.identityUnknown, !['lock:owner-linked', 'lock:published'].includes(point), point);
    assert.equal(await existsLocal(f.paths.lockPath), false, point);
    assert.equal((await readdir(dirname(f.paths.lockPath))).some((name) => name.startsWith(`${basename(f.paths.lockPath)}.`) && name.endsWith('.tmp')), false, point);
    const receiptPath = join(f.paths.receiptRoot, `control-plane-lock-recovery-${identity.transactionId}.json`);
    assert.equal(JSON.parse(await readFile(receiptPath, 'utf8')).artifactDigest, recovered.receipt.artifactDigest, point);
    assert.equal((await runControlPlaneInstaller(recoverArgs(identity), f.runtime)).status, 'incomplete-lock-already-cleared', point);
  }
  for (const point of ['lock:temp-created', 'lock:owner-written', 'lock:owner-prepared']) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    const runtime = { ...f.runtime, checkpoint: async (value) => { if (value === point) { const error = new Error(`ENOSPC at ${point}`); error.code = 'ENOSPC'; throw error; } } };
    await assert.rejects(runControlPlaneInstaller(f.installArgs, runtime), /ENOSPC/);
    const identity = await recoveryIdentity(f.paths);
    assert.equal((await runControlPlaneInstaller(recoverArgs(identity), f.runtime)).status, 'cleared-incomplete-lock');
  }
});

test('recover distinguishes absent, stopped, restarted, replaced and unavailable Docker owners on both reads', async (t) => {
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, crashAt: 'lock:acquired' }), SimulatedInstallCrash);
    const owner = await recoveryIdentity(f.paths); const stopped = inspectedContainer(owner.containerId, INSTALLER_NAME, false, owner.pid);
    const recovered = await runControlPlaneInstaller(recoverArgs(owner), dockerRecoveryRuntime(f, async (reference) =>
      [owner.containerId, INSTALLER_NAME].includes(reference) ? stopped : null));
    assert.equal(recovered.status, 'cleared-incomplete-lock');
  }
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, crashAt: 'lock:acquired' }), SimulatedInstallCrash);
    const owner = await recoveryIdentity(f.paths);
    assert.equal((await runControlPlaneInstaller(recoverArgs(owner), dockerRecoveryRuntime(f, async () => null))).status, 'cleared-incomplete-lock');
  }
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, crashAt: 'lock:acquired' }), SimulatedInstallCrash);
    const owner = await recoveryIdentity(f.paths); const running = inspectedContainer(owner.containerId, INSTALLER_NAME, true, owner.pid);
    await assert.rejects(runControlPlaneInstaller(recoverArgs(owner), dockerRecoveryRuntime(f, async (reference) =>
      [owner.containerId, INSTALLER_NAME].includes(reference) ? running : null)), /still alive|process is absent/);
    assert.equal(await existsLocal(f.paths.lockPath), true);
  }
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, crashAt: 'lock:acquired' }), SimulatedInstallCrash);
    const owner = await recoveryIdentity(f.paths); let calls = 0;
    const runtime = dockerRecoveryRuntime(f, async (reference) => {
      const round = Math.floor(calls++ / 2); const running = round > 0;
      return [owner.containerId, INSTALLER_NAME].includes(reference) ? inspectedContainer(owner.containerId, INSTALLER_NAME, running, running ? 6262 : owner.pid) : null;
    });
    await assert.rejects(runControlPlaneInstaller(recoverArgs(owner), runtime), /identity drifted|restarted/);
    assert.equal(await existsLocal(f.paths.lockPath), true);
  }
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, crashAt: 'lock:acquired' }), SimulatedInstallCrash);
    const owner = await recoveryIdentity(f.paths); let calls = 0; const replacement = 'e'.repeat(64);
    const runtime = dockerRecoveryRuntime(f, async (reference) => {
      const round = Math.floor(calls++ / 2);
      if (round === 0) return [owner.containerId, INSTALLER_NAME].includes(reference) ? inspectedContainer(owner.containerId, INSTALLER_NAME, false, owner.pid) : null;
      return reference === owner.containerId ? null : inspectedContainer(replacement, INSTALLER_NAME, true, 7373);
    });
    await assert.rejects(runControlPlaneInstaller(recoverArgs(owner), runtime), /identity drifted/);
    assert.equal(await existsLocal(f.paths.lockPath), true);
  }
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, crashAt: 'lock:acquired' }), SimulatedInstallCrash);
    const owner = await recoveryIdentity(f.paths);
    await assert.rejects(runControlPlaneInstaller(recoverArgs(owner), dockerRecoveryRuntime(f, async () => { throw new Error('Docker daemon unavailable'); })), /Docker daemon unavailable/);
    assert.equal(await existsLocal(f.paths.lockPath), true);
  }
});

test('recover freezes when the exact lock artifact changes after forensic receipt publication', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, crashAt: 'lock:acquired' }), SimulatedInstallCrash);
  const owner = await recoveryIdentity(f.paths); const stopped = inspectedContainer(owner.containerId, INSTALLER_NAME, false, owner.pid); let changed = false;
  const runtime = dockerRecoveryRuntime(f, async (reference) => [owner.containerId, INSTALLER_NAME].includes(reference) ? stopped : null);
  runtime.checkpoint = async (point) => {
    if (point === 'receipt:linked' && !changed) { changed = true; await writeFile(join(f.paths.lockPath, 'replacement-evidence'), 'changed'); }
  };
  await assert.rejects(runControlPlaneInstaller(recoverArgs(owner), runtime), /unknown entry|changed before removal/);
  assert.equal(await existsLocal(f.paths.lockPath), true);
});

test('journal lock rebuilt by recover records the independent recovery container identity', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, crashAt: 'journal:PREPARED' }), SimulatedInstallCrash);
  const journal = JSON.parse(await readFile(f.paths.journalPath, 'utf8')); await rm(f.paths.lockPath, { recursive: true, force: true });
  const recoveryRuntime = { ...f.runtime, processIdentity: { ...f.runtime.processIdentity, containerId: 'd'.repeat(64), containerName: RECOVERY_NAME }, crashAt: 'lock:published' };
  await assert.rejects(runControlPlaneInstaller(recoverArgs(journal), recoveryRuntime), SimulatedInstallCrash);
  const owner = JSON.parse(await readFile(join(f.paths.lockPath, 'owner.json'), 'utf8'));
  assert.equal(owner.schema, 'booking.preprod-control-plane-install-lock/v2'); assert.equal(owner.containerName, RECOVERY_NAME); assert.equal(owner.containerId, 'd'.repeat(64));
});

test('a new fixed-name recovery container resumes a journal left by a removed recovery container', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, crashAt: 'journal:PREPARED' }), SimulatedInstallCrash);
  const journal = JSON.parse(await readFile(f.paths.journalPath, 'utf8')); await rm(f.paths.lockPath, { recursive: true, force: true });
  const firstId = 'd'.repeat(64); const secondId = 'e'.repeat(64);
  await assert.rejects(runControlPlaneInstaller(recoverArgs(journal), {
    ...f.runtime,
    processIdentity: { pid: 5252, bootId: '22222222-2222-4222-8222-222222222222', processStartTicks: '200', containerId: firstId, containerName: RECOVERY_NAME },
    crashAt: 'lock:published',
  }), SimulatedInstallCrash);
  const second = inspectedContainer(secondId, RECOVERY_NAME, true, 6262);
  const runtime = {
    ...f.runtime,
    processIdentity: { pid: 6262, bootId: '33333333-3333-4333-8333-333333333333', processStartTicks: '300', containerId: secondId, containerName: RECOVERY_NAME },
    inspectContainer: async (reference) => [secondId, RECOVERY_NAME].includes(reference) ? second : null,
  };
  delete runtime.isProcessAlive; delete runtime.assertNormalInstallerAbsent;
  const recovered = await runControlPlaneInstaller(recoverArgs(journal), runtime);
  assert.equal(recovered.status, 'rolled-back');
  assert.equal(await existsLocal(f.paths.lockPath), false);
  assert.equal(await existsLocal(f.paths.journalPath), false);
  assert.equal((await inspectControlPlaneInventory(f.paths.installRoot, { uid: null, enforceMode: false })).digest, f.active.digest);
});

test('journal recovery rebuilds an absent lock atomically across every lock publication crash point', async (t) => {
  for (const point of ['lock:temp-created', 'lock:owner-written', 'lock:owner-prepared', 'lock:owner-linked', 'lock:published']) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, crashAt: 'journal:PREPARED' }), SimulatedInstallCrash);
    const journal = JSON.parse(await readFile(f.paths.journalPath, 'utf8'));
    await rm(f.paths.lockPath, { recursive: true, force: true });
    await assert.rejects(runControlPlaneInstaller(recoverArgs(journal), { ...f.runtime, checkpointCounts: new Map(), crashAt: point }), SimulatedInstallCrash, point);
    const recovered = await runControlPlaneInstaller(recoverArgs(journal), f.runtime);
    assert.equal(recovered.status, 'rolled-back', point);
    assert.equal(await existsLocal(f.paths.lockPath), false, point);
    assert.equal(await existsLocal(f.paths.journalPath), false, point);
    assert.equal((await inspectControlPlaneInventory(f.paths.installRoot, { uid: null, enforceMode: false })).digest, f.active.digest, point);
  }
});

test('empty and half-written fixed locks require exact forensic recovery and become immutable evidence', async (t) => {
  for (const ownerText of [null, '{"schema":"truncated"']) {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await mkdir(f.paths.lockPath, { mode: 0o700 });
    if (ownerText !== null) await writeFile(join(f.paths.lockPath, 'owner.json'), ownerText);
    const transactionId = ownerText === null ? '10000000-0000-4000-8000-000000000001' : '10000000-0000-4000-8000-000000000002';
    const identity = { transactionId, installId: ID, gitSha: GIT, approvalId: APPROVAL };
    const recovered = await runControlPlaneInstaller(recoverArgs(identity), f.runtime);
    assert.equal(recovered.status, 'cleared-incomplete-lock'); assert.equal(recovered.receipt.identityUnknown, true); assert.equal(recovered.receipt.lockOwnerDigest, null); assert.equal(await existsLocal(f.paths.lockPath), false);
    assert.equal(JSON.parse(await readFile(join(f.paths.receiptRoot, `control-plane-lock-recovery-${transactionId}.json`), 'utf8')).artifactDigest, recovered.receipt.artifactDigest);
  }
});

test('install requires an independently signed approval receipt bound to the exact builder tuple', async (t) => {
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); await rm(join(f.paths.approvalRoot, ID), { recursive: true, force: true });
    await assert.rejects(runControlPlaneInstaller(f.installArgs, f.runtime)); assert.equal(await existsLocal(f.paths.journalPath), false);
  }
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const args = [...f.installArgs]; args.splice(args.indexOf('--approval-tuple-digest'), 2);
    await assert.rejects(runControlPlaneInstaller(args, f.runtime), /approval tuple must be SHA-256/); assert.equal(await existsLocal(f.paths.journalPath), false);
  }
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const args = [...f.installArgs]; args[args.indexOf('--approval-tuple-digest') + 1] = digest('wrong');
    await assert.rejects(runControlPlaneInstaller(args, f.runtime), /approval tuple is not bound/);
  }
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, verifyApprovalSignature: async () => { throw new Error('wrong independent signature'); } }), /wrong independent signature/);
  }
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const path = join(f.paths.approvalRoot, ID, 'approver-receipt.json');
    const forged = { ...f.approverReceipt, tupleDigest: digest('foreign-tuple') }; delete forged.receiptDigest; forged.receiptDigest = digest(canonical(forged)); await writeFile(path, `${canonical(forged)}\n`);
    const args = [...f.installArgs]; args[args.indexOf('--approver-receipt-digest') + 1] = forged.receiptDigest;
    await assert.rejects(runControlPlaneInstaller(args, f.runtime), /approver receipt is not bound/);
  }
});

test('rollback target must have an immutable historical install receipt for the exact rollback tree', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); await runControlPlaneInstaller(f.installArgs, f.runtime);
  const targetPath = join(f.paths.receiptRoot, `control-plane-install-${ID}.json`); const forged = JSON.parse(await readFile(targetPath, 'utf8')); forged.oldActiveInventoryDigest = digest('another-tree'); forged.rollbackInventoryDigest = forged.oldActiveInventoryDigest; delete forged.receiptDigest; forged.receiptDigest = digest(canonical(forged));
  await chmod(targetPath, 0o600); await writeFile(targetPath, `${canonical(forged)}\n`); await chmod(targetPath, 0o400);
  const args = ['--action', 'rollback', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL, '--rollback-id', ID,
    '--expected-active-inventory-digest', f.inv.digest, '--expected-rollback-inventory-digest', f.active.digest];
  await assert.rejects(runControlPlaneInstaller(args, f.runtime), /historical install receipt|published install receipt/);
  assert.equal((await inspectControlPlaneInventory(f.paths.installRoot, { uid: null, enforceMode: false })).digest, f.inv.digest);
});

test('no-op candidate digest and a forged no-op journal never move or delete active', async (t) => {
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await chmod(f.source, 0o755); await rm(f.source, { recursive: true }); await mkdir(f.source, { recursive: true }); await payload(f.source, 'old');
    const inv = await inspectControlPlaneInventory(f.source, { uid: null, source: true, enforceMode: false }); const trackedFiles = inv.entries.filter((entry) => entry.type === 'file').map((entry) => entry.path).sort();
    const archivePath = join(f.paths.bundleRoot, ID, 'source-archive.tar'); const archiveBytes = await sourceArchive(f.source, inv, GIT); await chmod(archivePath, 0o600); await writeFile(archivePath, archiveBytes); await chmod(archivePath, 0o444);
    f.declaration.sourceArchiveDigest = digest(archiveBytes); f.declaration.inventoryDigest = inv.digest; f.declaration.trackedFiles = trackedFiles; f.declaration.trackedAllowlistDigest = digest(canonical(trackedFiles));
    const declarationPath = join(f.paths.bundleRoot, ID, 'bundle-declaration.json'); await chmod(declarationPath, 0o600); await writeFile(declarationPath, `${canonical(f.declaration)}\n`); await chmod(declarationPath, 0o444);
    const args = [...f.installArgs]; args[args.indexOf('--source-archive-digest') + 1] = f.declaration.sourceArchiveDigest; args[args.indexOf('--expected-inventory-digest') + 1] = inv.digest; args[args.indexOf('--tracked-allowlist-digest') + 1] = f.declaration.trackedAllowlistDigest; args[args.indexOf('--bundle-declaration-digest') + 1] = digest(canonical(f.declaration));
    await assert.rejects(runControlPlaneInstaller(args, f.runtime), /equals the active tree/);
    assert.equal((await inspectControlPlaneInventory(f.paths.installRoot, { uid: null, enforceMode: false })).digest, f.active.digest); assert.equal(await existsLocal(f.paths.journalPath), false);
  }
  {
    const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(runControlPlaneInstaller(f.installArgs, { ...f.runtime, crashAt: 'journal:PREPARED' }), SimulatedInstallCrash);
    const journal = JSON.parse(await readFile(f.paths.journalPath, 'utf8')); journal.newDigest = journal.oldActiveDigest;
    await chmod(f.paths.journalPath, 0o600); await writeFile(f.paths.journalPath, `${canonical(journal)}\n`); await chmod(f.paths.journalPath, 0o400);
    await assert.rejects(runControlPlaneInstaller(recoverArgs(journal), f.runtime), /forbidden no-op/);
    assert.equal((await inspectControlPlaneInventory(f.paths.installRoot, { uid: null, enforceMode: false })).digest, f.active.digest);
  }
});

test('symlink, undeclared file, Git mismatch, path/production option and missing executable fail before switch', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const wrongGit = [...f.installArgs]; wrongGit[wrongGit.indexOf('--git-sha') + 1] = '0'.repeat(40);
  await assert.rejects(runControlPlaneInstaller(wrongGit, f.runtime), /Git SHA|identity/);
  await assert.rejects(runControlPlaneInstaller([...f.installArgs, '--project', 'booking-prod'], f.runtime), /unsupported option/);
  const target = join(f.source, 'switch-preprod-ingress.mjs'); await rm(target); await symlink(join(f.source, 'control-plane', 'ops', 'release', 'execute-fenced-action.mjs'), target);
  await assert.rejects(runControlPlaneInstaller(f.installArgs, f.runtime), /symbolic link/);
});

async function existsLocal(path) { try { await readFile(path); return true; } catch { try { await readdir(path); return true; } catch { return false; } } }

test('production source keeps fixed roots, root:root enforcement, fsync, hard-link receipt publication and no environment path override', async () => {
  const source = await readFile(join(repo, 'ops', 'release', 'install-booking-preprod-control-plane.mjs'), 'utf8');
  for (const fixed of ['/usr/local/libexec/happybooking', '/usr/local/libexec/happybooking.rollback', '/usr/local/libexec/.happybooking-legacy-active-migration.lock',
    '/usr/local/libexec/.happybooking-legacy-active-migration.journal.json', '/volume1/happybooking/booking-preprod/.g4/receipts',
    '/var/lib/happybooking/deploy-state/preprod/booking-preprod/deploy-state.json']) assert.ok(source.includes(fixed));
  assert.match(source, /!key\.toUpperCase\(\)\.startsWith\('COSIGN_'\)/); assert.match(source, /info\.uid !== uid \|\| info\.gid !== 0/); assert.match(source, /await handle\.sync\(\)/); assert.match(source, /await link\(temp, path\)/);
});

const shell = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\sh.exe' : '/bin/sh';
const shellPath = (path) => process.platform === 'win32' ? path.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`).replaceAll('\\', '/') : path;
async function bootstrapFixture() {
  const root = await mkdtemp(join(tmpdir(), 'booking-bootstrap-')); const launcher = join(root, 'usr', 'local', 'libexec', 'run-booking-preprod-control-plane-installer');
  const active = join(root, 'usr', 'local', 'libexec', 'happybooking'); const hostIdentity = join(root, 'etc', 'machine-id');
  const bundle = join(root, 'volume1', 'happybooking', 'booking-preprod', '.g4', 'control-plane-install', 'bundles', ID); const approval = join(root, 'volume1', 'happybooking', 'booking-preprod', '.g4', 'control-plane-install', 'approvals', ID);
  const trust = join(root, 'etc', 'happybooking', 'trust'); const cosign = join(root, 'usr', 'local', 'bin', 'cosign');
  const receiptRoot = join(root, 'volume1', 'happybooking', 'booking-preprod', '.g4', 'receipts');
  const stateProject = join(root, 'var', 'lib', 'happybooking', 'deploy-state', 'preprod', 'booking-preprod');
  for (const path of [dirname(launcher), bundle, approval, receiptRoot, stateProject, trust, dirname(cosign), dirname(hostIdentity)]) await mkdir(path, { recursive: true });
  await payload(active, 'bootstrap-old'); await writeFile(hostIdentity, '0123456789abcdef0123456789abcdef\n');
  const launcherBytes = await readFile(join(repo, 'ops', 'release', 'run-booking-preprod-control-plane-installer')); await writeFile(launcher, launcherBytes); await chmod(launcher, 0o755);
  await writeFile(join(bundle, 'installer.mjs'), '#!/usr/bin/env node\n'); await chmod(join(bundle, 'installer.mjs'), 0o755);
  const migrator = join(bundle, 'payload', 'control-plane', 'ops', 'release', 'migrate-booking-preprod-legacy-active-root.mjs'); await mkdir(dirname(migrator), { recursive: true }); await writeFile(migrator, '#!/usr/bin/env node\n'); await chmod(migrator, 0o444);
  await writeFile(cosign, '#!/bin/sh\n[ "$1" = verify-blob ] && [ "$(cat "$5")" = valid ]\n'); await chmod(cosign, 0o755);
  const key = join(trust, 'control-plane-approver.pub'); const anchor = `${key}.sha256`; await writeFile(key, 'approver-public-key\n'); const keyDigest = digest(await readFile(key)); await writeFile(anchor, `${keyDigest}\n`);
  const tupleBody = { schema: 'booking.preprod-control-plane-approval-tuple/v1', status: 'awaiting-independent-approval', installId: ID, gitSha: GIT, approvalId: APPROVAL,
    bootstrapInstallerLauncherDigest: digest(launcherBytes), installerDigest: digest(await readFile(join(bundle, 'installer.mjs'))) };
  const tuple = { ...tupleBody, tupleDigest: digest(canonical(tupleBody)) };
  const activeInventory = await inspectControlPlaneInventory(active, { uid: null, enforceMode: false });
  const receiptBody = { schema: 'booking.preprod.control-plane-approval-receipt/v2', status: 'approved', environment: 'preprod', project: 'booking-preprod', installId: ID,
    gitSha: GIT, approvalId: APPROVAL, tupleDigest: tuple.tupleDigest, approverIdentity: 'release.approver.test', publicKeyDigest: keyDigest,
    hostIdentityDigest: digest(await readFile(hostIdentity)), expectedActiveInventoryDigest: activeInventory.digest,
    activeInventoryObservedAt: '2026-09-13T01:02:02.000Z', approvedAt: '2026-09-13T01:02:03.000Z' };
  const receipt = { ...receiptBody, receiptDigest: digest(canonical(receiptBody)) }; await writeFile(join(approval, 'approval-tuple.json'), `${canonical(tuple)}\n`); await writeFile(join(approval, 'approver-receipt.json'), `${canonical(receipt)}\n`); await writeFile(join(approval, 'approver-receipt.sig'), 'valid\n');
  const env = { ...process.env, BOOKING_CONTROL_PLANE_DRY_RUN: 'true', BOOKING_CONTROL_PLANE_BOOTSTRAP_TEST_ROOT: shellPath(root) };
  const args = ['--action', 'inventory', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL];
  return { root, launcher, active, hostIdentity, bundle, approval, receiptRoot, stateProject, trust, cosign, migrator, env, args, tuple, receipt, keyDigest, activeInventory };
}

async function publishBootstrapApproval(f, tupleValue, receiptValue) {
  await writeFile(join(f.approval, 'approval-tuple.json'), `${canonical(tupleValue)}\n`);
  await writeFile(join(f.approval, 'approver-receipt.json'), `${canonical(receiptValue)}\n`);
  await writeFile(join(f.approval, 'approver-receipt.sig'), 'valid\n');
  f.tuple = tupleValue;
  f.receipt = receiptValue;
}

async function executableBootstrapFixture() {
  const f = await bootstrapFixture();
  const docker = join(f.root, 'test-only-host-docker');
  const log = join(f.root, 'test-only-host-docker.log');
  const socket = join(f.root, 'var', 'run', 'docker.sock');
  await mkdir(dirname(socket), { recursive: true });
  await writeFile(socket, 'test-only socket sentinel\n');
  const pollution = [
    'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'DOCKER_API_VERSION',
    'DOCKER_AUTH_CONFIG', 'DOCKER_CUSTOM_HEADERS', 'DOCKER_CONTENT_TRUST',
    'DOCKER_CONTENT_TRUST_SERVER', 'DOCKER_DEFAULT_PLATFORM', 'LD_PRELOAD', 'LD_LIBRARY_PATH',
  ];
  const mock = `#!/bin/sh
{
  printf '%s\\n' CALL
  printf 'DOCKER_HOST=%s\\n' "\${DOCKER_HOST-<unset>}"
  printf 'DOCKER_CONFIG=%s\\n' "\${DOCKER_CONFIG-<unset>}"
${pollution.map((name) => `  if [ "\${${name}+set}" = set ]; then printf '${name}=<set>:%s\\n' "\${${name}}"; else printf '%s\\n' '${name}=<unset>'; fi`).join('\n')}
  for value do printf 'ARG=%s\\n' "$value"; done
  printf '%s\\n' END
} >> '${shellPath(log)}'
exit 0
`;
  await writeFile(docker, mock); await chmod(docker, 0o755);
  const original = await readFile(f.launcher, 'utf8');
  const source = original
    .replace("HOST_DOCKER='/var/packages/ContainerManager/target/usr/bin/docker'", `HOST_DOCKER='${shellPath(docker)}'`)
    .replace("[ \"\${BOOKING_CONTROL_PLANE_DRY_RUN:-}\" = 'true' ] || fail", "[ \"\${BOOKING_CONTROL_PLANE_BOOTSTRAP_TEST_EXECUTE:-}\" = 'true' ] || fail")
    .replaceAll("[ \"$(id -u)\" = '0' ]", '[ "$(id -u)" = "$EXPECTED_UID" ]')
    .replaceAll('[ -S /var/run/docker.sock ]', `[ -f '${shellPath(socket)}' ]`);
  assert.notEqual(source, original);
  assert.ok(source.includes(`HOST_DOCKER='${shellPath(docker)}'`));
  assert.equal(source.includes("[ \"$(id -u)\" = '0' ]"), false);
  assert.equal(source.includes('[ -S /var/run/docker.sock ]'), false);
  await writeFile(f.launcher, source); await chmod(f.launcher, 0o755);
  const tupleBody = { ...f.tuple, bootstrapInstallerLauncherDigest: digest(await readFile(f.launcher)) }; delete tupleBody.tupleDigest;
  const tuple = { ...tupleBody, tupleDigest: digest(canonical(tupleBody)) };
  const receiptBody = { ...f.receipt, tupleDigest: tuple.tupleDigest }; delete receiptBody.receiptDigest;
  const receipt = { ...receiptBody, receiptDigest: digest(canonical(receiptBody)) };
  await publishBootstrapApproval(f, tuple, receipt);
  f.docker = docker; f.log = log; f.socket = socket; f.pollution = pollution;
  f.hostDockerConfig = join(f.root, 'usr', 'local', 'libexec', '.happybooking-host-docker-empty');
  f.env = {
    ...process.env,
    BOOKING_CONTROL_PLANE_DRY_RUN: '',
    BOOKING_CONTROL_PLANE_BOOTSTRAP_TEST_ROOT: shellPath(f.root),
    BOOKING_CONTROL_PLANE_BOOTSTRAP_TEST_EXECUTE: 'true',
    DOCKER_HOST: 'tcp://attacker.invalid:2376',
    DOCKER_CONTEXT: 'attacker-context',
    DOCKER_TLS: '1',
    DOCKER_CONFIG: shellPath(join(f.root, 'attacker-docker-config')),
    DOCKER_TLS_VERIFY: '1',
    DOCKER_CERT_PATH: shellPath(join(f.root, 'attacker-certs')),
    DOCKER_API_VERSION: '1.24',
    DOCKER_AUTH_CONFIG: '{"auths":{"attacker.invalid":{}}}',
    DOCKER_CUSTOM_HEADERS: 'X-Attacker=present',
    DOCKER_CONTENT_TRUST: '1',
    DOCKER_CONTENT_TRUST_SERVER: 'https://attacker.invalid',
    DOCKER_DEFAULT_PLATFORM: 'linux/amd64',
    LD_PRELOAD: '',
    LD_LIBRARY_PATH: shellPath(join(f.root, 'attacker-libraries')),
  };
  return f;
}

async function dockerCalls(f) {
  const source = await readFile(f.log, 'utf8');
  return source.trim().split(/\r?\nCALL\r?\n/).map((record) => record.replace(/^CALL\r?\n/, '').split(/\r?\n/));
}

function assertFixedHostDockerCall(f, call) {
  assert.ok(call.includes('DOCKER_HOST=unix:///var/run/docker.sock'), call.join('\n'));
  assert.ok(call.includes(`DOCKER_CONFIG=${shellPath(f.hostDockerConfig)}`), call.join('\n'));
  for (const name of f.pollution) assert.ok(call.includes(`${name}=<unset>`), `${name}:\n${call.join('\n')}`);
  const args = call.filter((line) => line.startsWith('ARG=')).map((line) => line.slice(4));
  assert.deepEqual(args.slice(0, 4), ['--host', 'unix:///var/run/docker.sock', '--config', shellPath(f.hostDockerConfig)]);
  assert.equal(args[4], 'run');
}

function assertIsolatedContainerDockerClient(argv) {
  assert.ok(argv.includes('/root/.docker:ro,nosuid,nodev,noexec,size=64k'));
  for (const value of [
    'DOCKER_HOST=unix:///var/run/docker.sock', 'DOCKER_CONFIG=/root/.docker',
    'DOCKER_CONTEXT=', 'DOCKER_TLS=', 'DOCKER_TLS_VERIFY=', 'DOCKER_CERT_PATH=', 'DOCKER_API_VERSION=',
    'DOCKER_AUTH_CONFIG=', 'DOCKER_CUSTOM_HEADERS=', 'DOCKER_CONTENT_TRUST=',
    'DOCKER_CONTENT_TRUST_SERVER=', 'DOCKER_DEFAULT_PLATFORM=', 'LD_PRELOAD=', 'LD_LIBRARY_PATH=',
  ]) assert.ok(argv.includes(value), value);
}

const hasDockerSocketMount = (values) => values.some((value) => value === '/var/run/docker.sock'
  || value.includes('src=/var/run/docker.sock') || value.includes('dst=/var/run/docker.sock'));

test('executable bootstrap copy pins every host Docker call and clears hostile client and loader environment', async (t) => {
  const sampleDigest = digest('bootstrap-host-docker-boundary');
  const transactionId = '10000000-0000-4000-8000-000000000071';
  const scenarios = [
    ['inventory', 1, ['--action', 'inventory', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL]],
    ['active-inventory', 1, ['--action', 'active-inventory', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL]],
    ['legacy-inventory', 2, ['--action', 'legacy-inventory', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL,
      '--migration-id', 'booking-legacy-active-20260913T010203Z-536b435723ae']],
    ['install', 1, ['--action', 'install', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL,
      '--source-archive-digest', sampleDigest, '--installer-digest', sampleDigest, '--bundle-declaration-digest', sampleDigest,
      '--tracked-allowlist-digest', sampleDigest, '--expected-inventory-digest', sampleDigest,
      '--approval-tuple-digest', sampleDigest, '--approver-receipt-digest', sampleDigest]],
    ['recover', 1, ['--action', 'recover', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL, '--transaction-id', transactionId]],
  ];
  for (const [name, expectedCalls, args] of scenarios) {
    const f = await executableBootstrapFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    const result = spawnSync(shell, [shellPath(f.launcher), ...args], { encoding: 'utf8', env: f.env });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    const calls = await dockerCalls(f);
    assert.equal(calls.length, expectedCalls, name);
    for (const call of calls) assertFixedHostDockerCall(f, call);
  }
});

test('signed legacy executable bootstrap pins hostile environment independently on all three Docker stages', async (t) => {
  const f = await executableBootstrapFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const migrationId = 'booking-legacy-active-20260913T010203Z-536b435723ae';
  const transactionId = '10000000-0000-4000-8000-000000000072';
  const body = { ...f.receipt, schema: 'booking.preprod.control-plane-approval-receipt/v3', migrationContext: { migrationId, allowedActions: ['migrate', 'recover'], transactionId,
    predecessorReceiptDigest: null, expectedNormalizedInventoryDigest: null } }; delete body.receiptDigest;
  const receipt = { ...body, receiptDigest: digest(canonical(body)) };
  await publishBootstrapApproval(f, f.tuple, receipt);
  const result = spawnSync(shell, [shellPath(f.launcher), '--action', 'legacy-migrate', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL,
    '--migration-id', migrationId, '--transaction-id', transactionId, '--expected-raw-inventory-digest', f.activeInventory.digest, '--execute', 'true'],
  { encoding: 'utf8', env: f.env });
  assert.equal(result.status, 0, result.stderr);
  const calls = await dockerCalls(f);
  assert.equal(calls.length, 3);
  for (const call of calls) assertFixedHostDockerCall(f, call);
  const names = calls.map((call) => {
    const args = call.filter((line) => line.startsWith('ARG=')).map((line) => line.slice(4));
    return args[args.indexOf('--name') + 1];
  });
  assert.deepEqual(names, ['booking-preprod-legacy-bundle-preflight', 'booking-preprod-legacy-approval-preflight', 'booking-preprod-legacy-active-migration']);
});

test('terminal host Docker launch replaces the bootstrap process instead of leaving an orphaned Docker child', { skip: process.platform === 'win32' }, async (t) => {
  const f = await executableBootstrapFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  await writeFile(f.docker, `#!/bin/sh
printf '%s\\n' START >> '${shellPath(f.log)}'
sleep 1
printf '%s\\n' SURVIVED >> '${shellPath(f.log)}'
`);
  await chmod(f.docker, 0o755);
  const child = spawn(shell, [shellPath(f.launcher), '--action', 'active-inventory', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL],
    { env: f.env, stdio: 'ignore' });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const log = await readFile(f.log, 'utf8').catch(() => '');
    if (log.includes('START')) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  assert.match(await readFile(f.log, 'utf8'), /START/);
  assert.equal(child.kill('SIGTERM'), true);
  await new Promise((resolvePromise) => child.once('exit', resolvePromise));
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1400));
  assert.doesNotMatch(await readFile(f.log, 'utf8'), /SURVIVED/);
});

test('host bootstrap refuses file, directory and symlink pollution at its fixed empty Docker config before first invocation', async (t) => {
  const scenarios = process.platform === 'win32' ? ['file', 'directory'] : ['file', 'directory', 'symlink'];
  for (const scenario of scenarios) {
    const f = await executableBootstrapFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    if (scenario === 'file') await writeFile(f.hostDockerConfig, 'attacker config\n');
    if (scenario === 'directory') await mkdir(f.hostDockerConfig);
    if (scenario === 'symlink') await symlink(f.docker, f.hostDockerConfig);
    const result = spawnSync(shell, [shellPath(f.launcher), ...f.args], { encoding: 'utf8', env: f.env });
    assert.notEqual(result.status, 0, scenario);
    assert.equal(await existsLocal(f.log), false, scenario);
  }
});

test('host bootstrap refuses legacy migration lock and journal before launching a mutating installer', async (t) => {
  const sampleDigest = digest('bootstrap-migration-exclusion');
  const args = ['--action', 'install', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL,
    '--source-archive-digest', sampleDigest, '--installer-digest', sampleDigest, '--bundle-declaration-digest', sampleDigest,
    '--tracked-allowlist-digest', sampleDigest, '--expected-inventory-digest', sampleDigest,
    '--approval-tuple-digest', sampleDigest, '--approver-receipt-digest', sampleDigest];
  for (const name of ['.happybooking-legacy-active-migration.lock', '.happybooking-legacy-active-migration.journal.json']) {
    const f = await executableBootstrapFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await writeFile(join(f.root, 'usr', 'local', 'libexec', name), 'conflict\n');
    const result = spawnSync(shell, [shellPath(f.launcher), ...args], { encoding: 'utf8', env: f.env });
    assert.notEqual(result.status, 0, name);
    assert.equal(await existsLocal(f.log), false, name);
  }
});

test('legacy migrate, recover and rollback bootstraps fail before Docker when installer lock or journal exists', async (t) => {
  for (const name of ['.happybooking-control-plane-install.lock', '.happybooking-control-plane-install.journal.json']) {
    const f = await bootstrapFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    await writeFile(join(f.root, 'usr', 'local', 'libexec', name), 'installer conflict\n');
    for (const action of ['legacy-migrate', 'legacy-recover', 'legacy-rollback']) {
      const result = spawnSync(shell, [shellPath(f.launcher), '--action', action, '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL], { encoding: 'utf8', env: f.env });
      assert.notEqual(result.status, 0, `${name}:${action}`);
      assert.equal(result.stdout.trim(), '', `${name}:${action}`);
    }
  }
});

test('host fail-fast rejects dangling lock and journal symlinks in both installer-to-migrator directions', async (t) => {
  const sampleDigest = digest('bootstrap-dangling-lock-exclusion');
  const installArgs = ['--action', 'install', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL,
    '--source-archive-digest', sampleDigest, '--installer-digest', sampleDigest, '--bundle-declaration-digest', sampleDigest,
    '--tracked-allowlist-digest', sampleDigest, '--expected-inventory-digest', sampleDigest,
    '--approval-tuple-digest', sampleDigest, '--approver-receipt-digest', sampleDigest];
  {
    const f = await executableBootstrapFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    for (const name of ['.happybooking-legacy-active-migration.lock', '.happybooking-legacy-active-migration.journal.json']) {
      const conflict = join(f.root, 'usr', 'local', 'libexec', name);
      await symlink(join(f.root, `missing-${name}`), conflict);
      const result = spawnSync(shell, [shellPath(f.launcher), ...installArgs], { encoding: 'utf8', env: f.env });
      assert.notEqual(result.status, 0, name); assert.equal(await existsLocal(f.log), false, name);
      await rm(conflict);
    }
  }
  {
    const f = await bootstrapFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    for (const name of ['.happybooking-control-plane-install.lock', '.happybooking-control-plane-install.journal.json']) {
      const conflict = join(f.root, 'usr', 'local', 'libexec', name);
      await symlink(join(f.root, `missing-${name}`), conflict);
      const result = spawnSync(shell, [shellPath(f.launcher), '--action', 'legacy-migrate', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL], { encoding: 'utf8', env: f.env });
      assert.notEqual(result.status, 0, name); assert.equal(result.stdout.trim(), '', name);
      await rm(conflict);
    }
  }
});

test('NAS no-Node launcher verifies its signed host bootstrap before emitting the isolated Docker plan', async (t) => {
  const f = await bootstrapFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const launcher = shellPath(f.launcher);
  const args = ['--action', 'inventory', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL];
  const result = spawnSync(shell, [launcher, ...args], { encoding: 'utf8', env: f.env }); assert.equal(result.status, 0, result.stderr);
  const argv = result.stdout.trim().split(/\r?\n/);
  for (const value of ['--network', 'none', '--pid', 'host', '--read-only', '--cap-drop', 'ALL', '--cap-add', 'DAC_OVERRIDE', '--security-opt', 'no-new-privileges:true',
    '/usr/local/libexec', '/volume1/happybooking/booking-preprod/.g4/control-plane-install', '/volume1/happybooking/booking-preprod/.g4/receipts',
    '/usr/local/bin/cosign', '/etc/happybooking/trust/control-plane-approver.pub', '/etc/happybooking/trust/control-plane-approver.pub.sha256']) assert.ok(argv.some((item) => item.includes(value)), value);
  assertIsolatedContainerDockerClient(argv);
  assert.ok(argv.some((value) => value.endsWith(`/volume1/happybooking/booking-preprod/.g4/control-plane-install/bundles/${ID}/installer.mjs`)));
  const rejected = spawnSync(shell, [launcher, '--action', 'inventory', '--install-id', '../../prod', '--git-sha', GIT, '--approval-id', APPROVAL], { encoding: 'utf8', env: f.env }); assert.notEqual(rejected.status, 0);
});

test('host recover bootstrap uses a separate fixed container name from a stopped normal installer owner', async (t) => {
  const f = await bootstrapFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const transactionId = '10000000-0000-4000-8000-000000000003';
  const result = spawnSync(shell, [shellPath(f.launcher), '--action', 'recover', '--install-id', ID, '--git-sha', GIT,
    '--approval-id', APPROVAL, '--transaction-id', transactionId], { encoding: 'utf8', env: f.env });
  assert.equal(result.status, 0, result.stderr); const argv = result.stdout.trim().split(/\r?\n/);
  assert.equal(argv[argv.indexOf('--name') + 1], RECOVERY_NAME);
  assert.equal(argv.includes(INSTALLER_NAME), false);
});

test('pre-approval active inventory bootstrap has a read-only Docker boundary and no control sockets', async (t) => {
  const f = await bootstrapFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  await rm(join(f.approval, 'approver-receipt.json')); await rm(join(f.approval, 'approver-receipt.sig'));
  const result = spawnSync(shell, [shellPath(f.launcher), '--action', 'active-inventory', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL], { encoding: 'utf8', env: f.env });
  assert.equal(result.status, 0, result.stderr); const argv = result.stdout.trim().split(/\r?\n/);
  assert.ok(argv.includes('booking-preprod-control-plane-active-inventory'));
  assert.ok(argv.includes('--network') && argv.includes('none') && argv.includes('--read-only'));
  assert.ok(argv.some((value) => value.includes('src=') && value.includes('/usr/local/libexec/happybooking') && value.endsWith(',readonly')));
  assert.ok(argv.some((value) => value.includes('/etc/machine-id') && value.endsWith(',readonly')));
  assert.equal(hasDockerSocketMount(argv), false);
  assert.equal(argv.some((value) => value.includes('/var/lib/happybooking')), false);
  assert.equal(argv.includes('--pid'), false);
});

test('legacy mutation is rejected before signed v3 context and then emits only the exact approved transaction', async (t) => {
  const f = await bootstrapFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const migrationId = 'booking-legacy-active-20260913T010203Z-536b435723ae';
  const transactionId = '10000000-0000-4000-8000-000000000013';
  const digestValue = f.activeInventory.digest;
  await rm(join(f.approval, 'approver-receipt.json')); await rm(join(f.approval, 'approver-receipt.sig'));
  const unsigned = spawnSync(shell, [shellPath(f.launcher), '--action', 'legacy-migrate', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL,
    '--migration-id', migrationId, '--transaction-id', transactionId, '--expected-raw-inventory-digest', digestValue, '--execute', 'true'], { encoding: 'utf8', env: f.env });
  assert.notEqual(unsigned.status, 0); assert.equal(unsigned.stdout.includes('LEGACY_MIGRATION'), false);
  const body = { ...f.receipt, schema: 'booking.preprod.control-plane-approval-receipt/v3', migrationContext: { migrationId, allowedActions: ['migrate', 'recover'], transactionId,
    predecessorReceiptDigest: null, expectedNormalizedInventoryDigest: null } }; delete body.receiptDigest;
  const receipt = { ...body, receiptDigest: digest(canonical(body)) };
  await writeFile(join(f.approval, 'approver-receipt.json'), `${canonical(receipt)}\n`); await writeFile(join(f.approval, 'approver-receipt.sig'), 'valid\n');
  const result = spawnSync(shell, [shellPath(f.launcher), '--action', 'legacy-migrate', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL,
    '--migration-id', migrationId, '--transaction-id', transactionId, '--expected-raw-inventory-digest', digestValue, '--execute', 'true'], { encoding: 'utf8', env: f.env });
  assert.equal(result.status, 0, result.stderr); const argv = result.stdout.trim().split(/\r?\n/);
  assert.ok(argv.includes('LEGACY_BUNDLE_PREFLIGHT')); assert.ok(argv.includes('LEGACY_APPROVAL_PREFLIGHT')); assert.ok(argv.includes('LEGACY_MIGRATION'));
  assert.ok(argv.includes('booking-preprod-legacy-bundle-preflight')); assert.ok(argv.includes('booking-preprod-legacy-active-migration'));
  assert.ok(argv.some((value) => value.endsWith('/payload/control-plane/ops/release/migrate-booking-preprod-legacy-active-root.mjs')));
  assert.ok(argv.includes('--network') && argv.includes('none') && argv.includes('--pid') && argv.includes('host'));
  assertIsolatedContainerDockerClient(argv.slice(argv.lastIndexOf('LEGACY_MIGRATION')));
  const preflight = argv.slice(argv.indexOf('LEGACY_BUNDLE_PREFLIGHT'), argv.indexOf('LEGACY_MIGRATION'));
  assert.ok(preflight.includes('bundle-inventory')); assert.equal(preflight.includes('--pid'), false); assert.equal(hasDockerSocketMount(preflight), false);
  assert.equal(preflight.some((value) => value.includes('/var/lib/happybooking')), false); assert.equal(preflight.some((value) => value.startsWith('type=bind,src=') && value.includes('/usr/local/libexec') && !value.includes('/bundles/')), false);
  assert.equal(preflight.includes('type=bind,src=/,dst=/host,readonly'), false);
  assert.equal(argv.includes('type=bind,src=/,dst=/host,readonly'), false);
  assert.ok(argv.includes('--cap-add') && argv.includes('DAC_OVERRIDE')); assert.equal(argv.some((value) => value.includes('booking-prod')), false);
  for (const bad of [
    ['--action', 'legacy-migrate', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL, '--migration-id', '../../prod', '--transaction-id', transactionId, '--expected-raw-inventory-digest', digestValue, '--execute', 'true'],
    ['--action', 'legacy-migrate', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL, '--migration-id', migrationId, '--transaction-id', transactionId, '--expected-raw-inventory-digest', digestValue, '--execute', 'false'],
    ['--action', 'legacy-migrate', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL, '--migration-id', migrationId, '--transaction-id', transactionId, '--expected-raw-inventory-digest', digestValue, '--execute', 'true', '--project', 'booking-prod'],
  ]) assert.notEqual(spawnSync(shell, [shellPath(f.launcher), ...bad], { encoding: 'utf8', env: f.env }).status, 0);
});

test('legacy inventory has no PID namespace, Docker socket, state or writable host mount', async (t) => {
  const f = await bootstrapFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const result = spawnSync(shell, [shellPath(f.launcher), '--action', 'legacy-inventory', '--install-id', ID, '--git-sha', GIT, '--approval-id', APPROVAL,
    '--migration-id', 'booking-legacy-active-20260913T010203Z-536b435723ae'], { encoding: 'utf8', env: f.env });
  assert.equal(result.status, 0, result.stderr); const argv = result.stdout.trim().split(/\r?\n/); const migration = argv.slice(argv.indexOf('LEGACY_MIGRATION'));
  assert.equal(migration.includes('--pid'), false); assert.equal(hasDockerSocketMount(migration), false);
  assert.equal(migration.some((value) => value.includes('/var/lib/happybooking')), false);
  for (const value of migration.filter((item) => item.startsWith('type=bind,src='))) assert.ok(value.endsWith(',readonly'), value);
});

test('host bootstrap rejects tampered IMAGE/path/tuple/signature before any Docker dry-run output', async (t) => {
  for (const scenario of ['image', 'path', 'tuple', 'signature', 'symlink']) {
    const f = await bootstrapFixture(); t.after(() => rm(f.root, { recursive: true, force: true })); let invoked = shellPath(f.launcher);
    if (scenario === 'image') { const source = (await readFile(f.launcher, 'utf8')).replace("IMAGE='node@sha256:", "IMAGE='node-tampered@sha256:"); await writeFile(f.launcher, source); await chmod(f.launcher, 0o755); }
    if (scenario === 'path') { const copy = join(f.root, 'copied-launcher'); await writeFile(copy, await readFile(f.launcher)); await chmod(copy, 0o755); invoked = shellPath(copy); }
    if (scenario === 'tuple') { const path = join(f.approval, 'approval-tuple.json'); await writeFile(path, (await readFile(path, 'utf8')).replace(/bootstrapInstallerLauncherDigest\":\"sha256:[0-9a-f]{64}/, `bootstrapInstallerLauncherDigest\":\"${digest('wrong-launcher')}`)); }
    if (scenario === 'signature') await writeFile(join(f.approval, 'approver-receipt.sig'), 'invalid\n');
    if (scenario === 'symlink') { const real = `${f.launcher}.real`; await writeFile(real, await readFile(f.launcher)); await chmod(real, 0o755); await rm(f.launcher); await symlink(real, f.launcher); }
    const result = spawnSync(shell, [invoked, ...f.args], { encoding: 'utf8', env: f.env }); assert.notEqual(result.status, 0, scenario); assert.equal(result.stdout, '', scenario);
  }
});

test('host bootstrap rejects writable launcher and every fixed trusted parent on POSIX', { skip: process.platform === 'win32' }, async (t) => {
  for (const target of ['launcher', 'parent', 'bundle-root', 'approval-root', 'evidence-root', 'trust-root', 'trust-parent']) {
    const f = await bootstrapFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    const path = target === 'launcher' ? f.launcher : target === 'parent' ? dirname(f.launcher)
      : target === 'bundle-root' ? dirname(f.bundle) : target === 'approval-root' ? dirname(f.approval)
        : target === 'evidence-root' ? resolve(dirname(f.bundle), '..', '..') : target === 'trust-parent' ? dirname(f.trust) : f.trust;
    await chmod(path, 0o777);
    const result = spawnSync(shell, [f.launcher, ...f.args], { encoding: 'utf8', env: f.env }); assert.notEqual(result.status, 0, target); assert.equal(result.stdout, '', target);
  }
});

test('host bootstrap rejects symlinked bundle, approval and trust chains on POSIX', { skip: process.platform === 'win32' }, async (t) => {
  for (const target of ['bundle-root', 'approval-root', 'evidence-root', 'trust-root', 'trust-parent']) {
    const f = await bootstrapFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    const path = target === 'bundle-root' ? dirname(f.bundle) : target === 'approval-root' ? dirname(f.approval)
      : target === 'evidence-root' ? resolve(dirname(f.bundle), '..', '..') : target === 'trust-parent' ? dirname(f.trust) : f.trust; const real = `${path}.real`;
    await rename(path, real); await symlink(real, path);
    const result = spawnSync(shell, [f.launcher, ...f.args], { encoding: 'utf8', env: f.env }); assert.notEqual(result.status, 0, target); assert.equal(result.stdout, '', target);
  }
});

test('host bootstrap source fixes all trust roots and verifies before Docker or dry-run', async () => {
  const source = await readFile(join(repo, 'ops', 'release', 'run-booking-preprod-control-plane-installer'), 'utf8');
  for (const fixed of [
    "SELF='/usr/local/libexec/run-booking-preprod-control-plane-installer'",
    "INSTALL_LOCK='/usr/local/libexec/.happybooking-control-plane-install.lock'",
    "INSTALL_JOURNAL='/usr/local/libexec/.happybooking-control-plane-install.journal.json'",
    "MIGRATION_LOCK='/usr/local/libexec/.happybooking-legacy-active-migration.lock'",
    "MIGRATION_JOURNAL='/usr/local/libexec/.happybooking-legacy-active-migration.journal.json'",
    "HOST_DOCKER_ENDPOINT='unix:///var/run/docker.sock'",
    "HOST_DOCKER_CONFIG='/usr/local/libexec/.happybooking-host-docker-empty'",
    "EVIDENCE_TRUST_ROOT='/volume1/happybooking/booking-preprod/.g4'",
    "APPROVER_TRUST_ROOT='/etc/happybooking'",
    "COSIGN='/usr/local/bin/cosign'",
    "COSIGN_TRUST_ROOT='/usr/local/bin'",
    "SHA256SUM='/usr/bin/sha256sum'",
    "STAT='/usr/bin/stat'",
    "READLINK='/usr/bin/readlink'",
    'trusted_chain "$SHA256SUM" \'/usr/bin\'',
    'trusted_chain "$STAT" \'/usr/bin\'',
    'trusted_chain "$READLINK" \'/usr/bin\'',
  ]) assert.ok(source.includes(fixed), fixed);
  assert.match(source, /trusted_chain "\$BUNDLE_ROOT" "\$EVIDENCE_TRUST_ROOT"/);
  assert.match(source, /trusted_chain "\$APPROVAL_ROOT" "\$EVIDENCE_TRUST_ROOT"/);
  assert.match(source, /trusted_chain "\$APPROVER_KEY" "\$APPROVER_TRUST_ROOT"/);
  assert.match(source, /trusted_chain "\$COSIGN" "\$COSIGN_TRUST_ROOT"/);
  assert.match(source, /unset DOCKER_CONTEXT DOCKER_TLS DOCKER_TLS_VERIFY DOCKER_CERT_PATH DOCKER_API_VERSION/);
  assert.match(source, /DOCKER_AUTH_CONFIG DOCKER_CUSTOM_HEADERS DOCKER_CONTENT_TRUST/);
  assert.match(source, /DOCKER_CONTENT_TRUST_SERVER DOCKER_DEFAULT_PLATFORM LD_PRELOAD LD_LIBRARY_PATH/);
  assert.match(source, /path_absent\(\) \{\s*\[ ! -e "\$1" \] && \[ ! -L "\$1" \] \|\| fail\s*\}/);
  for (const protectedPath of ['RUNTIME_LOCK', 'INSTALL_LOCK', 'INSTALL_JOURNAL', 'MIGRATION_LOCK', 'MIGRATION_JOURNAL', 'HOST_DOCKER_CONFIG']) {
    assert.ok(source.includes(`path_absent "$${protectedPath}"`), protectedPath);
  }
  assert.equal(source.includes('BOOKING_CONTROL_PLANE_BOOTSTRAP_TEST_EXECUTE'), false);
  const directHostDockerCalls = source.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => /^(?:exec\s+)?"\$HOST_DOCKER"\s/.test(line));
  assert.deepEqual(directHostDockerCalls, [
    '"$HOST_DOCKER" --host "$HOST_DOCKER_ENDPOINT" --config "$HOST_DOCKER_CONFIG" "$@"',
    'exec "$HOST_DOCKER" --host "$HOST_DOCKER_ENDPOINT" --config "$HOST_DOCKER_CONFIG" "$@"',
  ]);
  assert.equal((source.match(/host_docker "\$@"/g) ?? []).length, 2);
  assert.equal((source.match(/host_docker_exec "\$@"/g) ?? []).length, 4);
  assert.equal((source.match(/--tmpfs \/root\/\.docker:ro,nosuid,nodev,noexec,size=64k/g) ?? []).length, 2);
  const verify = source.indexOf('"$COSIGN" verify-blob');
  const dryRun = source.lastIndexOf('case "${BOOKING_CONTROL_PLANE_DRY_RUN');
  const docker = source.lastIndexOf('host_docker_exec "$@"');
  assert.ok(verify > 0 && dryRun > verify && docker > dryRun);
});

test('real git archive of the exact committed SHA exposes the bound PAX commit and source tree', async () => {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }); assert.equal(head.status, 0, head.stderr); const gitSha = head.stdout.trim();
  const archived = spawnSync('git', ['archive', '--format=tar', '--prefix=source/', gitSha, '--', 'package.json'], { cwd: repo, encoding: null, maxBuffer: 8 * 1024 * 1024 }); assert.equal(archived.status, 0, archived.stderr?.toString());
  const committed = spawnSync('git', ['show', `${gitSha}:package.json`], { cwd: repo, encoding: null }); assert.equal(committed.status, 0, committed.stderr?.toString());
  const inspected = inspectControlPlaneSourceArchive(archived.stdout, gitSha); const entry = inspected.entries.find((value) => value.path === 'package.json');
  assert.equal(entry.digest, digest(committed.stdout));
});
