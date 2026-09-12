#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod, copyFile, link, lstat, mkdir, open, readFile, readdir, readlink,
  realpath, rename, rm, unlink,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PARENT = '/usr/local/libexec';
const ACTIVE = `${PARENT}/happybooking`;
const RECEIPTS = '/volume1/happybooking/booking-preprod/.g4/receipts';
const LOCK = `${PARENT}/.happybooking-legacy-active-migration.lock`;
const JOURNAL = `${PARENT}/.happybooking-legacy-active-migration.journal.json`;
const RUNTIME_LOCK = `${PARENT}/.happybooking-control-plane-runtime.lock`;
const INSTALL_LOCK = `${PARENT}/.happybooking-control-plane-install.lock`;
const INSTALL_JOURNAL = `${PARENT}/.happybooking-control-plane-install.journal.json`;
const DEPLOY_STATE = '/var/lib/happybooking/deploy-state/preprod/booking-preprod/deploy-state.json';
const DOCKER = '/var/packages/ContainerManager/target/usr/bin/docker';
const CONTROL_IMAGE = 'node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5';

const REQUIRED_ACTIVE_ROOT_ENTRIES = Object.freeze([
  'control-plane',
  'run-booking-preprod-control-plane',
  'switch-preprod-ingress',
  'switch-preprod-ingress.mjs',
]);
const REVIEWED_LEGACY_ROOT_ENTRIES = Object.freeze([
  'control-plane.backup-before-59a70af',
  'control-plane.backup-before-61995f9',
  'control-plane.backup-before-8464ed5',
  'control-plane.backup-before-9462592',
  'control-plane.backup-before-c45a916',
  'control-plane.backup-before-c5d85c9',
  'control-plane.prev-before-booking-20260910T063250Z-b330dd295c6a',
  'run-booking-preprod-control-plane.prev-before-booking-20260910T063250Z-b330dd295c6a',
  'run-booking-preprod-control-plane.prev-booking-20260910T014542Z-39513f7d6914',
  'run-booking-preprod-control-plane.prev-booking-20260910T050934Z-c0fa6d98dc3b',
]);
const REVIEWED_ROOT_ENTRIES = Object.freeze([...REQUIRED_ACTIVE_ROOT_ENTRIES, ...REVIEWED_LEGACY_ROOT_ENTRIES].sort());
const EXECUTABLES = new Set([
  'run-booking-preprod-control-plane',
  'switch-preprod-ingress',
  'control-plane/ops/release/run-booking-preprod-control-plane',
  'control-plane/ops/release/switch-preprod-ingress',
]);
const MIGRATION_ID = /^booking-legacy-active-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PHASES = new Set(['PREPARED', 'STAGED', 'RAW_RETIRED', 'NORMALIZED_ACTIVE', 'NORMALIZED_RETIRED', 'RAW_RESTORED', 'RECEIPT_PUBLISHED', 'COMPLETE']);

export class SimulatedLegacyMigrationCrash extends Error {}
class MigrationError extends Error {}

const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const exists = async (path) => { try { await lstat(path); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } };
const rel = (root, path) => relative(root, path).split(sep).join('/');

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index]; const value = argv[index + 1];
    if (!option?.startsWith('--') || !value || value.startsWith('--')) throw new MigrationError('invalid option surface');
    const key = option.slice(2); if (Object.hasOwn(values, key)) throw new MigrationError(`duplicate option: ${key}`); values[key] = value;
  }
  const common = ['action', 'migration-id', 'approval-id'];
  const allowed = values.action === 'inventory' ? new Set(common)
    : values.action === 'migrate' ? new Set([...common, 'transaction-id', 'expected-raw-inventory-digest', 'execute'])
      : values.action === 'recover' ? new Set([...common, 'transaction-id', 'expected-raw-inventory-digest', 'expected-normalized-inventory-digest', 'predecessor-receipt-digest', 'execute'])
        : values.action === 'rollback' ? new Set([...common, 'transaction-id', 'expected-raw-inventory-digest', 'expected-normalized-inventory-digest', 'predecessor-receipt-digest', 'execute']) : null;
  if (!allowed) throw new MigrationError('unsupported action');
  for (const key of Object.keys(values)) if (!allowed.has(key)) throw new MigrationError(`unsupported option: ${key}`);
  if (!MIGRATION_ID.test(values['migration-id'] || '') || !IDENTIFIER.test(values['approval-id'] || '')) throw new MigrationError('migration identity is invalid');
  if (values.action !== 'inventory' && values.execute !== 'true') throw new MigrationError('mutation requires --execute true');
  for (const key of ['expected-raw-inventory-digest', 'expected-normalized-inventory-digest', 'predecessor-receipt-digest']) if (values[key] && !DIGEST.test(values[key])) throw new MigrationError(`${key} must be SHA-256`);
  if (['migrate', 'recover', 'rollback'].includes(values.action) && !UUID.test(values['transaction-id'] || '')) throw new MigrationError('transaction ID is invalid');
  if (values.action === 'recover' && !values['expected-raw-inventory-digest']) throw new MigrationError('approved raw inventory is invalid');
  return values;
}

function pathsFor(args, runtime) {
  const parent = runtime.parent || PARENT; const migrationId = args['migration-id'];
  return {
    parent, active: runtime.active || join(parent, 'happybooking'), receipts: runtime.receipts || RECEIPTS,
    lock: runtime.lock || join(parent, '.happybooking-legacy-active-migration.lock'),
    journal: runtime.journal || join(parent, '.happybooking-legacy-active-migration.journal.json'),
    runtimeLock: runtime.runtimeLock || RUNTIME_LOCK, installLock: runtime.installLock || INSTALL_LOCK,
    installJournal: runtime.installJournal || INSTALL_JOURNAL, deployState: runtime.deployState || DEPLOY_STATE,
    rawArchive: join(parent, `.happybooking-legacy-raw-${migrationId}`),
    migrationReceipt: join(runtime.receipts || RECEIPTS, `control-plane-legacy-migration-${migrationId}.json`),
    rollbackReceipt: join(runtime.receipts || RECEIPTS, `control-plane-legacy-migration-rollback-${migrationId}.json`),
  };
}

async function syncDirectory(path, runtime) {
  if (runtime.syncDirectory) return runtime.syncDirectory(path);
  const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); }
}
async function syncFile(path, runtime) {
  if (runtime.syncFile) return runtime.syncFile(path);
  const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); }
}
async function checkpoint(runtime, name) {
  runtime.checkpointCounts ||= new Map(); const count = (runtime.checkpointCounts.get(name) || 0) + 1; runtime.checkpointCounts.set(name, count);
  if (runtime.crashAt === name && (runtime.crashAtOccurrence === undefined || runtime.crashAtOccurrence === count)) throw new SimulatedLegacyMigrationCrash(`${name}#${count}`);
  if (runtime.checkpoint) await runtime.checkpoint(name);
}

async function assertDirectory(path, uid, label, enforceMode = true) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== resolve(path)) throw new MigrationError(`${label} must be a real directory`);
  if (uid !== null && (info.uid !== uid || info.gid !== 0)) throw new MigrationError(`${label} must be root:root`);
  if (enforceMode && (info.mode & 0o022 || info.mode & 0o7000)) throw new MigrationError(`${label} has writable or special mode bits`);
  return info;
}

async function assertCreatedOwner(path, settings, label) {
  if (settings.uid === null) return;
  const info = await lstat(path); if (info.uid !== settings.uid || info.gid !== 0) throw new MigrationError(`${label} was not created root:root`);
}

async function inventory(root, { uid, strict = false, enforceMode = true } = {}) {
  const rootInfo = await assertDirectory(root, uid, 'inventory root', enforceMode); const rootMode = `0${(rootInfo.mode & 0o777).toString(8)}`;
  if (strict && enforceMode && rootMode !== '0755') throw new MigrationError('inventory root mode drift');
  const entries = [];
  async function walk(directory) {
    const children = await readdir(directory, { withFileTypes: true }); children.sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)));
    for (const child of children) {
      const path = join(directory, child.name); const name = rel(root, path); const info = await lstat(path);
      if (!name || name.split('/').some((part) => part === '..')) throw new MigrationError(`unsafe inventory path: ${name}`);
      if (info.isSymbolicLink()) throw new MigrationError(`symbolic link rejected: ${name}`);
      if (uid !== null && (info.uid !== uid || info.gid !== 0)) throw new MigrationError(`non-root:root entry: ${name}`);
      if (enforceMode && (info.mode & 0o022 || info.mode & 0o7000)) throw new MigrationError(`writable or special-mode entry: ${name}`);
      const mode = `0${(info.mode & 0o777).toString(8)}`;
      if (info.isDirectory()) {
        if (strict && enforceMode && mode !== '0555') throw new MigrationError(`directory mode drift: ${name}`);
        entries.push({ path: name, type: 'directory', mode }); await walk(path);
      } else if (info.isFile()) {
        if (info.nlink !== 1) throw new MigrationError(`hard-linked file rejected: ${name}`);
        const expected = EXECUTABLES.has(name) ? '0555' : '0444';
        if (strict && enforceMode && mode !== expected) throw new MigrationError(`file mode drift: ${name}`);
        entries.push({ path: name, type: 'file', mode, size: info.size, digest: sha256(await readFile(path)) });
      } else throw new MigrationError(`non-regular entry rejected: ${name}`);
    }
  }
  await walk(root); return { rootMode, entries, digest: sha256(canonical({ rootMode, entries })) };
}

async function assertReviewedRoot(root) {
  const found = (await readdir(root)).sort();
  if (canonical(found) !== canonical(REVIEWED_ROOT_ENTRIES)) throw new MigrationError('legacy active root entries differ from the reviewed one-time allowlist');
}

async function assertNoMounts(path, runtime) {
  if (runtime.assertNoMounts) return runtime.assertNoMounts(path);
  const rows = (await readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n');
  const mounted = rows.map((row) => row.split(' ')[4]?.replace(/\\040/g, ' '));
  const real = await realpath(path); if (mounted.some((entry) => entry === real || entry?.startsWith(`${real}/`))) throw new MigrationError('active root contains a mountpoint');
}

async function assertNoOpenReferences(path, runtime) {
  if (runtime.assertNoOpenReferences) return runtime.assertNoOpenReferences(path);
  const proc = '/proc';
  for (const name of await readdir(proc)) {
    if (!/^[0-9]+$/.test(name)) continue;
    const base = join(proc, name);
    for (const leaf of ['cwd', 'root', 'exe']) {
      try { const target = await readlink(join(base, leaf)); if (target === path || target.startsWith(`${path}/`)) throw new MigrationError(`process ${name} references protected migration tree`); } catch (error) { if (error instanceof MigrationError) throw error; if (!['ENOENT', 'ESRCH'].includes(error?.code)) throw new MigrationError(`cannot inspect process ${name} ${leaf}`); }
    }
    try {
      for (const fd of await readdir(join(base, 'fd'))) {
        try { const target = await readlink(join(base, 'fd', fd)); if (target === path || target.startsWith(`${path}/`)) throw new MigrationError(`process ${name} has an open protected-tree descriptor`); } catch (error) { if (error instanceof MigrationError) throw error; if (!['ENOENT', 'ESRCH'].includes(error?.code)) throw new MigrationError(`cannot inspect process ${name} descriptor`); }
      }
    } catch (error) { if (error instanceof MigrationError) throw error; if (!['ENOENT', 'ESRCH'].includes(error?.code)) throw new MigrationError(`cannot enumerate process ${name} descriptors`); }
    for (const leaf of ['cmdline', 'maps']) {
      try { if ((await readFile(join(base, leaf))).includes(Buffer.from(path))) throw new MigrationError(`process ${name} text references protected migration tree`); } catch (error) { if (error instanceof MigrationError) throw error; if (!['ENOENT', 'ESRCH'].includes(error?.code)) throw new MigrationError(`cannot inspect process ${name} ${leaf}`); }
    }
  }
}

async function assertQuiescent(paths, runtime, now, action = null, additionalProtectedPaths = []) {
  if (runtime.assertQuiescent) return runtime.assertQuiescent();
  for (const path of [paths.runtimeLock, paths.installLock, paths.installJournal, `${paths.deployState}.lock`]) if (await exists(path)) throw new MigrationError(`conflicting lock or journal exists: ${basename(path)}`);
  const resources = join(dirname(paths.deployState), 'executor', 'resources');
  async function scan(directory) { if (!await exists(directory)) return; for (const entry of await readdir(directory, { withFileTypes: true })) { const path = join(directory, entry.name); if (entry.isSymbolicLink()) throw new MigrationError('resource state contains a symbolic link'); if (entry.isDirectory()) await scan(path); else if (entry.name === 'resource-state.lock') throw new MigrationError('resource lock exists'); } }
  await scan(resources);
  if (await exists(paths.deployState)) { const state = JSON.parse(await readFile(paths.deployState, 'utf8')); if (state.lease && (!Number.isFinite(Date.parse(state.lease.expiresAt)) || Date.parse(state.lease.expiresAt) > Date.parse(now))) throw new MigrationError('deployment lease is active or invalid'); }
  let containers;
  if (runtime.listContainers) containers = await runtime.listContainers();
  else {
    const listed = spawnSync(DOCKER, ['ps', '-aq'], { encoding: 'utf8' }); if (listed.status !== 0) throw new MigrationError('cannot enumerate containers');
    const ids = listed.stdout.trim().split(/\s+/).filter(Boolean); containers = [];
    if (ids.length) {
      const inspected = spawnSync(DOCKER, ['inspect', ...ids], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (inspected.status !== 0) throw new MigrationError('cannot inspect containers'); containers = JSON.parse(inspected.stdout);
    }
  }
  const protectedPaths = [];
  for (const path of [paths.active, paths.rawArchive, ...additionalProtectedPaths]) if (path && await exists(path)) {
    const canonicalPath = await realpath(path); if (!protectedPaths.includes(canonicalPath)) protectedPaths.push(canonicalPath);
  }
  for (const container of containers) {
      if (container?.Name === '/booking-preprod-control-plane' && container?.State?.Running) throw new MigrationError('control-plane container is running');
      if (container?.Name === '/booking-preprod-legacy-active-migration') {
        if (action === 'recover') throw new MigrationError('normal legacy migration container still exists');
        if (!container?.State?.Running || container?.State?.Pid !== process.pid) throw new MigrationError('another legacy migration container exists');
      }
      const inspectedMounts = [];
      for (const mount of container?.Mounts || []) {
        if (!mount?.Source || !isAbsolute(mount.Source)) throw new MigrationError('container mount source is not absolute');
        inspectedMounts.push({ ...mount, canonicalSource: await realpath(mount.Source) });
      }
      const canonicalParent = await realpath(paths.parent);
      const parentMounts = inspectedMounts.filter((mount) => mount.canonicalSource === canonicalParent && mount.Destination === paths.parent);
      const expectedSpecifications = [[paths.parent, paths.parent, true], [paths.receipts, paths.receipts, true], [dirname(paths.deployState), dirname(paths.deployState), false],
        ['/var/run/docker.sock', '/var/run/docker.sock', true], [DOCKER, DOCKER, false], [resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'), resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'), false]];
      const expectedMounts = new Map();
      if (['/booking-preprod-legacy-active-migration', '/booking-preprod-legacy-active-migration-recovery'].includes(container?.Name)) {
        for (const [source, destination, rw] of expectedSpecifications) expectedMounts.set(await realpath(source), { destination, rw });
      }
      const mountsExact = inspectedMounts.length === expectedMounts.size && inspectedMounts.every((mount) => {
        const expected = expectedMounts.get(mount.canonicalSource); return expected && expected.destination === mount.Destination && expected.rw === Boolean(mount.RW);
      });
      const host = container?.HostConfig || {};
      const self = ['/booking-preprod-legacy-active-migration', '/booking-preprod-legacy-active-migration-recovery'].includes(container?.Name) && container?.State?.Running &&
        container?.State?.Pid === process.pid && container?.Config?.Image === CONTROL_IMAGE && parentMounts.length === 1 && mountsExact && host.PidMode === 'host' &&
        host.NetworkMode === 'none' && host.ReadonlyRootfs === true && canonical(host.CapDrop || []) === canonical(['ALL']) && canonical(host.CapAdd || []) === canonical(['DAC_OVERRIDE']) &&
        canonical(host.SecurityOpt || []) === canonical(['no-new-privileges:true']);
      for (const mount of inspectedMounts) {
        const source = mount.canonicalSource;
        const contains = (parent, child) => { const delta = relative(resolve(parent), resolve(child)); return delta === '' || (!delta.startsWith('..') && !isAbsolute(delta)); };
        const overlaps = protectedPaths.some((path) => contains(source, path) || contains(path, source));
        const exactSelfParent = self && source === canonicalParent && mount?.Destination === paths.parent;
        if (overlaps && !exactSelfParent) throw new MigrationError('a foreign container mount overlaps active root');
      }
  }
  for (const path of protectedPaths) { await assertNoMounts(path, runtime); await assertNoOpenReferences(path, runtime); }
}

async function normalizeClone(source, target, settings, runtime) {
  await mkdir(target, { mode: 0o700 }); await assertCreatedOwner(target, settings, 'normalized stage');
  async function copyDirectory(from, to, prefix = '') {
    await mkdir(to, { mode: 0o700 }); await assertCreatedOwner(to, settings, `normalized directory ${prefix || '.'}`);
    const children = await readdir(from, { withFileTypes: true }); children.sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)));
    for (const child of children) {
      const sourcePath = join(from, child.name); const targetPath = join(to, child.name); const name = prefix ? `${prefix}/${child.name}` : child.name; const info = await lstat(sourcePath);
      if (info.isSymbolicLink()) throw new MigrationError(`symbolic link rejected while cloning: ${name}`);
      if (settings.uid !== null && (info.uid !== settings.uid || info.gid !== 0)) throw new MigrationError(`non-root source while cloning: ${name}`);
      if (info.isDirectory()) await copyDirectory(sourcePath, targetPath, name);
      else if (info.isFile()) { if (info.nlink !== 1) throw new MigrationError(`hard-linked source rejected while cloning: ${name}`); await copyFile(sourcePath, targetPath); await assertCreatedOwner(targetPath, settings, `normalized file ${name}`); await chmod(targetPath, EXECUTABLES.has(name) ? 0o555 : 0o444); await syncFile(targetPath, runtime); }
      else throw new MigrationError(`non-regular source while cloning: ${name}`);
    }
    await chmod(to, prefix ? 0o555 : 0o755); await syncDirectory(to, runtime);
  }
  for (const name of REQUIRED_ACTIVE_ROOT_ENTRIES) {
    const sourcePath = join(source, name); const info = await lstat(sourcePath); const targetPath = join(target, name);
    if (info.isDirectory()) await copyDirectory(sourcePath, targetPath, name);
    else { if (info.nlink !== 1) throw new MigrationError(`hard-linked source rejected while cloning: ${name}`); await copyFile(sourcePath, targetPath); await assertCreatedOwner(targetPath, settings, `normalized file ${name}`); await chmod(targetPath, EXECUTABLES.has(name) ? 0o555 : 0o444); await syncFile(targetPath, runtime); }
  }
  await chmod(target, 0o755); await syncDirectory(target, runtime); await syncDirectory(dirname(target), runtime);
}

async function publishJson(path, body, settings, runtime) {
  if (await exists(path)) throw new MigrationError(`immutable artifact already exists: ${basename(path)}`);
  const value = { ...body, receiptDigest: sha256(canonical(body)) }; const temporary = `${path}.${body.transactionId}.tmp`;
  const handle = await open(temporary, 'wx', 0o400);
  try {
    const failure = runtime.failReceiptWrite; runtime.failReceiptWrite = null;
    if (failure) { await handle.writeFile('{"partial":'); await handle.sync(); const error = new Error(`simulated ${failure}`); error.code = failure; throw error; }
    await handle.writeFile(`${canonical(value)}\n`); await handle.sync();
  } finally { await handle.close(); }
  await assertCreatedOwner(temporary, settings, 'receipt temporary'); await chmod(temporary, 0o400); await syncFile(temporary, runtime); await checkpoint(runtime, 'receipt:prepared');
  try { await link(temporary, path); } catch (error) { if (error?.code === 'EEXIST') throw new MigrationError(`immutable artifact already exists: ${basename(path)}`); throw error; }
  await syncDirectory(dirname(path), runtime); await checkpoint(runtime, 'receipt:published'); await unlink(temporary); await syncDirectory(dirname(path), runtime); return value;
}

async function writeJournal(paths, journal, settings, runtime, phase) {
  journal.phase = phase; journal.updatedAt = runtime.now || new Date().toISOString(); const temporary = `${paths.journal}.${journal.transactionId}.tmp`;
  const handle = await open(temporary, 'wx', 0o400);
  try {
    runtime.journalWriteCount = (runtime.journalWriteCount || 0) + 1;
    const failure = runtime.failJournalWrite && (runtime.failJournalWriteAtOccurrence === undefined || runtime.failJournalWriteAtOccurrence === runtime.journalWriteCount) ? runtime.failJournalWrite : null;
    if (failure) runtime.failJournalWrite = null;
    if (failure) { await handle.writeFile('{"partial":'); await handle.sync(); const error = new Error(`simulated ${failure}`); error.code = failure; throw error; }
    await handle.writeFile(`${canonical(journal)}\n`); await handle.sync();
  } finally { await handle.close(); }
  await assertCreatedOwner(temporary, settings, 'journal temporary'); await chmod(temporary, 0o400); await syncFile(temporary, runtime);
  await checkpoint(runtime, 'journal:prepared');
  if (runtime.portableReplace && await exists(paths.journal)) await chmod(paths.journal, 0o600);
  await rename(temporary, paths.journal); await syncDirectory(paths.parent, runtime); await checkpoint(runtime, 'journal:linked'); await checkpoint(runtime, `journal:${phase}`);
}

async function readJournal(paths, args, settings, path = paths.journal) {
  const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (settings.uid !== null && (info.uid !== settings.uid || info.gid !== 0)) ||
      (settings.enforceMode && (info.mode & 0o777) !== 0o400)) throw new MigrationError('migration journal is not immutable root:root');
  const journal = JSON.parse(await readFile(path, 'utf8'));
  const fields = ['schema', 'action', 'transactionId', 'migrationId', 'approvalId', 'phase', 'rawInventoryDigest', 'normalizedInventoryDigest', 'predecessorReceiptDigest', 'stageName', 'rawArchiveName', 'normalizedRetiredName', 'receiptDigest', 'updatedAt'];
  if (!journal || typeof journal !== 'object' || Array.isArray(journal) || canonical(Object.keys(journal).sort()) !== canonical(fields.sort()) ||
      journal.schema !== 'booking.preprod-legacy-active-migration-transaction/v1' || !['migrate', 'rollback'].includes(journal.action) || !UUID.test(journal.transactionId || '') ||
      journal.transactionId !== args['transaction-id'] || journal.migrationId !== args['migration-id'] || journal.approvalId !== args['approval-id'] || !PHASES.has(journal.phase) || !Number.isFinite(Date.parse(journal.updatedAt))) throw new MigrationError('recovery identity does not match journal');
  for (const [value, label] of [[journal.rawInventoryDigest, 'raw inventory'], [journal.normalizedInventoryDigest, 'normalized inventory'], [journal.receiptDigest, 'receipt']]) if (value !== null && !DIGEST.test(value || '')) throw new MigrationError(`journal ${label} digest is invalid`);
  const stageName = `.happybooking-legacy-normalized-stage-${journal.transactionId}`; const retiredName = `.happybooking-legacy-normalized-retired-${journal.transactionId}`;
  if (journal.rawArchiveName !== basename(paths.rawArchive) || (journal.action === 'migrate' && (journal.predecessorReceiptDigest !== null || journal.stageName !== stageName || journal.normalizedRetiredName !== null || !new Set(['PREPARED', 'STAGED', 'RAW_RETIRED', 'NORMALIZED_ACTIVE', 'RECEIPT_PUBLISHED', 'COMPLETE']).has(journal.phase))) ||
      (journal.action === 'rollback' && (journal.predecessorReceiptDigest !== args['predecessor-receipt-digest'] || journal.normalizedInventoryDigest !== args['expected-normalized-inventory-digest'] ||
        journal.stageName !== null || journal.normalizedRetiredName !== retiredName || !new Set(['PREPARED', 'NORMALIZED_RETIRED', 'RAW_RESTORED', 'RECEIPT_PUBLISHED', 'COMPLETE']).has(journal.phase)))) throw new MigrationError('journal paths, predecessor or phase are not fixed by transaction identity');
  return journal;
}

async function reconcileJournalTemp(paths, args, settings, runtime) {
  const prefix = `${basename(paths.journal)}.`; const suffix = '.tmp'; const candidates = [];
  for (const name of await readdir(paths.parent)) if (name.startsWith(prefix) && name.endsWith(suffix)) candidates.push({ name, transactionId: name.slice(prefix.length, -suffix.length), path: join(paths.parent, name) });
  if (candidates.some((entry) => !UUID.test(entry.transactionId)) || candidates.length > 1 || (candidates[0] && candidates[0].transactionId !== args['transaction-id'])) throw new MigrationError('ambiguous legacy migration journal temporaries');
  const temporary = candidates[0]; if (!temporary) return;
  let candidate;
  try { candidate = await readJournal(paths, args, settings, temporary.path); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    await discardPartialArtifact(paths, args, temporary.path, 'journal', settings, runtime); return;
  }
  if (!await exists(paths.journal)) { await rename(temporary.path, paths.journal); await syncDirectory(paths.parent, runtime); return; }
  const durable = await readJournal(paths, args, settings); for (const key of ['schema', 'action', 'transactionId', 'migrationId', 'approvalId', 'stageName', 'rawArchiveName', 'normalizedRetiredName']) if (canonical(candidate[key]) !== canonical(durable[key])) throw new MigrationError('journal temporary identity differs from durable journal');
  await unlink(temporary.path); await syncDirectory(paths.parent, runtime);
}

async function clearTransaction(paths, runtime) {
  if (await exists(paths.journal)) await unlink(paths.journal); if (await exists(paths.lock)) await unlink(paths.lock); await syncDirectory(paths.parent, runtime);
}

async function acquire(paths, args, transactionId, settings, runtime) {
  const temporary = `${paths.lock}.${transactionId}.tmp`;
  if (await exists(paths.lock) || await exists(paths.journal) || (await lockTemps(paths)).length) throw new MigrationError('unfinished legacy migration requires recover');
  const owner = { schema: 'booking.preprod-legacy-active-migration-lock/v1', action: args.action, transactionId, migrationId: args['migration-id'], approvalId: args['approval-id'], createdAt: runtime.now || new Date().toISOString() };
  const handle = await open(temporary, 'wx', 0o400);
  try {
    await checkpoint(runtime, 'lock:temp-created');
    if (runtime.failLockWrite) { const code = runtime.failLockWrite; runtime.failLockWrite = null; await handle.writeFile('{"partial":'); const error = new Error(`simulated ${code}`); error.code = code; throw error; }
    await handle.writeFile(`${canonical(owner)}\n`); await handle.sync(); await checkpoint(runtime, 'lock:owner-written');
  } finally { await handle.close(); }
  await assertCreatedOwner(temporary, settings, 'lock temporary'); await chmod(temporary, 0o400); await syncFile(temporary, runtime); await checkpoint(runtime, 'lock:prepared');
  try { await link(temporary, paths.lock); } catch (error) { if (error?.code === 'EEXIST') throw new MigrationError('legacy migration lock already exists'); throw error; }
  await syncDirectory(paths.parent, runtime); await checkpoint(runtime, 'lock:published'); await unlink(temporary); await syncDirectory(paths.parent, runtime); await checkpoint(runtime, 'lock:acquired');
  return { schema: 'booking.preprod-legacy-active-migration-transaction/v1', action: args.action, transactionId, migrationId: args['migration-id'], approvalId: args['approval-id'], phase: 'PREPARED',
    rawInventoryDigest: null, normalizedInventoryDigest: null, predecessorReceiptDigest: null, stageName: null, rawArchiveName: basename(paths.rawArchive), normalizedRetiredName: null, receiptDigest: null, updatedAt: runtime.now || new Date().toISOString() };
}

async function lockTemps(paths) {
  const prefix = `${basename(paths.lock)}.`; const suffix = '.tmp'; const found = [];
  for (const name of await readdir(paths.parent)) {
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
    const transactionId = name.slice(prefix.length, -suffix.length); if (!UUID.test(transactionId)) throw new MigrationError('malformed legacy migration lock temporary exists');
    found.push({ transactionId, path: join(paths.parent, name) });
  }
  return found;
}

async function validateLockOwner(directory, args, settings) {
  const info = await lstat(directory);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (settings.uid !== null && (info.uid !== settings.uid || info.gid !== 0)) ||
      (settings.enforceMode && (info.mode & 0o777) !== 0o400)) throw new MigrationError('legacy migration lock is not immutable root:root');
  const owner = JSON.parse(await readFile(directory, 'utf8'));
  if (canonical(Object.keys(owner).sort()) !== canonical(['schema', 'action', 'transactionId', 'migrationId', 'approvalId', 'createdAt'].sort()) || owner.schema !== 'booking.preprod-legacy-active-migration-lock/v1' ||
      !['migrate', 'rollback'].includes(owner.action) || owner.transactionId !== args['transaction-id'] || owner.migrationId !== args['migration-id'] || owner.approvalId !== args['approval-id'] || !Number.isFinite(Date.parse(owner.createdAt))) throw new MigrationError('recovery identity does not match lock owner');
  return owner;
}

async function lockArtifact(path) {
  const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new MigrationError('legacy migration lock artifact is unsafe');
  const bytes = await readFile(path); return { path, dev: info.dev, ino: info.ino, size: info.size, digest: sha256(bytes) };
}

async function inspectPartialArtifact(path, settings, label) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024 * 1024 ||
      (settings.uid !== null && (info.uid !== settings.uid || info.gid !== 0)) || (settings.enforceMode && (info.mode & 0o777) !== 0o400)) {
    throw new MigrationError(`partial ${label} is not a bounded immutable root:root regular file`);
  }
  const bytes = await readFile(path); return { path, dev: info.dev, ino: info.ino, size: info.size, digest: sha256(bytes) };
}

async function discardPartialArtifact(paths, args, path, label, settings, runtime) {
  await assertQuiescent(paths, runtime, runtime.now || new Date().toISOString(), 'recover');
  const artifact = await inspectPartialArtifact(path, settings, label);
  const quarantine = `${path}.corrupt-sha256-${artifact.digest.slice('sha256:'.length)}`;
  await assertQuiescent(paths, runtime, runtime.now || new Date().toISOString(), 'recover');
  const current = await inspectPartialArtifact(path, settings, label);
  if (current.dev !== artifact.dev || current.ino !== artifact.ino || current.size !== artifact.size || current.digest !== artifact.digest) throw new MigrationError(`partial ${label} changed before quarantine`);
  if (await exists(quarantine)) {
    const existing = await inspectPartialArtifact(quarantine, settings, `${label} quarantine`);
    if (existing.size !== artifact.size || existing.digest !== artifact.digest) throw new MigrationError(`partial ${label} quarantine conflicts with retained evidence`);
    await assertQuiescent(paths, runtime, runtime.now || new Date().toISOString(), 'recover');
    const sourceAgain = await inspectPartialArtifact(path, settings, label); const targetAgain = await inspectPartialArtifact(quarantine, settings, `${label} quarantine`);
    if (sourceAgain.dev !== artifact.dev || sourceAgain.ino !== artifact.ino || sourceAgain.digest !== artifact.digest || targetAgain.digest !== artifact.digest) throw new MigrationError(`partial ${label} duplicate changed before cleanup`);
    await unlink(path);
  } else { await checkpoint(runtime, 'quarantine:before-rename'); await rename(path, quarantine); await checkpoint(runtime, 'quarantine:renamed'); }
  await chmod(quarantine, 0o400);
  if (runtime.failQuarantineSync) { const code = runtime.failQuarantineSync; runtime.failQuarantineSync = null; const error = new Error(`simulated ${code}`); error.code = code; throw error; }
  await syncDirectory(dirname(path), runtime); await checkpoint(runtime, 'quarantine:synced'); return { status: 'quarantined', quarantine: basename(quarantine), artifactDigest: artifact.digest };
}

async function recoverIncompleteLock(paths, args, artifact, settings, runtime) {
  await assertQuiescent(paths, runtime, runtime.now || new Date().toISOString(), 'recover');
  const unsafe = (await readdir(paths.parent)).find((name) => name.includes(args['transaction-id']) && (name.startsWith('.happybooking-legacy-normalized-stage-') || name.startsWith('.happybooking-legacy-normalized-retired-')));
  if (unsafe || await exists(paths.journal) || await exists(paths.lock)) throw new MigrationError('incomplete lock has transaction state; forensic stop required');
  const receiptPath = join(paths.receipts, `control-plane-legacy-lock-recovery-${args['transaction-id']}.json`);
  const body = { schema: 'booking.preprod-legacy-lock-recovery-receipt/v1', status: 'pass', action: 'recover-incomplete-lock', environment: 'preprod', project: 'booking-preprod', transactionId: args['transaction-id'], migrationId: args['migration-id'], approvalId: args['approval-id'], artifactDigest: artifact.digest, artifactSize: artifact.size, recoveredAt: runtime.now || new Date().toISOString() };
  const receipt = await finishOrPublishReceipt(receiptPath, body, 'recover-incomplete-lock', args, settings, runtime, paths);
  for (const [key, value] of Object.entries(body)) if (canonical(receipt[key]) !== canonical(value)) throw new MigrationError('incomplete-lock forensic receipt does not bind the current artifact');
  await checkpoint(runtime, 'lock-forensic:published');
  await assertQuiescent(paths, runtime, runtime.now || new Date().toISOString(), 'recover');
  const current = await lockArtifact(artifact.path); if (current.dev !== artifact.dev || current.ino !== artifact.ino || current.size !== artifact.size || current.digest !== artifact.digest) throw new MigrationError('incomplete lock changed after forensic receipt publication');
  await checkpoint(runtime, 'lock-forensic:revalidated'); await unlink(artifact.path); await syncDirectory(paths.parent, runtime); return { status: 'cleared-incomplete-lock', receipt };
}

async function validateReceipt(path, expectedAction, args, settings, bindRequest = true) {
  const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (settings.uid !== null && (info.uid !== settings.uid || info.gid !== 0)) ||
      (settings.enforceMode && (info.mode & 0o777) !== 0o400)) throw new MigrationError('migration receipt is not immutable root:root');
  const receipt = JSON.parse(await readFile(path, 'utf8'));
  const common = ['schema', 'status', 'action', 'environment', 'project', 'transactionId', 'migrationId', 'approvalId'];
  const expectedFields = expectedAction === 'migrate' ? [...common, 'rawInventoryDigest', 'normalizedInventoryDigest', 'rawArchiveName', 'migratedAt', 'receiptDigest']
    : expectedAction === 'rollback' ? [...common, 'predecessorReceiptDigest', 'rawInventoryDigest', 'normalizedInventoryDigest', 'normalizedArchiveName', 'rolledBackAt', 'receiptDigest']
      : expectedAction === 'recover-incomplete-lock' ? [...common, 'artifactDigest', 'artifactSize', 'recoveredAt', 'receiptDigest'] : null;
  if (!expectedFields || !receipt || typeof receipt !== 'object' || Array.isArray(receipt) || canonical(Object.keys(receipt).sort()) !== canonical(expectedFields.sort())) throw new MigrationError('migration receipt fields are invalid');
  const { receiptDigest, ...body } = receipt;
  if (receiptDigest !== sha256(canonical(body)) || receipt.status !== 'pass' || receipt.action !== expectedAction || receipt.environment !== 'preprod' || receipt.project !== 'booking-preprod' || receipt.migrationId !== args['migration-id'] ||
      (bindRequest && (receipt.approvalId !== args['approval-id'] || (args['transaction-id'] && receipt.transactionId !== args['transaction-id'])))) throw new MigrationError('migration receipt is invalid');
  if (expectedAction === 'migrate' && (receipt.schema !== 'booking.preprod-legacy-active-migration-receipt/v1' || receipt.rawArchiveName !== `.happybooking-legacy-raw-${receipt.migrationId}` ||
      !Number.isFinite(Date.parse(receipt.migratedAt)))) throw new MigrationError('migration receipt paths or schema are invalid');
  if (expectedAction === 'rollback' && (receipt.schema !== 'booking.preprod-legacy-active-migration-receipt/v1' || receipt.normalizedArchiveName !== `.happybooking-legacy-normalized-retired-${receipt.transactionId}` ||
      !Number.isFinite(Date.parse(receipt.rolledBackAt)))) throw new MigrationError('rollback receipt paths or schema are invalid');
  if (expectedAction === 'recover-incomplete-lock' && (receipt.schema !== 'booking.preprod-legacy-lock-recovery-receipt/v1' || !Number.isSafeInteger(receipt.artifactSize) || receipt.artifactSize < 0 ||
      !Number.isFinite(Date.parse(receipt.recoveredAt)))) throw new MigrationError('lock recovery receipt schema is invalid');
  for (const key of ['receiptDigest', 'rawInventoryDigest', 'normalizedInventoryDigest', 'predecessorReceiptDigest', 'artifactDigest']) if (receipt[key] !== undefined && !DIGEST.test(receipt[key])) throw new MigrationError(`migration receipt ${key} is invalid`);
  return receipt;
}

async function finishOrPublishReceipt(path, body, expectedAction, args, settings, runtime, paths = null) {
  const temporary = `${path}.${body.transactionId}.tmp`;
  if (await exists(path) && await exists(temporary)) {
    const published = await lockArtifact(path); const staged = await lockArtifact(temporary);
    if (published.dev !== staged.dev || published.ino !== staged.ino || published.digest !== staged.digest) throw new MigrationError('published receipt differs from its temporary hard link');
    await unlink(temporary); await syncDirectory(dirname(path), runtime); return validateReceipt(path, expectedAction, args, settings);
  }
  if (await exists(path)) return validateReceipt(path, expectedAction, args, settings);
  if (await exists(temporary)) {
    let receipt;
    try { receipt = await validateReceipt(temporary, expectedAction, args, settings); }
    catch (error) {
      if (!(error instanceof SyntaxError) || !paths) throw error;
      await discardPartialArtifact(paths, args, temporary, 'receipt', settings, runtime);
      return publishJson(path, body, settings, runtime);
    }
    await link(temporary, path); await syncDirectory(dirname(path), runtime); await unlink(temporary); await syncDirectory(dirname(path), runtime); return receipt;
  }
  return publishJson(path, body, settings, runtime);
}

async function recover(paths, args, settings, runtime) {
  const journal = await readJournal(paths, args, settings); const stage = journal.stageName ? join(paths.parent, journal.stageName) : null; const retired = journal.normalizedRetiredName ? join(paths.parent, journal.normalizedRetiredName) : null;
  await assertQuiescent(paths, runtime, runtime.now || new Date().toISOString(), 'recover', [stage, retired].filter(Boolean));
  if (journal.action === 'migrate') {
    if (['PREPARED', 'STAGED', 'RAW_RETIRED'].includes(journal.phase)) {
      const activeExists = await exists(paths.active); const rawExists = await exists(paths.rawArchive); const stageExists = stage && await exists(stage);
      if (activeExists && rawExists) {
        if (journal.phase !== 'RAW_RETIRED' || stageExists) throw new MigrationError('ambiguous pre-commit migration trees');
        await rename(paths.active, stage); await syncDirectory(paths.parent, runtime); await rename(paths.rawArchive, paths.active); await syncDirectory(paths.parent, runtime); await rm(stage, { recursive: true });
      } else if (!activeExists && rawExists) {
        await rename(paths.rawArchive, paths.active); await syncDirectory(paths.parent, runtime); if (stageExists) await rm(stage, { recursive: true });
      } else if (activeExists && !rawExists) {
        if (stageExists) await rm(stage, { recursive: true });
      } else throw new MigrationError('pre-commit migration trees are incomplete');
      const restored = await inventory(paths.active, settings); if (journal.rawInventoryDigest && restored.digest !== journal.rawInventoryDigest) throw new MigrationError('restored raw tree identity mismatch');
      await clearTransaction(paths, runtime); return { status: journal.phase === 'RAW_RETIRED' || rawExists ? 'raw-active-restored' : 'rolled-back-before-retire' };
    }
    if (!await exists(paths.active) || !await exists(paths.rawArchive)) throw new MigrationError('completed migration trees are incomplete');
    const active = await inventory(paths.active, { ...settings, strict: true }); const raw = await inventory(paths.rawArchive, settings);
    if (active.digest !== journal.normalizedInventoryDigest || raw.digest !== journal.rawInventoryDigest) throw new MigrationError('completed migration tree identity mismatch');
    const receipt = await finishOrPublishReceipt(paths.migrationReceipt, { schema: 'booking.preprod-legacy-active-migration-receipt/v1', status: 'pass', action: 'migrate', environment: 'preprod', project: 'booking-preprod', transactionId: journal.transactionId, migrationId: journal.migrationId, approvalId: journal.approvalId, rawInventoryDigest: raw.digest, normalizedInventoryDigest: active.digest, rawArchiveName: journal.rawArchiveName, migratedAt: runtime.now || new Date().toISOString() }, 'migrate', args, settings, runtime, paths);
    await clearTransaction(paths, runtime); return { status: 'completed', receipt };
  }
  if (['PREPARED', 'NORMALIZED_RETIRED'].includes(journal.phase)) {
    const activeExists = await exists(paths.active); const rawExists = await exists(paths.rawArchive); const retiredExists = retired && await exists(retired);
    if (activeExists && !rawExists && retiredExists) {
      await rename(paths.active, paths.rawArchive); await syncDirectory(paths.parent, runtime); await rename(retired, paths.active); await syncDirectory(paths.parent, runtime);
    } else if (!activeExists && rawExists && retiredExists) { await rename(retired, paths.active); await syncDirectory(paths.parent, runtime); }
    else if (!(activeExists && rawExists && !retiredExists)) throw new MigrationError('pre-commit rollback trees are incomplete');
    const normalized = await inventory(paths.active, { ...settings, strict: true }); const raw = await inventory(paths.rawArchive, settings);
    if ((journal.normalizedInventoryDigest && normalized.digest !== journal.normalizedInventoryDigest) || (journal.rawInventoryDigest && raw.digest !== journal.rawInventoryDigest)) throw new MigrationError('restored rollback tree identity mismatch');
    await clearTransaction(paths, runtime); return { status: journal.phase === 'NORMALIZED_RETIRED' || retiredExists ? 'normalized-active-restored' : 'rollback-not-started' };
  }
  if (!await exists(paths.active) || await exists(paths.rawArchive) || !retired || !await exists(retired)) throw new MigrationError('completed rollback trees are incomplete');
  const active = await inventory(paths.active, settings); const normalized = await inventory(retired, { ...settings, strict: true });
  if (active.digest !== journal.rawInventoryDigest || normalized.digest !== journal.normalizedInventoryDigest) throw new MigrationError('completed rollback tree identity mismatch');
  const receipt = await finishOrPublishReceipt(paths.rollbackReceipt, { schema: 'booking.preprod-legacy-active-migration-receipt/v1', status: 'pass', action: 'rollback', environment: 'preprod', project: 'booking-preprod', transactionId: journal.transactionId, migrationId: journal.migrationId, approvalId: journal.approvalId, predecessorReceiptDigest: journal.predecessorReceiptDigest, rawInventoryDigest: active.digest, normalizedInventoryDigest: normalized.digest, normalizedArchiveName: journal.normalizedRetiredName, rolledBackAt: runtime.now || new Date().toISOString() }, 'rollback', args, settings, runtime, paths);
  await clearTransaction(paths, runtime); return { status: 'rollback-completed', receipt };
}

async function assertApprovedRawInventory(paths, expected, settings) {
  if (!DIGEST.test(expected || '')) throw new MigrationError('approved raw inventory digest is invalid');
  const candidates = [];
  for (const path of [paths.rawArchive, paths.active]) if (await exists(path)) {
    try { candidates.push(await inventory(path, settings)); } catch { /* normalized active can coexist with the raw archive */ }
  }
  if (!candidates.some((candidate) => candidate.digest === expected)) throw new MigrationError('recover cannot find the independently approved raw inventory');
}

export async function runLegacyActiveMigration(input, runtime = {}) {
  const args = parseArgs(input); const paths = pathsFor(args, runtime); const settings = { uid: runtime.expectedUid === undefined ? 0 : runtime.expectedUid, enforceMode: runtime.enforceMode === undefined ? true : runtime.enforceMode };
  await assertDirectory(paths.parent, settings.uid, 'fixed install parent', settings.enforceMode); await assertDirectory(paths.receipts, settings.uid, 'fixed receipt root', settings.enforceMode);
  if (args.action === 'inventory') {
    await assertReviewedRoot(paths.active); await assertNoMounts(paths.active, runtime); const raw = await inventory(paths.active, settings);
    return { schema: 'booking.preprod-legacy-active-inventory/v1', status: 'pass', action: 'inventory', environment: 'preprod', project: 'booking-preprod', migrationId: args['migration-id'], approvalId: args['approval-id'], observedAt: runtime.now || new Date().toISOString(), rootEntries: REVIEWED_ROOT_ENTRIES, inventoryDigest: raw.digest, entries: raw.entries };
  }
  if (args.action === 'recover') {
    await assertQuiescent(paths, runtime, runtime.now || new Date().toISOString(), 'recover');
    const temps = await lockTemps(paths); const exactTemp = temps.find((entry) => entry.transactionId === args['transaction-id']);
    if (temps.some((entry) => entry.transactionId !== args['transaction-id'])) throw new MigrationError('ambiguous legacy migration lock artifacts');
    if (!await exists(paths.lock) && !exactTemp) throw new MigrationError('recovery lock is absent');
    if (await exists(paths.lock) && exactTemp) {
      const fixed = await lockArtifact(paths.lock); const temporary = await lockArtifact(exactTemp.path);
      if (fixed.dev !== temporary.dev || fixed.ino !== temporary.ino || fixed.digest !== temporary.digest) throw new MigrationError('ambiguous legacy migration lock artifacts');
      await unlink(exactTemp.path); await syncDirectory(paths.parent, runtime);
    }
    if (!await exists(paths.lock) && exactTemp) {
      try { await validateLockOwner(exactTemp.path, args, settings); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; return recoverIncompleteLock(paths, args, await lockArtifact(exactTemp.path), settings, runtime); }
      await chmod(exactTemp.path, 0o400); await link(exactTemp.path, paths.lock); await syncDirectory(paths.parent, runtime); await unlink(exactTemp.path); await syncDirectory(paths.parent, runtime);
    }
    await validateLockOwner(paths.lock, args, settings);
    await assertQuiescent(paths, runtime, runtime.now || new Date().toISOString(), 'recover'); if (await exists(paths.active)) await assertNoMounts(paths.active, runtime);
    await assertApprovedRawInventory(paths, args['expected-raw-inventory-digest'], settings);
    await reconcileJournalTemp(paths, args, settings, runtime);
    if (!await exists(paths.journal)) {
      await unlink(paths.lock); await syncDirectory(paths.parent, runtime); return { status: 'cleared-pre-journal-lock' };
    }
    return recover(paths, args, settings, runtime);
  }
  await assertQuiescent(paths, runtime, runtime.now || new Date().toISOString(), args.action); await assertNoMounts(paths.active, runtime);
  let rollbackPreflight = null;
  if (args.action === 'migrate') {
    if (await exists(paths.migrationReceipt)) {
      const receipt = await validateReceipt(paths.migrationReceipt, 'migrate', args, settings);
      if (receipt.transactionId !== args['transaction-id'] || receipt.rawInventoryDigest !== args['expected-raw-inventory-digest'] || !await exists(paths.rawArchive)) throw new MigrationError('completed migration receipt does not match replay request');
      const active = await inventory(paths.active, { ...settings, strict: true }); const raw = await inventory(paths.rawArchive, settings);
      if (active.digest !== receipt.normalizedInventoryDigest || raw.digest !== receipt.rawInventoryDigest) throw new MigrationError('completed migration replay readback failed');
      return receipt;
    }
    if (await exists(paths.rawArchive)) throw new MigrationError('raw archive exists without an exact immutable migration receipt');
  } else {
    if (await exists(paths.rollbackReceipt)) {
      const receipt = await validateReceipt(paths.rollbackReceipt, 'rollback', args, settings);
      if (receipt.transactionId !== args['transaction-id'] || receipt.rawInventoryDigest !== args['expected-raw-inventory-digest'] || receipt.normalizedInventoryDigest !== args['expected-normalized-inventory-digest'] ||
          receipt.predecessorReceiptDigest !== args['predecessor-receipt-digest']) throw new MigrationError('completed rollback receipt does not match replay request');
      const normalizedArchive = join(paths.parent, `.happybooking-legacy-normalized-retired-${args['transaction-id']}`);
      if (!await exists(paths.active) || !await exists(normalizedArchive)) throw new MigrationError('completed rollback replay trees are incomplete');
      const active = await inventory(paths.active, settings); const normalized = await inventory(normalizedArchive, { ...settings, strict: true });
      if (active.digest !== receipt.rawInventoryDigest || normalized.digest !== receipt.normalizedInventoryDigest) throw new MigrationError('completed rollback replay readback failed');
      return receipt;
    }
    if (!await exists(paths.rawArchive)) throw new MigrationError('rollback raw archive is absent before transaction acquisition');
    if (!args['predecessor-receipt-digest'] || !args['expected-raw-inventory-digest'] || !args['expected-normalized-inventory-digest']) throw new MigrationError('rollback requires exact predecessor and inventory digests');
    const migration = await validateReceipt(paths.migrationReceipt, 'migrate', args, settings, false);
    if (migration.receiptDigest !== args['predecessor-receipt-digest']) throw new MigrationError('rollback predecessor receipt differs from approval');
    const active = await inventory(paths.active, { ...settings, strict: true }); const raw = await inventory(paths.rawArchive, settings);
    if (active.digest !== args['expected-normalized-inventory-digest'] || raw.digest !== args['expected-raw-inventory-digest'] || active.digest !== migration.normalizedInventoryDigest || raw.digest !== migration.rawInventoryDigest) throw new MigrationError('rollback tree identity mismatch');
    rollbackPreflight = { migration, active, raw };
  }
  const transactionId = args['transaction-id']; const journal = await acquire(paths, args, transactionId, settings, runtime); let preserve = false;
  try {
    if (args.action === 'migrate') journal.stageName = `.happybooking-legacy-normalized-stage-${transactionId}`;
    else { journal.normalizedRetiredName = `.happybooking-legacy-normalized-retired-${transactionId}`; journal.predecessorReceiptDigest = rollbackPreflight.migration.receiptDigest; journal.rawInventoryDigest = rollbackPreflight.raw.digest; journal.normalizedInventoryDigest = rollbackPreflight.active.digest; }
    await writeJournal(paths, journal, settings, runtime, 'PREPARED');
    if (args.action === 'migrate') {
      if (!args['expected-raw-inventory-digest']) throw new MigrationError('migrate requires expected raw inventory digest');
      if (await exists(paths.rawArchive) || await exists(paths.migrationReceipt)) throw new MigrationError('migration target or immutable receipt already exists');
      await assertReviewedRoot(paths.active); const raw = await inventory(paths.active, settings);
      if (raw.digest !== args['expected-raw-inventory-digest']) throw new MigrationError('raw inventory differs from the reviewed digest');
      const stageName = journal.stageName; const stage = join(paths.parent, stageName); journal.rawInventoryDigest = raw.digest;
      await normalizeClone(paths.active, stage, settings, runtime); const normalized = await inventory(stage, { ...settings, strict: true }); journal.normalizedInventoryDigest = normalized.digest;
      await writeJournal(paths, journal, settings, runtime, 'STAGED'); await assertQuiescent(paths, runtime, runtime.now || new Date().toISOString(), args.action, [stage]); await assertNoMounts(paths.active, runtime); await assertReviewedRoot(paths.active);
      const unchangedRaw = await inventory(paths.active, settings); if (unchangedRaw.digest !== raw.digest) throw new MigrationError('legacy active tree changed while normalized stage was built');
      await rename(paths.active, paths.rawArchive); await syncDirectory(paths.parent, runtime); await checkpoint(runtime, 'rename:raw-retired'); await writeJournal(paths, journal, settings, runtime, 'RAW_RETIRED');
      const archivedRaw = await inventory(paths.rawArchive, settings); if (archivedRaw.digest !== raw.digest) throw new MigrationError('raw archive changed during retirement');
      await rename(stage, paths.active); await syncDirectory(paths.parent, runtime); await checkpoint(runtime, 'rename:normalized-active'); const installed = await inventory(paths.active, { ...settings, strict: true }); if (installed.digest !== normalized.digest) throw new MigrationError('normalized active tree changed during rename'); await writeJournal(paths, journal, settings, runtime, 'NORMALIZED_ACTIVE');
      const receipt = await publishJson(paths.migrationReceipt, { schema: 'booking.preprod-legacy-active-migration-receipt/v1', status: 'pass', action: 'migrate', environment: 'preprod', project: 'booking-preprod', transactionId, migrationId: args['migration-id'], approvalId: args['approval-id'], rawInventoryDigest: raw.digest, normalizedInventoryDigest: normalized.digest, rawArchiveName: basename(paths.rawArchive), migratedAt: runtime.now || new Date().toISOString() }, settings, runtime); journal.receiptDigest = receipt.receiptDigest;
      await writeJournal(paths, journal, settings, runtime, 'RECEIPT_PUBLISHED'); await writeJournal(paths, journal, settings, runtime, 'COMPLETE'); await clearTransaction(paths, runtime); return receipt;
    }
    const { migration, active, raw } = rollbackPreflight;
    const retired = join(paths.parent, journal.normalizedRetiredName); await rename(paths.active, retired); await syncDirectory(paths.parent, runtime); await checkpoint(runtime, 'rename:normalized-retired'); await writeJournal(paths, journal, settings, runtime, 'NORMALIZED_RETIRED');
    await rename(paths.rawArchive, paths.active); await syncDirectory(paths.parent, runtime); await checkpoint(runtime, 'rename:raw-restored'); await writeJournal(paths, journal, settings, runtime, 'RAW_RESTORED');
    const receipt = await publishJson(paths.rollbackReceipt, { schema: 'booking.preprod-legacy-active-migration-receipt/v1', status: 'pass', action: 'rollback', environment: 'preprod', project: 'booking-preprod', transactionId, migrationId: args['migration-id'], approvalId: args['approval-id'], predecessorReceiptDigest: migration.receiptDigest, rawInventoryDigest: raw.digest, normalizedInventoryDigest: active.digest, normalizedArchiveName: journal.normalizedRetiredName, rolledBackAt: runtime.now || new Date().toISOString() }, settings, runtime); journal.receiptDigest = receipt.receiptDigest;
    await writeJournal(paths, journal, settings, runtime, 'RECEIPT_PUBLISHED'); await writeJournal(paths, journal, settings, runtime, 'COMPLETE'); await clearTransaction(paths, runtime); return receipt;
  } catch (error) {
    const journalTempPrefix = `${basename(paths.journal)}.`;
    const hasJournalTemp = (await readdir(paths.parent)).some((name) => name.startsWith(journalTempPrefix) && name.endsWith('.tmp'));
    if (error instanceof SimulatedLegacyMigrationCrash || await exists(paths.journal) || hasJournalTemp) preserve = true;
    throw error;
  } finally { if (!preserve && await exists(paths.lock)) await unlink(paths.lock); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${canonical(await runLegacyActiveMigration(process.argv.slice(2)))}\n`); }
  catch (error) { process.stderr.write(`booking-preprod legacy active migration rejected the request: ${error instanceof MigrationError ? error.message : 'unexpected failure'}\n`); process.exitCode = 64; }
}
