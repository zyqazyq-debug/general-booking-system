#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod, chown, copyFile, link, lstat, mkdir, open, readFile, readdir, realpath,
  rename, rm, stat, unlink,
} from 'node:fs/promises';
import { basename, dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const INSTALL_ROOT = '/usr/local/libexec/happybooking';
const ROLLBACK_ROOT = '/usr/local/libexec/happybooking.rollback';
const BUNDLE_ROOT = '/volume1/happybooking/booking-preprod/.g4/control-plane-install/bundles';
const RECEIPT_ROOT = '/volume1/happybooking/booking-preprod/.g4/receipts';
const APPROVAL_ROOT = '/volume1/happybooking/booking-preprod/.g4/control-plane-install/approvals';
const LOCK_PATH = '/usr/local/libexec/.happybooking-control-plane-install.lock';
const JOURNAL_PATH = '/usr/local/libexec/.happybooking-control-plane-install.journal.json';
const RUNTIME_LOCK_PATH = '/usr/local/libexec/.happybooking-control-plane-runtime.lock';
const DEPLOY_STATE_PATH = '/var/lib/happybooking/deploy-state/preprod/booking-preprod/deploy-state.json';
const DOCKER = '/var/packages/ContainerManager/target/usr/bin/docker';
const INSTALLER_CONTAINER = 'booking-preprod-control-plane-installer';
const INSTALLER_RECOVERY_CONTAINER = 'booking-preprod-control-plane-installer-recovery';
const CONTROL_IMAGE = 'node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5';
const COSIGN = '/usr/local/bin/cosign';
const APPROVER_PUBLIC_KEY = '/etc/happybooking/trust/control-plane-approver.pub';
const APPROVER_PUBLIC_KEY_ANCHOR = '/etc/happybooking/trust/control-plane-approver.pub.sha256';
const HOST_IDENTITY_PATH = '/etc/machine-id';
const COSIGN_BINARY_DIGESTS = Object.freeze({ x64: 'sha256:f7622ed3cf22e55e1ae6377c080979ff77a22da9981c11df222a2e444991e7cf', arm64: 'sha256:90e7ae0b5dfd60f20816b52c012addf7fc055ebcc7bea4ce81c428ca8518c302' });
const INSTALL_ID = /^booking-control-[0-9]{8}T[0-9]{6}Z-([0-9a-f]{12})$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;
const ROOT_ENTRIES = ['control-plane', 'run-booking-preprod-control-plane', 'switch-preprod-ingress', 'switch-preprod-ingress.mjs'];
const REQUIRED_FILES = [
  'run-booking-preprod-control-plane', 'switch-preprod-ingress', 'switch-preprod-ingress.mjs',
  'control-plane/ops/release/execute-fenced-action.mjs', 'control-plane/ops/release/manage-deploy-state.mjs',
  'control-plane/ops/release/generate-database-backup-receipt.mjs',
  'control-plane/ops/release/generate-schema-diff-receipt.mjs',
  'control-plane/ops/release/run-booking-preprod-control-plane-installer',
];
const EXECUTABLE_FILES = new Set([
  'run-booking-preprod-control-plane',
  'switch-preprod-ingress',
  'control-plane/ops/release/run-booking-preprod-control-plane',
  'control-plane/ops/release/run-booking-preprod-control-plane-installer',
  'control-plane/ops/release/switch-preprod-ingress',
]);
const PHASES = new Set(['PREPARED', 'OLD_RETIRED', 'ACTIVE_MOVED', 'NEW_ACTIVE', 'RECEIPT_PUBLISHED', 'COMPLETE']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MIGRATION_ID = /^booking-legacy-active-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$/;

class InstallError extends Error {}
export class SimulatedInstallCrash extends Error {}

const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const canonicalJson = (value) => Array.isArray(value) ? `[${value.map(canonicalJson).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
    : JSON.stringify(value);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index]; const value = argv[index + 1];
    if (!option?.startsWith('--') || !value || value.startsWith('--')) throw new InstallError('invalid option surface');
    const key = option.slice(2);
    if (Object.hasOwn(args, key)) throw new InstallError(`duplicate option: ${key}`);
    args[key] = value;
  }
  const identity = ['action', 'install-id', 'git-sha', 'approval-id'];
  const allowed = ['inventory', 'bundle-inventory', 'active-inventory'].includes(args.action) ? new Set(identity)
    : args.action === 'approval-check' ? new Set([...identity, 'approval-tuple-digest', 'approver-receipt-digest', 'migration-id', 'migration-action', 'transaction-id', 'predecessor-receipt-digest', 'expected-normalized-inventory-digest'])
    : args.action === 'install' ? new Set([...identity, 'source-archive-digest', 'installer-digest', 'bundle-declaration-digest',
      'tracked-allowlist-digest', 'expected-inventory-digest', 'approval-tuple-digest', 'approver-receipt-digest'])
      : args.action === 'readback' ? new Set(['action', 'install-id', 'expected-receipt-digest'])
        : args.action === 'rollback' ? new Set([...identity, 'rollback-id', 'expected-active-inventory-digest', 'expected-rollback-inventory-digest'])
          : args.action === 'recover' ? new Set([...identity, 'transaction-id']) : null;
  if (!allowed) throw new InstallError('unsupported action');
  for (const key of Object.keys(args)) if (!allowed.has(key)) throw new InstallError(`unsupported option: ${key}`);
  return args;
}

function requireFields(value, fields, label = 'request') {
  for (const field of fields) if (!value?.[field]) throw new InstallError(`${label} is missing ${field}`);
}
function requireExactKeys(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...fields].sort())) {
    throw new InstallError(`${label} fields are invalid`);
  }
}
function validateIdentity(value, includeInstall = true) {
  requireFields(value, includeInstall ? ['install-id', 'git-sha', 'approval-id'] : ['git-sha', 'approval-id']);
  const match = INSTALL_ID.exec(value['install-id'] || '');
  if (includeInstall && (!match || match[1] !== value['git-sha'].slice(0, 12))) throw new InstallError('install ID is not bound to the full Git SHA');
  if (!GIT_SHA.test(value['git-sha']) || !IDENTIFIER.test(value['approval-id'])) throw new InstallError('Git SHA or approval ID is invalid');
}
function validateDigest(value, label) { if (!DIGEST.test(value || '')) throw new InstallError(`${label} must be SHA-256`); }
const exists = async (path) => { try { await lstat(path); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } };
const rel = (root, path) => relative(root, path).split(sep).join('/');
const unsafeRel = (path) => !path || !SAFE_PATH.test(path) || path.startsWith('/') || path.split('/').some((part) => part === '..' || part === 'node_modules');

function tarString(block, start, length) {
  const end = block.indexOf(0, start); return block.subarray(start, end >= start && end < start + length ? end : start + length).toString('utf8');
}
function tarOctal(block, start, length, label) {
  const text = block.subarray(start, start + length).toString('ascii').replace(/\0.*$/s, '').trim();
  if (!/^[0-7]+$/.test(text)) throw new InstallError(`source archive ${label} is invalid`);
  const value = Number.parseInt(text, 8); if (!Number.isSafeInteger(value) || value < 0) throw new InstallError(`source archive ${label} is invalid`); return value;
}
function parsePax(content) {
  const values = {}; let offset = 0;
  while (offset < content.length) {
    const space = content.indexOf(0x20, offset); if (space < 0) throw new InstallError('source archive PAX record is invalid');
    const lengthText = content.subarray(offset, space).toString('ascii'); if (!/^[1-9][0-9]*$/.test(lengthText)) throw new InstallError('source archive PAX length is invalid');
    const length = Number(lengthText); const end = offset + length;
    if (!Number.isSafeInteger(length) || end > content.length || content[end - 1] !== 0x0a) throw new InstallError('source archive PAX record is truncated');
    const record = content.subarray(space + 1, end - 1).toString('utf8'); const equals = record.indexOf('=');
    if (equals <= 0 || Object.hasOwn(values, record.slice(0, equals))) throw new InstallError('source archive PAX field is invalid');
    values[record.slice(0, equals)] = record.slice(equals + 1); offset = end;
  }
  return values;
}
function inspectSourceArchive(bytes, gitSha) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1024 || bytes.length % 512 !== 0) throw new InstallError('source archive framing is invalid');
  const entries = []; const seen = new Set(); let archiveGitSha = null; let ended = false;
  for (let offset = 0; offset < bytes.length; ) {
    const header = bytes.subarray(offset, offset + 512); offset += 512;
    if (header.every((value) => value === 0)) {
      if (offset + 512 > bytes.length || !bytes.subarray(offset, offset + 512).every((value) => value === 0) || !bytes.subarray(offset).every((value) => value === 0)) throw new InstallError('source archive trailer is invalid');
      ended = true; break;
    }
    const expectedChecksum = tarOctal(header, 148, 8, 'checksum'); let actualChecksum = 0;
    for (let index = 0; index < 512; index += 1) actualChecksum += index >= 148 && index < 156 ? 0x20 : header[index];
    if (actualChecksum !== expectedChecksum) throw new InstallError('source archive checksum mismatch');
    const prefix = tarString(header, 345, 155); const leaf = tarString(header, 0, 100); const archivePath = prefix ? `${prefix}/${leaf}` : leaf;
    const mode = tarOctal(header, 100, 8, 'mode'); const size = tarOctal(header, 124, 12, 'size'); const type = String.fromCharCode(header[156] || 0x30);
    const padded = Math.ceil(size / 512) * 512; if (offset + padded > bytes.length) throw new InstallError('source archive entry is truncated');
    const content = bytes.subarray(offset, offset + size); offset += padded;
    if (type === 'g') {
      const pax = parsePax(content); requireExactKeys(pax, ['comment'], 'source archive global PAX');
      if (archiveGitSha !== null || !GIT_SHA.test(pax.comment || '')) throw new InstallError('source archive Git comment is invalid'); archiveGitSha = pax.comment; continue;
    }
    if (type !== '0' && type !== '5') throw new InstallError(`source archive entry type is forbidden: ${type}`);
    const normalized = archivePath.endsWith('/') ? archivePath.slice(0, -1) : archivePath;
    if (normalized === 'source' && type === '5') continue;
    if (!normalized.startsWith('source/')) throw new InstallError('source archive entry is outside source root');
    const name = normalized.slice('source/'.length); if (unsafeRel(name) || seen.has(name)) throw new InstallError('source archive path is invalid or duplicated'); seen.add(name);
    if (type === '5') {
      if (size !== 0) throw new InstallError('source archive directory has content'); entries.push({ path: name, type: 'directory', mode: '0555' });
    } else entries.push({ path: name, type: 'file', mode: (mode & 0o111) ? '0555' : '0444', size, digest: sha256(content) });
  }
  if (!ended || archiveGitSha !== gitSha) throw new InstallError('source archive is not bound to the declared Git SHA');
  entries.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
  return { entries, digest: sha256(canonicalJson(entries)) };
}
export const inspectControlPlaneSourceArchive = (bytes, gitSha) => inspectSourceArchive(bytes, gitSha);

async function syncDirectory(path, runtime) {
  if (runtime.syncDirectory) return runtime.syncDirectory(path);
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function syncFile(path, runtime) {
  if (runtime.syncFile) return runtime.syncFile(path);
  const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); }
}
async function checkpoint(runtime, name) {
  runtime.checkpointCounts ||= new Map(); const occurrence = (runtime.checkpointCounts.get(name) || 0) + 1; runtime.checkpointCounts.set(name, occurrence);
  if (runtime.crashAt === name && (runtime.crashAtOccurrence === undefined || runtime.crashAtOccurrence === occurrence)) throw new SimulatedInstallCrash(`${name}#${occurrence}`);
  if (runtime.checkpoint) await runtime.checkpoint(name);
}

async function assertDirectory(path, uid, label, enforceMode = true) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new InstallError(`${label} must be a real directory`);
  if (uid !== null && (info.uid !== uid || info.gid !== 0)) throw new InstallError(`${label} must be root:root`);
  if (enforceMode && ((info.mode & 0o022) || (info.mode & 0o7000))) throw new InstallError(`${label} has writable or special mode bits`);
  if (await realpath(path) !== resolve(path)) throw new InstallError(`${label} resolves through a symlink`);
  return info;
}

async function inventory(root, { uid, source = false, strict = false, enforceMode = true } = {}) {
  const rootInfo = await assertDirectory(root, uid, 'inventory root', enforceMode);
  const rootMode = source || !enforceMode ? '0555' : `0${(rootInfo.mode & 0o777).toString(8)}`;
  if (strict && enforceMode && rootMode !== '0555') throw new InstallError('inventory root mode drift');
  const entries = [];
  async function walk(directory) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)));
    for (const child of children) {
      const path = join(directory, child.name); const name = rel(root, path);
      if (unsafeRel(name)) throw new InstallError(`forbidden inventory path: ${name}`);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new InstallError(`symbolic link rejected: ${name}`);
      if (uid !== null && (info.uid !== uid || info.gid !== 0)) throw new InstallError(`non-root:root entry: ${name}`);
      if (enforceMode && ((info.mode & 0o022) || (info.mode & 0o7000))) throw new InstallError(`writable or special-mode entry: ${name}`);
      if (info.isDirectory()) {
        const mode = source || !enforceMode ? '0555' : `0${(info.mode & 0o777).toString(8)}`;
        if (strict && enforceMode && mode !== '0555') throw new InstallError(`directory mode drift: ${name}`);
        entries.push({ path: name, type: 'directory', mode }); await walk(path);
      } else if (info.isFile()) {
        if (info.nlink !== 1) throw new InstallError(`hard-linked file rejected: ${name}`);
        const executable = (info.mode & 0o111) !== 0;
        const mode = source || !enforceMode ? (executable ? '0555' : '0444') : `0${(info.mode & 0o777).toString(8)}`;
        if (strict && enforceMode && mode !== (executable ? '0555' : '0444')) throw new InstallError(`file mode drift: ${name}`);
        entries.push({ path: name, type: 'file', mode, size: info.size, digest: sha256(await readFile(path)) });
      } else throw new InstallError(`non-regular entry rejected: ${name}`);
    }
  }
  await walk(root);
  return { rootMode, entries, digest: sha256(canonicalJson({ rootMode, entries })) };
}
export const inspectControlPlaneInventory = (root, options = {}) => inventory(root, options);

async function readDeclaration(paths, args, settings) {
  const bundle = join(paths.bundleRoot, args['install-id']); const payload = join(bundle, 'payload');
  await assertDirectory(paths.bundleRoot, settings.uid, 'bundle root', settings.enforceMode);
  await assertDirectory(bundle, settings.uid, 'bundle', settings.enforceMode);
  if (canonicalJson((await readdir(bundle)).sort()) !== canonicalJson(['bundle-declaration.json', 'installer.mjs', 'payload', 'source-archive.tar'].sort())) throw new InstallError('bundle root layout is invalid');
  await assertDirectory(payload, settings.uid, 'payload', settings.enforceMode);
  const roots = (await readdir(payload)).sort();
  if (canonicalJson(roots) !== canonicalJson([...ROOT_ENTRIES].sort())) throw new InstallError('payload root layout is invalid');
  const found = await inventory(payload, { uid: settings.uid, strict: true, enforceMode: settings.enforceMode });
  const declarationPath = join(bundle, 'bundle-declaration.json');
  const declarationInfo = await lstat(declarationPath);
  if (!declarationInfo.isFile() || declarationInfo.isSymbolicLink() || declarationInfo.nlink !== 1 || (settings.uid !== null && (declarationInfo.uid !== settings.uid || declarationInfo.gid !== 0)) ||
      (settings.enforceMode && ((declarationInfo.mode & 0o022) || (declarationInfo.mode & 0o7000)))) throw new InstallError('bundle declaration is not immutable root:root');
  const declaration = JSON.parse(await readFile(declarationPath, 'utf8'));
  const declarationKeys = ['approvalId', 'archiveCommand', 'archiveCommandDigest', 'gitSha', 'installId', 'installerDigest', 'inventoryDigest', 'payloadMap', 'payloadMapDigest', 'schema', 'sourceArchiveDigest', 'trackedAllowlistDigest', 'trackedFiles'];
  if (canonicalJson(Object.keys(declaration).sort()) !== canonicalJson(declarationKeys.sort())) throw new InstallError('bundle declaration has an unexpected field');
  requireFields(declaration, ['schema', 'installId', 'gitSha', 'approvalId', 'sourceArchiveDigest', 'installerDigest', 'inventoryDigest', 'trackedAllowlistDigest', 'trackedFiles', 'payloadMap', 'payloadMapDigest', 'archiveCommand', 'archiveCommandDigest'], 'bundle declaration');
  if (declaration.schema !== 'booking.preprod-control-plane-bundle/v1' || declaration.installId !== args['install-id'] ||
      declaration.gitSha !== args['git-sha'] || declaration.approvalId !== args['approval-id'] || declaration.inventoryDigest !== found.digest) throw new InstallError('bundle declaration identity mismatch');
  for (const field of ['sourceArchiveDigest', 'installerDigest', 'inventoryDigest', 'trackedAllowlistDigest', 'payloadMapDigest', 'archiveCommandDigest']) validateDigest(declaration[field], `bundle declaration ${field}`);
  const filePaths = found.entries.filter((entry) => entry.type === 'file').map((entry) => entry.path).sort();
  if (canonicalJson(declaration.trackedFiles) !== canonicalJson(filePaths) || declaration.trackedAllowlistDigest !== sha256(canonicalJson(filePaths))) throw new InstallError('tracked allowlist does not equal payload files');
  if (!Array.isArray(declaration.payloadMap) || declaration.payloadMap.length !== filePaths.length) throw new InstallError('payload source mapping is incomplete');
  const mappedPayloads = []; const sourcePaths = [];
  for (const mapping of declaration.payloadMap) {
    requireExactKeys(mapping, ['payloadPath', 'sourcePath'], 'payload source mapping');
    if (unsafeRel(mapping.payloadPath) || unsafeRel(mapping.sourcePath)) throw new InstallError('payload source mapping path is unsafe');
    mappedPayloads.push(mapping.payloadPath); sourcePaths.push(mapping.sourcePath);
  }
  if (canonicalJson(mappedPayloads) !== canonicalJson([...filePaths].sort()) || new Set(mappedPayloads).size !== mappedPayloads.length || declaration.payloadMapDigest !== sha256(canonicalJson(declaration.payloadMap))) throw new InstallError('payload source mapping does not equal payload files');
  const uniqueSourcePaths = [...new Set(sourcePaths)].sort();
  const expectedArchiveCommand = ['git', 'archive', '--format=tar', '--prefix=source/', declaration.gitSha, '--', ...uniqueSourcePaths];
  if (canonicalJson(declaration.archiveCommand) !== canonicalJson(expectedArchiveCommand) || declaration.archiveCommandDigest !== sha256(canonicalJson(expectedArchiveCommand))) throw new InstallError('Git archive command is not the exact committed-source command');
  for (const required of REQUIRED_FILES) if (!filePaths.includes(required)) throw new InstallError(`required file missing: ${required}`);
  for (const executable of EXECUTABLE_FILES) {
    const entry = found.entries.find((item) => item.path === executable);
    if (settings.enforceMode && entry?.mode !== '0555') throw new InstallError(`entrypoint is not executable: ${executable}`);
  }
  const bundleInstallerPath = join(bundle, 'installer.mjs'); const archivePath = join(bundle, 'source-archive.tar');
  for (const [path, label, executable] of [[bundleInstallerPath, 'bundle installer', true], [archivePath, 'source archive', false]]) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (settings.uid !== null && (info.uid !== settings.uid || info.gid !== 0)) ||
        (settings.enforceMode && ((info.mode & 0o022) || (info.mode & 0o7000) || (executable ? (info.mode & 0o111) === 0 : (info.mode & 0o111) !== 0)))) throw new InstallError(`${label} mode or ownership is invalid`);
  }
  const runningInstallerDigest = sha256(await readFile(fileURLToPath(import.meta.url)));
  if (declaration.installerDigest !== runningInstallerDigest || sha256(await readFile(bundleInstallerPath)) !== runningInstallerDigest) throw new InstallError('installer digest is not the reviewed running installer');
  const archiveBytes = await readFile(archivePath);
  if (declaration.sourceArchiveDigest !== sha256(archiveBytes)) throw new InstallError('source archive digest does not match bundle archive');
  const archiveInventory = inspectSourceArchive(archiveBytes, declaration.gitSha);
  const archiveFiles = archiveInventory.entries.filter((entry) => entry.type === 'file');
  if (canonicalJson(archiveFiles.map((entry) => entry.path).sort()) !== canonicalJson(uniqueSourcePaths)) throw new InstallError('source archive file set does not equal declared Git sources');
  for (const mapping of declaration.payloadMap) {
    const sourceEntry = archiveFiles.find((entry) => entry.path === mapping.sourcePath); const payloadEntry = found.entries.find((entry) => entry.path === mapping.payloadPath);
    if (!sourceEntry || !payloadEntry || sourceEntry.digest !== payloadEntry.digest || sourceEntry.size !== payloadEntry.size || sourceEntry.mode !== payloadEntry.mode) throw new InstallError('source archive mapping does not reproduce payload bytes and mode');
  }
  await verifyImportClosure(payload, filePaths);
  return { bundle, payload, declarationPath, declaration, declarationDigest: sha256(canonicalJson(declaration)), inventory: found };
}

async function verifyImportClosure(payload, files) {
  const fileSet = new Set(files);
  for (const name of files.filter((value) => value.endsWith('.mjs'))) {
    const source = await readFile(join(payload, ...name.split('/')), 'utf8');
    const imports = [...source.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)].map((match) => match[1]);
    for (const specifier of imports) {
      const resolved = posix.normalize(posix.join(posix.dirname(name), specifier));
      if (resolved.startsWith('../') || !fileSet.has(resolved)) throw new InstallError(`local import is outside tracked closure: ${name} -> ${specifier}`);
    }
  }
}

async function copyTree(source, target, settings, runtime) {
  await mkdir(target, { mode: 0o700 }); if (settings.uid !== null) await chown(target, settings.uid, 0);
  async function walk(src, dst) {
    const children = await readdir(src, { withFileTypes: true });
    children.sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)));
    for (const child of children) {
      const from = join(src, child.name); const to = join(dst, child.name); const info = await lstat(from);
      if (info.isSymbolicLink()) throw new InstallError('bundle changed to a symlink during copy');
      if (info.isDirectory()) {
        await mkdir(to, { mode: 0o700 }); if (settings.uid !== null) await chown(to, settings.uid, 0);
        await walk(from, to); await chmod(to, 0o555); await syncDirectory(to, runtime);
      } else if (info.isFile()) {
        await copyFile(from, to); if (settings.uid !== null) await chown(to, settings.uid, 0);
        await chmod(to, (info.mode & 0o111) ? 0o555 : 0o444); await syncFile(to, runtime);
      } else throw new InstallError('bundle changed to a special file during copy');
    }
  }
  await walk(source, target); await chmod(target, 0o555); await syncDirectory(target, runtime); await syncDirectory(dirname(target), runtime);
}

async function atomicJson(path, value, uid, runtime) {
  const temp = `${path}.${value.transactionId || randomUUID()}.tmp`; const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(`${canonicalJson(value)}\n`); await handle.sync(); } finally { await handle.close(); }
  if (uid !== null) await chown(temp, uid, 0); await chmod(temp, 0o400); await syncFile(temp, runtime);
  await checkpoint(runtime, 'journal:prepared');
  if (runtime.portableReplace && await exists(path)) await chmod(path, 0o600);
  await rename(temp, path); await syncDirectory(dirname(path), runtime); await checkpoint(runtime, 'journal:linked');
}
async function publishReceipt(path, body, uid, runtime) {
  const receipt = { ...body, receiptDigest: sha256(canonicalJson(body)) };
  const temp = `${path}.${body.transactionId}.tmp`; const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(`${canonicalJson(receipt)}\n`); await handle.sync(); } finally { await handle.close(); }
  if (uid !== null) await chown(temp, uid, 0); await chmod(temp, 0o400); await syncFile(temp, runtime);
  await checkpoint(runtime, 'receipt:prepared');
  try { await link(temp, path); } catch (error) { if (error?.code === 'EEXIST') throw new InstallError('immutable receipt already exists'); throw error; }
  await syncDirectory(dirname(path), runtime); await checkpoint(runtime, 'receipt:linked');
  await unlink(temp); await syncDirectory(dirname(path), runtime); return receipt;
}
async function durableRename(from, to, runtime, point) {
  await rename(from, to); await syncDirectory(dirname(from), runtime);
  if (dirname(to) !== dirname(from)) await syncDirectory(dirname(to), runtime);
  await checkpoint(runtime, point);
}

async function assertQuiescent(paths, runtime, now) {
  if (runtime.assertQuiescent) return runtime.assertQuiescent();
  if (await exists(paths.runtimeLockPath)) throw new InstallError('control-plane runtime lock exists');
  if (await exists(`${paths.deployStatePath}.lock`)) throw new InstallError('deployment state lock exists');
  const resourceRoot = join(dirname(paths.deployStatePath), 'executor', 'resources');
  async function scan(directory) {
    if (!await exists(directory)) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new InstallError('resource state tree contains a symbolic link');
      if (entry.isDirectory()) await scan(path); else if (entry.name === 'resource-state.lock') throw new InstallError('resource lock exists');
    }
  }
  await scan(resourceRoot);
  if (await exists(paths.deployStatePath)) {
    const state = JSON.parse(await readFile(paths.deployStatePath, 'utf8'));
    if (state.lease) {
      const expiresAt = Date.parse(state.lease.expiresAt); const observedAt = Date.parse(now);
      if (!Number.isFinite(expiresAt) || !Number.isFinite(observedAt) || expiresAt > observedAt) throw new InstallError('deployment lease is active or invalid');
    }
  }
  const result = spawnSync(DOCKER, ['ps', '--filter', 'name=^/booking-preprod-control-plane$', '--format', '{{.ID}}'], { encoding: 'utf8' });
  if (result.status !== 0 || result.stdout.trim()) throw new InstallError('control-plane container is running or cannot be proven absent');
}

async function assertNotMountpoints(paths, runtime, extraPaths = []) {
  if (runtime.assertNotMountpoints) return runtime.assertNotMountpoints(paths);
  const mounted = runtime.mountedPaths ? new Set(runtime.mountedPaths) : new Set((await readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n').map((line) => {
    const fields = line.split(' '); return fields[4]?.replace(/\\040/g, ' ').replace(/\\011/g, '\t').replace(/\\134/g, '\\');
  }));
  for (const path of [paths.installRoot, paths.rollbackRoot, ...extraPaths]) {
    if (!await exists(path)) continue;
    const root = await realpath(path);
    if ([...mounted].some((mount) => mount === root || mount.startsWith(`${root}${sep}`))) throw new InstallError(`${basename(path)} must not contain a mountpoint`);
  }
}

function defaultPaths(runtime) {
  return { installRoot: INSTALL_ROOT, rollbackRoot: ROLLBACK_ROOT, bundleRoot: BUNDLE_ROOT, receiptRoot: RECEIPT_ROOT,
    approvalRoot: APPROVAL_ROOT, approverPublicKeyPath: APPROVER_PUBLIC_KEY, approverPublicKeyAnchorPath: APPROVER_PUBLIC_KEY_ANCHOR,
    hostIdentityPath: HOST_IDENTITY_PATH, lockPath: LOCK_PATH, journalPath: JOURNAL_PATH, runtimeLockPath: RUNTIME_LOCK_PATH,
    deployStatePath: DEPLOY_STATE_PATH, ...(runtime.paths || {}) };
}
async function treeDigest(path, settings) { return await exists(path) ? (await inventory(path, { uid: settings.uid, enforceMode: settings.enforceMode })).digest : null; }
async function looseTreeDigest(path, settings) { return await exists(path) ? (await inventory(path, { uid: settings.uid, source: true, enforceMode: false })).digest : null; }
function assertKnown(actual, allowed, label) { if (!allowed.includes(actual)) throw new InstallError(`${label} is in an unknown crash state`); }

async function readImmutableJson(path, settings, label) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (settings.uid !== null && (info.uid !== settings.uid || info.gid !== 0)) ||
      (settings.enforceMode && (info.mode & 0o377) !== 0)) throw new InstallError(`${label} is not immutable root:root`);
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readHostIdentityDigest(paths, settings) {
  const info = await lstat(paths.hostIdentityPath);
  if (!info.isFile() || info.isSymbolicLink() || (settings.uid !== null && (info.uid !== settings.uid || info.gid !== 0)) ||
      (settings.enforceMode && (info.mode & 0o022)) || await realpath(paths.hostIdentityPath) !== resolve(paths.hostIdentityPath)) {
    throw new InstallError('host identity must be a fixed root-owned non-writable regular file');
  }
  const bytes = await readFile(paths.hostIdentityPath);
  if (bytes.length < 16 || bytes.length > 256) throw new InstallError('host identity is empty or unbounded');
  return sha256(bytes);
}

async function verifyIndependentApproval(paths, args, declaration, declarationDigest, settings, runtime, migrationRequest = null) {
  validateDigest(args['approval-tuple-digest'], 'approval tuple'); validateDigest(args['approver-receipt-digest'], 'approver receipt');
  const directory = join(paths.approvalRoot, args['install-id']); await assertDirectory(directory, settings.uid, 'approval directory', settings.enforceMode);
  const tuplePath = join(directory, 'approval-tuple.json'); const receiptPath = join(directory, 'approver-receipt.json'); const signaturePath = join(directory, 'approver-receipt.sig');
  const tuple = await readImmutableJson(tuplePath, settings, 'approval tuple');
  const tupleFields = ['schema', 'status', 'installId', 'gitSha', 'approvalId', 'archiveCommand', 'archiveCommandDigest', 'sourceArchiveDigest', 'payloadMapDigest',
    'inventoryDigest', 'installerDigest', 'bootstrapInstallerLauncherDigest', 'declarationDigest', 'tupleDigest'];
  requireExactKeys(tuple, tupleFields, 'approval tuple'); const { tupleDigest, ...tupleBody } = tuple;
  if (tupleDigest !== sha256(canonicalJson(tupleBody)) || tupleDigest !== args['approval-tuple-digest'] || tuple.schema !== 'booking.preprod-control-plane-approval-tuple/v1' ||
      tuple.status !== 'awaiting-independent-approval' || tuple.installId !== args['install-id'] || tuple.gitSha !== args['git-sha'] || tuple.approvalId !== args['approval-id'] ||
      tuple.archiveCommandDigest !== declaration.archiveCommandDigest || canonicalJson(tuple.archiveCommand) !== canonicalJson(declaration.archiveCommand) ||
      tuple.sourceArchiveDigest !== declaration.sourceArchiveDigest || tuple.payloadMapDigest !== declaration.payloadMapDigest || tuple.inventoryDigest !== declaration.inventoryDigest ||
      tuple.installerDigest !== declaration.installerDigest || tuple.declarationDigest !== declarationDigest) throw new InstallError('approval tuple is not bound to the bundle');
  for (const field of ['archiveCommandDigest', 'sourceArchiveDigest', 'payloadMapDigest', 'inventoryDigest', 'installerDigest', 'bootstrapInstallerLauncherDigest', 'declarationDigest', 'tupleDigest']) validateDigest(tuple[field], `approval tuple ${field}`);
  const bundledLauncher = join(paths.bundleRoot, args['install-id'], 'payload', 'control-plane', 'ops', 'release', 'run-booking-preprod-control-plane-installer');
  if (sha256(await readFile(bundledLauncher)) !== tuple.bootstrapInstallerLauncherDigest) throw new InstallError('approval tuple bootstrap launcher digest differs from bundle');

  const receipt = await readImmutableJson(receiptPath, settings, 'approver receipt');
  const receiptFields = ['schema', 'status', 'environment', 'project', 'installId', 'gitSha', 'approvalId', 'tupleDigest', 'approverIdentity', 'publicKeyDigest',
    'hostIdentityDigest', 'expectedActiveInventoryDigest', 'activeInventoryObservedAt', 'approvedAt', ...(migrationRequest ? ['migrationContext'] : []), 'receiptDigest'];
  requireExactKeys(receipt, receiptFields, 'approver receipt'); const { receiptDigest, ...receiptBody } = receipt;
  const expectedSchema = migrationRequest ? 'booking.preprod.control-plane-approval-receipt/v3' : 'booking.preprod.control-plane-approval-receipt/v2';
  const observedAt = Date.parse(receipt.activeInventoryObservedAt); const approvedAt = Date.parse(receipt.approvedAt); const checkedAt = Date.parse(runtime.now || new Date().toISOString());
  if (receiptDigest !== sha256(canonicalJson(receiptBody)) || receiptDigest !== args['approver-receipt-digest'] || receipt.schema !== expectedSchema ||
      receipt.status !== 'approved' || receipt.environment !== 'preprod' || receipt.project !== 'booking-preprod' || receipt.installId !== args['install-id'] || receipt.gitSha !== args['git-sha'] ||
      receipt.approvalId !== args['approval-id'] || receipt.tupleDigest !== tupleDigest || !IDENTIFIER.test(receipt.approverIdentity || '') ||
      !Number.isFinite(observedAt) || !Number.isFinite(approvedAt) || !Number.isFinite(checkedAt) || approvedAt < observedAt || approvedAt > checkedAt) throw new InstallError('approver receipt is not bound to the approval tuple or verification time');
  if (migrationRequest) {
    const context = receipt.migrationContext;
    requireExactKeys(context, ['migrationId', 'allowedActions', 'transactionId', 'predecessorReceiptDigest', 'expectedNormalizedInventoryDigest'], 'migration approval context');
    if (!Array.isArray(context.allowedActions) || context.allowedActions.length < 1 || new Set(context.allowedActions).size !== context.allowedActions.length ||
        context.allowedActions.some((action) => !['migrate', 'recover', 'rollback'].includes(action)) || !context.allowedActions.includes(migrationRequest.action) ||
        context.migrationId !== migrationRequest.migrationId || context.transactionId !== migrationRequest.transactionId ||
        context.predecessorReceiptDigest !== migrationRequest.predecessorReceiptDigest || context.expectedNormalizedInventoryDigest !== migrationRequest.expectedNormalizedInventoryDigest) {
      throw new InstallError('migration approval context does not authorize this exact action and transaction');
    }
    if (migrationRequest.action === 'rollback' || (migrationRequest.action === 'recover' && context.predecessorReceiptDigest !== null)) {
      validateDigest(context.predecessorReceiptDigest, 'migration predecessor receipt'); validateDigest(context.expectedNormalizedInventoryDigest, 'approved normalized inventory');
    } else if (context.predecessorReceiptDigest !== null || context.expectedNormalizedInventoryDigest !== null) throw new InstallError('migration approval context has unexpected predecessor bindings');
  }
  for (const [value, label] of [[receipt.publicKeyDigest, 'approver public key'], [receipt.hostIdentityDigest, 'host identity'],
    [receipt.expectedActiveInventoryDigest, 'expected active inventory'], [receipt.receiptDigest, 'approver receipt']]) validateDigest(value, label);
  if (receipt.hostIdentityDigest !== await readHostIdentityDigest(paths, settings)) throw new InstallError('approved host identity differs from this host');
  const signatureInfo = await lstat(signaturePath); if (!signatureInfo.isFile() || signatureInfo.isSymbolicLink() || (settings.uid !== null && (signatureInfo.uid !== settings.uid || signatureInfo.gid !== 0)) || (settings.enforceMode && (signatureInfo.mode & 0o377) !== 0)) throw new InstallError('approver signature is not immutable root:root');
  if (runtime.verifyApprovalSignature) await runtime.verifyApprovalSignature({ receiptPath, signaturePath, receipt, tuple });
  else {
    const publicKeyInfo = await lstat(paths.approverPublicKeyPath); const anchorInfo = await lstat(paths.approverPublicKeyAnchorPath); const cosignInfo = await lstat(COSIGN);
    if (![publicKeyInfo, anchorInfo].every((info) => info.isFile() && !info.isSymbolicLink() && info.uid === 0 && info.gid === 0 && !(info.mode & 0o022)) || !cosignInfo.isFile() || cosignInfo.isSymbolicLink() || cosignInfo.uid !== 0 || cosignInfo.gid !== 0 || (cosignInfo.mode & 0o022) || !(cosignInfo.mode & 0o111)) throw new InstallError('approval trust root or Cosign executable is unsafe');
    if (!COSIGN_BINARY_DIGESTS[process.arch] || sha256(await readFile(COSIGN)) !== COSIGN_BINARY_DIGESTS[process.arch]) throw new InstallError('Cosign approver verifier binary is not pinned');
    const anchored = (await readFile(paths.approverPublicKeyAnchorPath, 'utf8')).trim(); if (anchored !== receipt.publicKeyDigest || sha256(await readFile(paths.approverPublicKeyPath)) !== anchored) throw new InstallError('approver public key differs from independent anchor');
    const env = {}; for (const [key, value] of Object.entries(process.env)) if (!key.toUpperCase().startsWith('COSIGN_') && value !== undefined) env[key] = value;
    const verified = spawnSync(COSIGN, ['verify-blob', '--key', paths.approverPublicKeyPath, '--signature', signaturePath, '--insecure-ignore-tlog', receiptPath], { encoding: 'utf8', env: { ...env, COSIGN_YES: 'true' } });
    if (verified.status !== 0) throw new InstallError('independent approver signature verification failed');
  }
  return { approvalTupleDigest: tupleDigest, approverReceiptDigest: receiptDigest, approverIdentity: receipt.approverIdentity,
    approverPublicKeyDigest: receipt.publicKeyDigest, expectedActiveInventoryDigest: receipt.expectedActiveInventoryDigest,
    ...(migrationRequest ? { migrationContext: receipt.migrationContext } : {}) };
}

function validateJournal(journal, args) {
  const common = ['schema', 'action', 'transactionId', 'installId', 'gitSha', 'approvalId', 'phase', 'oldActiveDigest', 'oldRollbackDigest', 'receiptDigest', 'updatedAt'];
  const installFields = [...common, 'stageName', 'retiredName', 'newDigest', 'sourceArchiveDigest', 'installerDigest', 'bundleDeclarationDigest', 'trackedAllowlistDigest', 'payloadMapDigest', 'archiveCommandDigest',
    'approvalTupleDigest', 'approverReceiptDigest', 'approverIdentity', 'approverPublicKeyDigest', 'expectedActiveInventoryDigest'];
  const rollbackFields = [...common, 'rollbackId', 'swapName', 'targetInstallReceiptDigest'];
  if (journal?.action === 'install') requireExactKeys(journal, installFields, 'install journal');
  else if (journal?.action === 'rollback') requireExactKeys(journal, rollbackFields, 'rollback journal');
  else throw new InstallError('journal action is invalid');
  if (journal.schema !== 'booking.preprod-control-plane-transaction/v2' || !UUID.test(journal.transactionId || '') ||
      journal.transactionId !== args['transaction-id'] || journal.installId !== args['install-id'] || journal.gitSha !== args['git-sha'] ||
      journal.approvalId !== args['approval-id'] || !PHASES.has(journal.phase) || !Number.isFinite(Date.parse(journal.updatedAt))) {
    throw new InstallError('recovery identity does not match journal');
  }
  for (const [value, label] of [[journal.oldActiveDigest, 'journal old active'], [journal.receiptDigest, 'journal receipt']]) {
    if (value !== null) validateDigest(value, label);
  }
  if (journal.oldRollbackDigest !== null) validateDigest(journal.oldRollbackDigest, 'journal old rollback');
  if (journal.action === 'install') {
    for (const [value, label] of [[journal.newDigest, 'journal new'], [journal.sourceArchiveDigest, 'journal source archive'],
      [journal.installerDigest, 'journal installer'], [journal.bundleDeclarationDigest, 'journal bundle declaration'],
      [journal.trackedAllowlistDigest, 'journal tracked allowlist'], [journal.payloadMapDigest, 'journal payload map'],
      [journal.archiveCommandDigest, 'journal archive command'], [journal.approvalTupleDigest, 'journal approval tuple'],
      [journal.approverReceiptDigest, 'journal approver receipt'], [journal.approverPublicKeyDigest, 'journal approver key'],
      [journal.expectedActiveInventoryDigest, 'journal independently approved active inventory']]) validateDigest(value, label);
    if (!IDENTIFIER.test(journal.approverIdentity || '')) throw new InstallError('journal approver identity is invalid');
    if (journal.newDigest === journal.oldActiveDigest) throw new InstallError('install journal describes a forbidden no-op digest');
    if (journal.stageName !== `.happybooking-control-plane-stage-${journal.installId}` ||
        journal.retiredName !== (journal.oldRollbackDigest ? `.happybooking-control-plane-retired-${journal.transactionId}` : null)) throw new InstallError('install journal path identity is invalid');
  } else {
    validateDigest(journal.targetInstallReceiptDigest, 'journal target install receipt');
    if (!INSTALL_ID.test(journal.rollbackId || '') || journal.rollbackId !== journal.installId || journal.swapName !== `.happybooking-control-plane-retired-${journal.transactionId}`) throw new InstallError('rollback journal path identity is invalid');
  }
}

function validateInstallReceipt(receipt, journal = null) {
  const fields = ['schema', 'status', 'action', 'environment', 'project', 'transactionId', 'installId', 'gitSha', 'approvalId',
    'sourceArchiveDigest', 'installerDigest', 'bundleDeclarationDigest', 'trackedAllowlistDigest', 'payloadMapDigest', 'archiveCommandDigest', 'approvalTupleDigest',
    'approverReceiptDigest', 'approverIdentity', 'approverPublicKeyDigest', 'expectedActiveInventoryDigest', 'inventoryDigest',
    'oldActiveInventoryDigest', 'rollbackInventoryDigest', 'installedAt', 'receiptDigest'];
  requireExactKeys(receipt, fields, 'install receipt');
  const { receiptDigest, ...body } = receipt;
  if (receiptDigest !== sha256(canonicalJson(body)) || receipt.schema !== 'booking.preprod-control-plane-install-receipt/v3' || receipt.status !== 'pass' ||
      receipt.action !== 'install' || receipt.environment !== 'preprod' || receipt.project !== 'booking-preprod' || !INSTALL_ID.test(receipt.installId || '') ||
      !GIT_SHA.test(receipt.gitSha || '') || !IDENTIFIER.test(receipt.approvalId || '') || !UUID.test(receipt.transactionId || '') ||
      !Number.isFinite(Date.parse(receipt.installedAt)) || receipt.rollbackInventoryDigest !== receipt.oldActiveInventoryDigest ||
      receipt.expectedActiveInventoryDigest !== receipt.oldActiveInventoryDigest) throw new InstallError('published install receipt is invalid');
  if (INSTALL_ID.exec(receipt.installId)[1] !== receipt.gitSha.slice(0, 12)) throw new InstallError('install receipt Git binding is invalid');
  for (const field of ['sourceArchiveDigest', 'installerDigest', 'bundleDeclarationDigest', 'trackedAllowlistDigest', 'payloadMapDigest', 'archiveCommandDigest', 'approvalTupleDigest', 'approverReceiptDigest', 'approverPublicKeyDigest', 'expectedActiveInventoryDigest', 'inventoryDigest', 'oldActiveInventoryDigest', 'rollbackInventoryDigest', 'receiptDigest']) validateDigest(receipt[field], `install receipt ${field}`);
  if (!IDENTIFIER.test(receipt.approverIdentity || '')) throw new InstallError('install receipt approver identity is invalid');
  if (journal && (receipt.transactionId !== journal.transactionId || receipt.installId !== journal.installId || receipt.gitSha !== journal.gitSha ||
      receipt.approvalId !== journal.approvalId || receipt.sourceArchiveDigest !== journal.sourceArchiveDigest || receipt.installerDigest !== journal.installerDigest ||
      receipt.bundleDeclarationDigest !== journal.bundleDeclarationDigest || receipt.trackedAllowlistDigest !== journal.trackedAllowlistDigest ||
      receipt.payloadMapDigest !== journal.payloadMapDigest || receipt.archiveCommandDigest !== journal.archiveCommandDigest ||
      receipt.approvalTupleDigest !== journal.approvalTupleDigest || receipt.approverReceiptDigest !== journal.approverReceiptDigest ||
      receipt.approverIdentity !== journal.approverIdentity || receipt.approverPublicKeyDigest !== journal.approverPublicKeyDigest ||
      receipt.expectedActiveInventoryDigest !== journal.expectedActiveInventoryDigest || receipt.expectedActiveInventoryDigest !== receipt.oldActiveInventoryDigest ||
      receipt.inventoryDigest !== journal.newDigest || receipt.oldActiveInventoryDigest !== journal.oldActiveDigest)) throw new InstallError('published install receipt is not bound to journal');
  return receipt;
}

function validateRollbackReceipt(receipt, journal) {
  const fields = ['schema', 'status', 'action', 'environment', 'project', 'transactionId', 'installId', 'rollbackId', 'gitSha', 'approvalId', 'targetInstallReceiptDigest',
    'inventoryDigest', 'oldActiveInventoryDigest', 'rollbackInventoryDigest', 'rolledBackAt', 'receiptDigest'];
  requireExactKeys(receipt, fields, 'rollback receipt');
  const { receiptDigest, ...body } = receipt;
  if (receiptDigest !== sha256(canonicalJson(body)) || receipt.schema !== 'booking.preprod-control-plane-install-receipt/v3' || receipt.status !== 'pass' ||
      receipt.action !== 'rollback' || receipt.environment !== 'preprod' || receipt.project !== 'booking-preprod' || !INSTALL_ID.test(receipt.installId || '') ||
      !INSTALL_ID.test(receipt.rollbackId || '') || !GIT_SHA.test(receipt.gitSha || '') || !IDENTIFIER.test(receipt.approvalId || '') ||
      !UUID.test(receipt.transactionId || '') || !Number.isFinite(Date.parse(receipt.rolledBackAt)) || receipt.rollbackInventoryDigest !== receipt.oldActiveInventoryDigest) throw new InstallError('published rollback receipt is invalid');
  if (INSTALL_ID.exec(receipt.installId)[1] !== receipt.gitSha.slice(0, 12)) throw new InstallError('rollback receipt Git binding is invalid');
  for (const field of ['targetInstallReceiptDigest', 'inventoryDigest', 'oldActiveInventoryDigest', 'rollbackInventoryDigest', 'receiptDigest']) validateDigest(receipt[field], `rollback receipt ${field}`);
  if (receipt.transactionId !== journal.transactionId || receipt.installId !== journal.installId || receipt.rollbackId !== journal.rollbackId ||
      receipt.gitSha !== journal.gitSha || receipt.approvalId !== journal.approvalId || receipt.inventoryDigest !== journal.oldRollbackDigest ||
      receipt.targetInstallReceiptDigest !== journal.targetInstallReceiptDigest || receipt.oldActiveInventoryDigest !== journal.oldActiveDigest) throw new InstallError('published rollback receipt is not bound to journal');
  return receipt;
}

async function writeLockOwner(directory, identity, settings, runtime) {
  const owner = { schema: 'booking.preprod-control-plane-install-lock/v2', action: identity.action, transactionId: identity.transactionId,
    installId: identity.installId, gitSha: identity.gitSha, approvalId: identity.approvalId, pid: identity.pid,
    bootId: identity.bootId, processStartTicks: identity.processStartTicks, containerId: identity.containerId,
    containerName: identity.containerName, createdAt: identity.createdAt };
  const temp = join(directory, '.owner.json.tmp'); const path = join(directory, 'owner.json'); const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(`${canonicalJson(owner)}\n`); await handle.sync(); } finally { await handle.close(); }
  await checkpoint(runtime, 'lock:owner-written');
  if (settings.uid !== null) await chown(temp, settings.uid, 0); await chmod(temp, 0o400); await syncFile(temp, runtime); await checkpoint(runtime, 'lock:owner-prepared');
  await rename(temp, path); await syncDirectory(directory, runtime); await checkpoint(runtime, 'lock:owner-linked'); return owner;
}

const lockTempPath = (paths, transactionId) => `${paths.lockPath}.${transactionId}.tmp`;
async function publishInstallLock(paths, identity, settings, runtime) {
  const temporary = lockTempPath(paths, identity.transactionId);
  await mkdir(temporary, { mode: 0o700 }); if (settings.uid !== null) await chown(temporary, settings.uid, 0); await chmod(temporary, 0o700);
  await syncDirectory(temporary, runtime); await syncDirectory(dirname(temporary), runtime); await checkpoint(runtime, 'lock:temp-created');
  const owner = await writeLockOwner(temporary, identity, settings, runtime);
  try { await rename(temporary, paths.lockPath); } catch (error) { if (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY') throw new InstallError('installer lock already exists'); throw error; }
  await syncDirectory(dirname(paths.lockPath), runtime); await checkpoint(runtime, 'lock:published'); return owner;
}

async function readLockOwner(paths, settings, directory = paths.lockPath) {
  const owner = await readImmutableJson(join(directory, 'owner.json'), settings, 'installer lock owner');
  requireExactKeys(owner, ['schema', 'action', 'transactionId', 'installId', 'gitSha', 'approvalId', 'pid', 'bootId', 'processStartTicks', 'containerId', 'containerName', 'createdAt'], 'installer lock owner');
  if (owner.schema !== 'booking.preprod-control-plane-install-lock/v2' || !['install', 'rollback'].includes(owner.action) || !UUID.test(owner.transactionId || '') ||
      !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !UUID.test(owner.bootId || '') || !/^[0-9]+$/.test(owner.processStartTicks || '') || !/^[0-9a-f]{64}$/.test(owner.containerId || '') ||
      ![INSTALLER_CONTAINER, INSTALLER_RECOVERY_CONTAINER].includes(owner.containerName) ||
      !Number.isFinite(Date.parse(owner.createdAt))) throw new InstallError('installer lock owner identity is invalid');
  validateIdentity({ 'install-id': owner.installId, 'git-sha': owner.gitSha, 'approval-id': owner.approvalId });
  return owner;
}

async function inspectContainer(reference, runtime) {
  if (runtime.inspectContainer) return runtime.inspectContainer(reference);
  const inspected = spawnSync(DOCKER, ['container', 'inspect', reference], { encoding: 'utf8' });
  if (inspected.status !== 0) {
    if (/no such (object|container)/i.test(`${inspected.stderr}\n${inspected.stdout}`)) return null;
    throw new InstallError('cannot determine installer container identity');
  }
  let container; try { [container] = JSON.parse(inspected.stdout); } catch { throw new InstallError('installer container inspect is invalid'); }
  if (!container || typeof container !== 'object') throw new InstallError('installer container inspect is invalid');
  return container;
}

const containerNameForAction = (action) => action === 'recover' ? INSTALLER_RECOVERY_CONTAINER : INSTALLER_CONTAINER;

async function currentProcessIdentity(runtime, now, action) {
  const containerName = containerNameForAction(action);
  if (runtime.processIdentity) return { ...runtime.processIdentity, containerName: runtime.processIdentity.containerName || containerName, createdAt: now };
  const bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  const statText = await readFile(`/proc/${process.pid}/stat`, 'utf8');
  const close = statText.lastIndexOf(')'); const fields = statText.slice(close + 2).split(' ');
  const processStartTicks = fields[19];
  const container = await inspectContainer(containerName, runtime);
  if (!/^[0-9a-f]{64}$/.test(container?.Id || '') || container?.Name !== `/${containerName}` || container?.State?.Running !== true ||
      container?.State?.Pid !== process.pid || container?.HostConfig?.PidMode !== 'host' || container?.Config?.Image !== CONTROL_IMAGE) throw new InstallError('installer container identity is not the fixed reviewed runtime');
  if (!UUID.test(bootId) || !/^[0-9]+$/.test(processStartTicks || '')) throw new InstallError('cannot bind installer lock to process start identity');
  return { pid: process.pid, bootId, processStartTicks, containerId: container.Id, containerName, createdAt: now };
}

async function isLockOwnerAlive(owner, runtime) {
  if (runtime.isProcessAlive) return runtime.isProcessAlive(owner);
  const byId = await inspectContainer(owner.containerId, runtime);
  const byName = await inspectContainer(owner.containerName, runtime);
  if (byId === null && byName === null) return false;
  if (byId === null && byName !== null && owner.containerName === INSTALLER_RECOVERY_CONTAINER && byName?.Id !== owner.containerId) {
    const recoveryIdentity = await currentProcessIdentity(runtime, runtime.now || new Date().toISOString(), 'recover');
    if (recoveryIdentity.containerName !== INSTALLER_RECOVERY_CONTAINER || recoveryIdentity.containerId !== byName?.Id ||
        byName?.Name !== `/${INSTALLER_RECOVERY_CONTAINER}` || byName?.State?.Running !== true || byName?.State?.Pid !== recoveryIdentity.pid ||
        byName?.HostConfig?.PidMode !== 'host' || byName?.Config?.Image !== CONTROL_IMAGE) {
      throw new InstallError('installer owner container identity drifted');
    }
    return false;
  }
  if (byId === null || byName === null || byId?.Id !== owner.containerId || byName?.Id !== owner.containerId ||
      byId?.Name !== `/${owner.containerName}` || byName?.Name !== `/${owner.containerName}` ||
      byId?.HostConfig?.PidMode !== 'host' || byName?.HostConfig?.PidMode !== 'host' ||
      byId?.State?.Running !== byName?.State?.Running || byId?.State?.Pid !== byName?.State?.Pid ||
      byId?.Config?.Image !== byName?.Config?.Image) throw new InstallError('installer owner container identity drifted');
  const container = byId;
  if (container?.State?.Running !== true) return false;
  if (container?.State?.Pid !== owner.pid || container?.Config?.Image !== CONTROL_IMAGE) throw new InstallError('live installer owner container identity drifted');
  let bootId; let statText;
  try { bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(); statText = await readFile(`/proc/${owner.pid}/stat`, 'utf8'); }
  catch (error) { if (error?.code === 'ENOENT') throw new InstallError('running installer owner process is absent'); throw error; }
  const close = statText.lastIndexOf(')'); const fields = statText.slice(close + 2).split(' ');
  if (bootId !== owner.bootId || fields[19] !== owner.processStartTicks) throw new InstallError('live installer owner process identity drifted');
  return true;
}

async function assertNormalInstallerAbsent(runtime) {
  if (runtime.assertNormalInstallerAbsent) return runtime.assertNormalInstallerAbsent();
  if (await inspectContainer(INSTALLER_CONTAINER, runtime) !== null) throw new InstallError('normal installer container still occupies the fixed identity');
}

function sameLockArtifact(left, right) {
  return left.artifactDigest === right.artifactDigest && canonicalJson(left.entries) === canonicalJson(right.entries) && canonicalJson(left.owner) === canonicalJson(right.owner);
}

async function revalidateLockArtifact(path, expected, settings) {
  const current = await inspectLockArtifact(path, settings);
  if (!sameLockArtifact(current, expected)) throw new InstallError('installer lock artifact changed before removal');
  return current;
}

function ownerMatchesIdentity(owner, identity) {
  return owner && ['pid', 'bootId', 'processStartTicks', 'containerId', 'containerName'].every((field) => owner[field] === identity[field]);
}

async function verifyLockArtifactRemoval(path, expected, settings, runtime, now) {
  const current = await revalidateLockArtifact(path, expected, settings);
  if (current.owner) {
    const recoveryIdentity = await currentProcessIdentity(runtime, now, 'recover');
    if (!ownerMatchesIdentity(current.owner, recoveryIdentity) && await isLockOwnerAlive(current.owner, runtime)) {
      throw new InstallError('installer lock owner restarted before removal');
    }
    await currentProcessIdentity(runtime, now, 'recover');
  } else {
    await assertNormalInstallerAbsent(runtime);
    await currentProcessIdentity(runtime, now, 'recover');
  }
  return current;
}

async function lockTemporaryPaths(paths) {
  const prefix = `${basename(paths.lockPath)}.`; const suffix = '.tmp'; const found = [];
  for (const name of await readdir(dirname(paths.lockPath))) {
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
    const transactionId = name.slice(prefix.length, -suffix.length);
    if (!UUID.test(transactionId)) throw new InstallError('malformed installer lock temporary exists');
    found.push({ transactionId, path: join(dirname(paths.lockPath), name) });
  }
  return found;
}

async function inspectLockArtifact(path, settings) {
  await assertDirectory(path, settings.uid, 'installer lock artifact', settings.enforceMode);
  const names = (await readdir(path)).sort();
  if (names.some((name) => !['.owner.json.tmp', 'owner.json'].includes(name))) throw new InstallError('installer lock artifact contains an unknown entry');
  let owner = null;
  if (names.includes('owner.json')) {
    try { owner = await readLockOwner({ lockPath: path }, settings, path); } catch { owner = null; }
  }
  const artifact = await inventory(path, { uid: settings.uid, source: true, enforceMode: false });
  return { owner, artifactDigest: artifact.digest, entries: names };
}

function validateForensicReceipt(receipt, args, artifactDigest = null) {
  const fields = ['schema', 'status', 'action', 'environment', 'project', 'identityUnknown', 'recoveryRequest', 'lockOwnerDigest',
    'artifactDigest', 'recoveryContainerId', 'observedAt', 'receiptDigest'];
  requireExactKeys(receipt, fields, 'lock forensic receipt'); const { receiptDigest, ...body } = receipt;
  requireExactKeys(receipt.recoveryRequest, ['transactionId', 'installId', 'gitSha', 'approvalId'], 'lock forensic recovery request');
  if (receiptDigest !== sha256(canonicalJson(body)) || receipt.schema !== 'booking.preprod-control-plane-lock-recovery/v2' || receipt.status !== 'pass' ||
      receipt.action !== 'clear-incomplete-lock' || receipt.environment !== 'preprod' || receipt.project !== 'booking-preprod' || typeof receipt.identityUnknown !== 'boolean' ||
      receipt.recoveryRequest.transactionId !== args['transaction-id'] || receipt.recoveryRequest.installId !== args['install-id'] || receipt.recoveryRequest.gitSha !== args['git-sha'] ||
      receipt.recoveryRequest.approvalId !== args['approval-id'] || (receipt.identityUnknown ? receipt.lockOwnerDigest !== null : !DIGEST.test(receipt.lockOwnerDigest || '')) ||
      !/^[0-9a-f]{64}$/.test(receipt.recoveryContainerId || '') || !Number.isFinite(Date.parse(receipt.observedAt)) ||
      (artifactDigest !== null && receipt.artifactDigest !== artifactDigest)) throw new InstallError('lock forensic receipt identity is invalid');
  validateDigest(receipt.artifactDigest, 'lock forensic artifact'); validateDigest(receipt.receiptDigest, 'lock forensic receipt'); return receipt;
}

async function ensureForensicReceipt(paths, args, artifactDigest, lockOwner, recoveryIdentity, settings, runtime, now) {
  const path = join(paths.receiptRoot, `control-plane-lock-recovery-${args['transaction-id']}.json`);
  const body = { schema: 'booking.preprod-control-plane-lock-recovery/v2', status: 'pass', action: 'clear-incomplete-lock', environment: 'preprod', project: 'booking-preprod',
    identityUnknown: lockOwner === null, recoveryRequest: { transactionId: args['transaction-id'], installId: args['install-id'], gitSha: args['git-sha'], approvalId: args['approval-id'] },
    lockOwnerDigest: lockOwner === null ? null : sha256(canonicalJson(lockOwner)), artifactDigest,
    recoveryContainerId: recoveryIdentity.containerId, observedAt: now };
  const expected = { ...body, receiptDigest: sha256(canonicalJson(body)) }; const temp = `${path}.${args['transaction-id']}.tmp`;
  if (await exists(path)) {
    const receipt = validateForensicReceipt(await readImmutableJson(path, settings, 'lock forensic receipt'), args, artifactDigest);
    if (await exists(temp)) { const staged = validateForensicReceipt(await readImmutableJson(temp, settings, 'lock forensic receipt temporary'), args, artifactDigest); if (canonicalJson(staged) !== canonicalJson(receipt)) throw new InstallError('lock forensic receipt temporary differs'); await unlink(temp); await syncDirectory(dirname(temp), runtime); }
    return receipt;
  }
  if (await exists(temp)) {
    const staged = validateForensicReceipt(await readImmutableJson(temp, settings, 'lock forensic receipt temporary'), args, artifactDigest);
    await link(temp, path); await syncDirectory(dirname(path), runtime); await unlink(temp); await syncDirectory(dirname(path), runtime); return staged;
  }
  return publishReceipt(path, body, settings.uid, runtime);
}

async function writeJournal(paths, journal, settings, runtime, phase) {
  journal.phase = phase; journal.updatedAt = runtime.now || new Date().toISOString();
  await atomicJson(paths.journalPath, journal, settings.uid, runtime); await checkpoint(runtime, `journal:${phase}`);
}

async function discardExactJournalTemp(paths, journal, args, settings, runtime) {
  const temp = `${paths.journalPath}.${journal.transactionId}.tmp`;
  if (!await exists(temp)) return;
  const candidate = await readImmutableJson(temp, settings, 'journal temporary'); validateJournal(candidate, args);
  const mutable = new Set(['phase', 'updatedAt', 'receiptDigest']);
  for (const key of Object.keys(journal)) if (!mutable.has(key) && canonicalJson(candidate[key]) !== canonicalJson(journal[key])) throw new InstallError('journal temporary identity differs from durable journal');
  await unlink(temp); await syncDirectory(dirname(temp), runtime);
}

async function recoverInstall(paths, journal, settings, runtime) {
  const stage = join(dirname(paths.installRoot), journal.stageName); const retired = journal.retiredName ? join(dirname(paths.installRoot), journal.retiredName) : null;
  const receiptPath = join(paths.receiptRoot, `control-plane-install-${journal.installId}.json`);
  const receiptTemp = `${receiptPath}.${journal.transactionId}.tmp`;
  const active = await treeDigest(paths.installRoot, settings); const rollback = await treeDigest(paths.rollbackRoot, settings);
  let staged = await looseTreeDigest(stage, settings); const retiredDigest = retired ? await treeDigest(retired, settings) : null;
  const failed = join(dirname(paths.installRoot), `.happybooking-control-plane-failed-${journal.transactionId}`); const failedDigest = await treeDigest(failed, settings);
  assertKnown(active, [null, journal.oldActiveDigest, journal.newDigest], 'active');
  assertKnown(rollback, [null, journal.oldActiveDigest, journal.oldRollbackDigest], 'rollback');
  if (staged !== null && staged !== journal.newDigest && journal.phase === 'PREPARED') {
    await assertDirectory(stage, settings.uid, 'partial stage', settings.enforceMode); await rm(stage, { recursive: true }); staged = null;
  }
  assertKnown(staged, [null, journal.newDigest], 'stage');
  assertKnown(retiredDigest, [null, journal.oldRollbackDigest], 'retired');
  assertKnown(failedDigest, [null, journal.newDigest], 'failed candidate');
  let receipt = null;
  if (await exists(receiptPath)) {
    receipt = validateInstallReceipt(await readImmutableJson(receiptPath, settings, 'install receipt'), journal);
  }
  if (receipt) {
    if (active !== journal.newDigest || rollback !== journal.oldActiveDigest) throw new InstallError('receipt exists but installed trees do not match');
    if (staged) await rm(stage, { recursive: true }); if (retiredDigest) await rm(retired, { recursive: true }); if (await exists(receiptTemp)) await unlink(receiptTemp);
    await syncDirectory(dirname(paths.installRoot), runtime); await writeJournal(paths, journal, settings, runtime, 'COMPLETE');
    return { status: 'completed', receipt };
  }
  if (active === journal.newDigest) await durableRename(paths.installRoot, failed, runtime, 'recover:new-quarantined');
  if (await treeDigest(paths.installRoot, settings) === null && await treeDigest(paths.rollbackRoot, settings) === journal.oldActiveDigest) await durableRename(paths.rollbackRoot, paths.installRoot, runtime, 'recover:active-restored');
  if (journal.oldRollbackDigest) {
    if (await treeDigest(paths.rollbackRoot, settings) === null && retiredDigest === journal.oldRollbackDigest) await durableRename(retired, paths.rollbackRoot, runtime, 'recover:rollback-restored');
  } else if (await exists(paths.rollbackRoot)) throw new InstallError('unexpected rollback tree while restoring no-rollback state');
  if (await exists(stage)) await rm(stage, { recursive: true }); if (await exists(failed)) await rm(failed, { recursive: true }); if (await exists(receiptTemp)) await unlink(receiptTemp);
  await syncDirectory(dirname(paths.installRoot), runtime);
  if (await treeDigest(paths.installRoot, settings) !== journal.oldActiveDigest || await treeDigest(paths.rollbackRoot, settings) !== journal.oldRollbackDigest) throw new InstallError('pre-install trees were not restored');
  await writeJournal(paths, journal, settings, runtime, 'COMPLETE'); return { status: 'rolled-back', receipt: null };
}

async function recoverRollback(paths, journal, settings, runtime) {
  const swap = join(dirname(paths.installRoot), journal.swapName); const receiptPath = join(paths.receiptRoot, `control-plane-rollback-${journal.rollbackId}.json`);
  const receiptTemp = `${receiptPath}.${journal.transactionId}.tmp`;
  const targetInstallReceipt = validateInstallReceipt(await readImmutableJson(join(paths.receiptRoot, `control-plane-install-${journal.installId}.json`), settings, 'rollback source install receipt'));
  if (targetInstallReceipt.receiptDigest !== journal.targetInstallReceiptDigest || targetInstallReceipt.inventoryDigest !== journal.oldActiveDigest || targetInstallReceipt.rollbackInventoryDigest !== journal.oldRollbackDigest) throw new InstallError('rollback recovery target receipt drifted');
  const temp = join(dirname(paths.installRoot), `.happybooking-control-plane-failed-${journal.transactionId}`);
  let active = await treeDigest(paths.installRoot, settings); let rollback = await treeDigest(paths.rollbackRoot, settings); const swapDigest = await treeDigest(swap, settings); const tempDigest = await treeDigest(temp, settings);
  assertKnown(active, [null, journal.oldActiveDigest, journal.oldRollbackDigest], 'active'); assertKnown(rollback, [null, journal.oldActiveDigest, journal.oldRollbackDigest], 'rollback');
  assertKnown(swapDigest, [null, journal.oldRollbackDigest], 'swap'); assertKnown(tempDigest, [null, journal.oldRollbackDigest], 'recovery temporary tree');
  let receipt = null;
  if (await exists(receiptPath)) receipt = validateRollbackReceipt(await readImmutableJson(receiptPath, settings, 'rollback receipt'), journal);
  if (receipt) {
    if (active !== journal.oldRollbackDigest || rollback !== journal.oldActiveDigest) throw new InstallError('rollback receipt/tree mismatch');
    if (await exists(swap)) await rm(swap, { recursive: true }); if (await exists(receiptTemp)) await unlink(receiptTemp); await syncDirectory(dirname(paths.installRoot), runtime);
    await writeJournal(paths, journal, settings, runtime, 'COMPLETE'); return { status: 'completed', receipt };
  }
  if (active === journal.oldRollbackDigest && rollback === journal.oldActiveDigest) {
    await durableRename(paths.installRoot, temp, runtime, 'recover:rollback-active-quarantined');
    await durableRename(paths.rollbackRoot, paths.installRoot, runtime, 'recover:rollback-active-restored');
    await durableRename(temp, paths.rollbackRoot, runtime, 'recover:rollback-target-restored');
  } else if (active === null && rollback === journal.oldActiveDigest && tempDigest === journal.oldRollbackDigest) {
    await durableRename(paths.rollbackRoot, paths.installRoot, runtime, 'recover:rollback-active-restored');
    await durableRename(temp, paths.rollbackRoot, runtime, 'recover:rollback-target-restored');
  } else if (active === journal.oldActiveDigest && rollback === null && tempDigest === journal.oldRollbackDigest) {
    await durableRename(temp, paths.rollbackRoot, runtime, 'recover:rollback-target-restored');
  } else if (active === null && rollback === journal.oldActiveDigest && swapDigest === journal.oldRollbackDigest) {
    await durableRename(paths.rollbackRoot, paths.installRoot, runtime, 'recover:rollback-mid-active');
    await durableRename(swap, paths.rollbackRoot, runtime, 'recover:rollback-mid-target');
  } else if (active === journal.oldActiveDigest && rollback === null && swapDigest === journal.oldRollbackDigest) {
    await durableRename(swap, paths.rollbackRoot, runtime, 'recover:rollback-first-target');
  }
  active = await treeDigest(paths.installRoot, settings); rollback = await treeDigest(paths.rollbackRoot, settings);
  if (active !== journal.oldActiveDigest || rollback !== journal.oldRollbackDigest) throw new InstallError('pre-rollback trees were not restored');
  if (await exists(receiptTemp)) await unlink(receiptTemp);
  await writeJournal(paths, journal, settings, runtime, 'COMPLETE'); return { status: 'rolled-back', receipt: null };
}

export async function runControlPlaneInstaller(input, runtime = {}) {
  const args = parseArgs(input); const paths = defaultPaths(runtime); const now = runtime.now || new Date().toISOString();
  const settings = { uid: runtime.expectedUid === undefined ? 0 : runtime.expectedUid, enforceMode: runtime.enforceMode === undefined ? true : runtime.enforceMode };
  if (dirname(paths.rollbackRoot) !== dirname(paths.installRoot) || dirname(paths.lockPath) !== dirname(paths.installRoot) || dirname(paths.journalPath) !== dirname(paths.installRoot)) throw new InstallError('fixed targets must share one parent');
  if (!['bundle-inventory', 'approval-check'].includes(args.action)) {
    await assertDirectory(dirname(paths.installRoot), settings.uid, 'install parent', settings.enforceMode);
  }
  if (args.action === 'active-inventory') {
    validateIdentity(args);
    const active = await inventory(paths.installRoot, { uid: settings.uid, strict: true, enforceMode: settings.enforceMode });
    return { schema: 'booking.preprod-control-plane-active-inventory/v1', status: 'pass', action: 'active-inventory', environment: 'preprod', project: 'booking-preprod',
      installId: args['install-id'], gitSha: args['git-sha'], approvalId: args['approval-id'], hostIdentityDigest: await readHostIdentityDigest(paths, settings),
      observedAt: now, inventoryDigest: active.digest, entries: active.entries };
  }
  if (args.action === 'bundle-inventory') {
    validateIdentity(args); const bundle = await readDeclaration(paths, args, settings);
    return { schema: 'booking.preprod-control-plane-inventory/v2', status: 'pass', action: 'bundle-inventory', environment: 'preprod', project: 'booking-preprod', installId: args['install-id'], gitSha: args['git-sha'], approvalId: args['approval-id'], declarationDigest: bundle.declarationDigest, inventoryDigest: bundle.inventory.digest, entries: bundle.inventory.entries };
  }
  if (args.action === 'approval-check') {
    validateIdentity(args); const bundle = await readDeclaration(paths, args, settings);
    requireFields(args, ['migration-id', 'migration-action', 'transaction-id']);
    if (!MIGRATION_ID.test(args['migration-id']) || !['migrate', 'recover', 'rollback'].includes(args['migration-action']) || !UUID.test(args['transaction-id'])) throw new InstallError('migration approval request is invalid');
    const migrationRequest = { action: args['migration-action'], migrationId: args['migration-id'], transactionId: args['transaction-id'],
      predecessorReceiptDigest: args['predecessor-receipt-digest'] || null, expectedNormalizedInventoryDigest: args['expected-normalized-inventory-digest'] || null };
    const approval = await verifyIndependentApproval(paths, args, bundle.declaration, bundle.declarationDigest, settings, runtime, migrationRequest);
    if (migrationRequest.predecessorReceiptDigest) {
      const predecessorPath = join(paths.receiptRoot, `control-plane-legacy-migration-${migrationRequest.migrationId}.json`);
      const predecessor = await readImmutableJson(predecessorPath, settings, 'legacy migration predecessor receipt');
      const predecessorFields = ['schema', 'status', 'action', 'environment', 'project', 'transactionId', 'migrationId', 'approvalId', 'rawInventoryDigest', 'normalizedInventoryDigest', 'rawArchiveName', 'migratedAt', 'receiptDigest'];
      requireExactKeys(predecessor, predecessorFields, 'legacy migration predecessor receipt'); const { receiptDigest, ...predecessorBody } = predecessor;
      if (receiptDigest !== sha256(canonicalJson(predecessorBody)) || receiptDigest !== migrationRequest.predecessorReceiptDigest ||
          predecessor.schema !== 'booking.preprod-legacy-active-migration-receipt/v1' || predecessor.status !== 'pass' || predecessor.action !== 'migrate' ||
          predecessor.environment !== 'preprod' || predecessor.project !== 'booking-preprod' || predecessor.migrationId !== migrationRequest.migrationId ||
          predecessor.rawInventoryDigest !== approval.expectedActiveInventoryDigest || predecessor.normalizedInventoryDigest !== migrationRequest.expectedNormalizedInventoryDigest) {
        throw new InstallError('legacy migration predecessor receipt does not match signed rollback context');
      }
    }
    return { schema: 'booking.preprod-control-plane-migration-approval-check/v1', status: 'pass', environment: 'preprod', project: 'booking-preprod', installId: args['install-id'],
      gitSha: args['git-sha'], approvalId: args['approval-id'], migrationId: migrationRequest.migrationId, action: migrationRequest.action, transactionId: migrationRequest.transactionId,
      expectedActiveInventoryDigest: approval.expectedActiveInventoryDigest, approverReceiptDigest: approval.approverReceiptDigest };
  }
  await assertDirectory(paths.receiptRoot, settings.uid, 'receipt root', settings.enforceMode);
  let hasJournal = await exists(paths.journalPath); let hasLock = await exists(paths.lockPath); const lockTemps = await lockTemporaryPaths(paths);
  if (hasLock) {
    const lock = await assertDirectory(paths.lockPath, settings.uid, 'installer lock', settings.enforceMode);
    if (settings.enforceMode && (lock.mode & 0o777) !== 0o700) throw new InstallError('installer lock mode is invalid');
  }
  if (args.action !== 'recover' && (hasJournal || hasLock || lockTemps.length)) throw new InstallError('unfinished install transaction requires recover');
  await assertQuiescent(paths, runtime, now);
  if (args.action === 'recover') {
    requireFields(args, ['transaction-id']); validateIdentity(args);
    if (!hasJournal) {
      const exactLockTemp = lockTemps.find((entry) => entry.transactionId === args['transaction-id']);
      if (lockTemps.some((entry) => entry.transactionId !== args['transaction-id']) || (hasLock && exactLockTemp)) throw new InstallError('ambiguous installer lock artifacts require forensic stop');
      const forensicPath = join(paths.receiptRoot, `control-plane-lock-recovery-${args['transaction-id']}.json`);
      if (!hasLock && !exactLockTemp) {
        if (await exists(forensicPath)) return { status: 'incomplete-lock-already-cleared', receipt: validateForensicReceipt(await readImmutableJson(forensicPath, settings, 'lock forensic receipt'), args) };
        throw new InstallError('recovery journal and lock are absent');
      }
      const artifactPath = hasLock ? paths.lockPath : exactLockTemp.path; const artifact = await inspectLockArtifact(artifactPath, settings);
      if (artifact.owner) {
        if (await isLockOwnerAlive(artifact.owner, runtime)) throw new InstallError('installer lock owner is still alive');
        if (artifact.owner.transactionId !== args['transaction-id'] || artifact.owner.installId !== args['install-id'] || artifact.owner.gitSha !== args['git-sha'] || artifact.owner.approvalId !== args['approval-id']) throw new InstallError('recovery identity does not match lock owner');
      } else await assertNormalInstallerAbsent(runtime);
      const parentEntries = await readdir(dirname(paths.installRoot));
      const unsafeTransactionArtifact = parentEntries.find((name) => name.startsWith('.happybooking-control-plane-stage-') || name.startsWith('.happybooking-control-plane-retired-') || name.startsWith('.happybooking-control-plane-failed-'));
      if (unsafeTransactionArtifact) throw new InstallError('lock-only recovery found an unjournaled transaction artifact');
      const journalTemps = parentEntries.filter((entry) => entry.startsWith(`${basename(paths.journalPath)}.`) && entry.endsWith('.tmp'));
      const exactJournalTempName = `${basename(paths.journalPath)}.${args['transaction-id']}.tmp`;
      if (journalTemps.length) {
        if (journalTemps.length !== 1 || journalTemps[0] !== exactJournalTempName || !artifact.owner) throw new InstallError('unsafe journal temporary file');
        const temp = join(dirname(paths.journalPath), exactJournalTempName); const candidate = await readImmutableJson(temp, settings, 'initial journal temporary'); validateJournal(candidate, args);
        if (candidate.phase !== 'PREPARED') throw new InstallError('initial journal temporary phase is invalid');
        await rename(temp, paths.journalPath); await syncDirectory(dirname(paths.journalPath), runtime);
        return runControlPlaneInstaller(input, runtime);
      }
      const recoveryIdentity = await currentProcessIdentity(runtime, now, 'recover');
      const receipt = await ensureForensicReceipt(paths, args, artifact.artifactDigest, artifact.owner, recoveryIdentity, settings, runtime, now);
      await verifyLockArtifactRemoval(artifactPath, artifact, settings, runtime, now);
      await rm(artifactPath, { recursive: true }); await syncDirectory(dirname(artifactPath), runtime);
      return { status: 'cleared-incomplete-lock', receipt };
    }
    const journal = await readImmutableJson(paths.journalPath, settings, 'recovery journal');
    validateJournal(journal, args);
    const exactLockTemp = lockTemps.find((entry) => entry.transactionId === journal.transactionId);
    if (lockTemps.some((entry) => entry.transactionId !== journal.transactionId) || (hasLock && exactLockTemp)) throw new InstallError('ambiguous installer lock artifacts require forensic stop');
    if (!hasLock && exactLockTemp) {
      const artifact = await inspectLockArtifact(exactLockTemp.path, settings);
      if (artifact.owner) {
        if (await isLockOwnerAlive(artifact.owner, runtime)) throw new InstallError('installer lock owner is still alive');
        if (artifact.owner.transactionId !== journal.transactionId || artifact.owner.installId !== journal.installId || artifact.owner.gitSha !== journal.gitSha || artifact.owner.approvalId !== journal.approvalId) throw new InstallError('journal does not match installer lock temporary owner');
      } else await assertNormalInstallerAbsent(runtime);
      await currentProcessIdentity(runtime, now, 'recover'); await verifyLockArtifactRemoval(exactLockTemp.path, artifact, settings, runtime, now);
      await rm(exactLockTemp.path, { recursive: true }); await syncDirectory(dirname(exactLockTemp.path), runtime);
    }
    if (hasLock) {
      const artifact = await inspectLockArtifact(paths.lockPath, settings);
      if (!artifact.owner) {
        await assertNormalInstallerAbsent(runtime); await currentProcessIdentity(runtime, now, 'recover'); await verifyLockArtifactRemoval(paths.lockPath, artifact, settings, runtime, now);
        await rm(paths.lockPath, { recursive: true }); await syncDirectory(dirname(paths.lockPath), runtime); hasLock = false;
      }
    }
    let recoveryLockArtifact;
    if (!hasLock) {
      await publishInstallLock(paths, { ...journal, ...await currentProcessIdentity(runtime, now, 'recover') }, settings, runtime);
      recoveryLockArtifact = await inspectLockArtifact(paths.lockPath, settings);
    } else {
      recoveryLockArtifact = await inspectLockArtifact(paths.lockPath, settings); const owner = recoveryLockArtifact.owner;
      if (!owner) throw new InstallError('installer lock owner is unavailable');
      if (await isLockOwnerAlive(owner, runtime)) throw new InstallError('installer lock owner is still alive');
      if (owner.action !== journal.action || owner.transactionId !== journal.transactionId || owner.installId !== journal.installId || owner.gitSha !== journal.gitSha || owner.approvalId !== journal.approvalId) throw new InstallError('journal does not match installer lock owner');
    }
    await discardExactJournalTemp(paths, journal, args, settings, runtime);
    const parent = dirname(paths.installRoot); const transactionPaths = journal.action === 'install'
      ? [join(parent, journal.stageName), journal.retiredName ? join(parent, journal.retiredName) : null, join(parent, `.happybooking-control-plane-failed-${journal.transactionId}`)]
      : [join(parent, journal.swapName), join(parent, `.happybooking-control-plane-failed-${journal.transactionId}`)];
    await assertQuiescent(paths, runtime, now); await assertNotMountpoints(paths, runtime, transactionPaths.filter(Boolean));
    for (const path of [paths.installRoot, paths.rollbackRoot, ...transactionPaths].filter(Boolean)) if (await exists(path) && (await stat(path)).dev !== (await stat(parent)).dev) throw new InstallError('recovery tree is on a different filesystem');
    const result = journal.action === 'install' ? await recoverInstall(paths, journal, settings, runtime) : await recoverRollback(paths, journal, settings, runtime);
    const journalTemp = `${paths.journalPath}.${journal.transactionId}.tmp`; if (await exists(journalTemp)) await unlink(journalTemp);
    await unlink(paths.journalPath); await syncDirectory(dirname(paths.journalPath), runtime);
    await verifyLockArtifactRemoval(paths.lockPath, recoveryLockArtifact, settings, runtime, now);
    await rm(paths.lockPath, { recursive: true }); await syncDirectory(dirname(paths.lockPath), runtime); return result;
  }
  if (args.action === 'inventory') {
    validateIdentity(args); const bundle = await readDeclaration(paths, args, settings); return { schema: 'booking.preprod-control-plane-inventory/v2', status: 'pass', action: 'inventory', environment: 'preprod', project: 'booking-preprod', installId: args['install-id'], gitSha: args['git-sha'], approvalId: args['approval-id'], declarationDigest: bundle.declarationDigest, inventoryDigest: bundle.inventory.digest, entries: bundle.inventory.entries };
  }
  if (args.action === 'readback') {
    requireFields(args, ['install-id', 'expected-receipt-digest']);
    if (!INSTALL_ID.test(args['install-id'])) throw new InstallError('install ID invalid'); validateDigest(args['expected-receipt-digest'], 'expected receipt');
    const receiptPath = join(paths.receiptRoot, `control-plane-install-${args['install-id']}.json`);
    const receipt = validateInstallReceipt(await readImmutableJson(receiptPath, settings, 'install receipt'));
    const { receiptDigest } = receipt;
    if (receiptDigest !== args['expected-receipt-digest']) throw new InstallError('install receipt identity is invalid');
    const current = await inventory(paths.installRoot, { uid: settings.uid, strict: true, enforceMode: settings.enforceMode });
    if (current.digest !== receipt.inventoryDigest) throw new InstallError('active tree does not match install receipt');
    return { schema: 'booking.preprod-control-plane-readback/v2', status: 'pass', receiptDigest, installId: receipt.installId, gitSha: receipt.gitSha, approvalId: receipt.approvalId, inventoryDigest: current.digest };
  }
  validateIdentity(args); const transactionId = randomUUID(); const processIdentity = await currentProcessIdentity(runtime, now, args.action);
  await publishInstallLock(paths, { action: args.action, transactionId, installId: args['install-id'], gitSha: args['git-sha'], approvalId: args['approval-id'], ...processIdentity }, settings, runtime);
  let preserve = false;
  try {
    await checkpoint(runtime, 'lock:acquired');
    await assertQuiescent(paths, runtime, now);
    if (args.action === 'install') {
      for (const key of ['source-archive-digest', 'installer-digest', 'bundle-declaration-digest', 'tracked-allowlist-digest', 'expected-inventory-digest']) validateDigest(args[key], key);
      const bundle = await readDeclaration(paths, args, settings); const declaration = bundle.declaration;
      for (const [key, field] of [['source-archive-digest', 'sourceArchiveDigest'], ['installer-digest', 'installerDigest'], ['bundle-declaration-digest', null], ['tracked-allowlist-digest', 'trackedAllowlistDigest'], ['expected-inventory-digest', 'inventoryDigest']]) {
        const actual = field ? declaration[field] : bundle.declarationDigest; if (args[key] !== actual) throw new InstallError(`${key} does not match bundle declaration`);
      }
      const oldActive = await inventory(paths.installRoot, { uid: settings.uid, strict: true, enforceMode: settings.enforceMode });
      if (bundle.inventory.digest === oldActive.digest) throw new InstallError('new control-plane inventory equals the active tree');
      const approval = await verifyIndependentApproval(paths, args, declaration, bundle.declarationDigest, settings, runtime);
      if (oldActive.digest !== approval.expectedActiveInventoryDigest) throw new InstallError('active inventory differs from the independently approved inventory');
      const oldRollbackDigest = await treeDigest(paths.rollbackRoot, settings);
      if (await exists(join(paths.receiptRoot, `control-plane-install-${args['install-id']}.json`))) throw new InstallError('immutable receipt already exists');
      await assertNotMountpoints(paths, runtime);
      if ((await stat(paths.installRoot)).dev !== (await stat(dirname(paths.installRoot))).dev || (oldRollbackDigest && (await stat(paths.rollbackRoot)).dev !== (await stat(dirname(paths.installRoot))).dev)) throw new InstallError('active or rollback is a different filesystem/mountpoint');
      const stageName = `.happybooking-control-plane-stage-${args['install-id']}`; const retiredName = oldRollbackDigest ? `.happybooking-control-plane-retired-${transactionId}` : null;
      const stage = join(dirname(paths.installRoot), stageName); if (await exists(stage)) throw new InstallError('stage already exists');
      const journal = { schema: 'booking.preprod-control-plane-transaction/v2', action: 'install', transactionId, installId: args['install-id'], gitSha: args['git-sha'], approvalId: args['approval-id'], phase: 'PREPARED', stageName, retiredName, newDigest: bundle.inventory.digest, oldActiveDigest: oldActive.digest, oldRollbackDigest, sourceArchiveDigest: declaration.sourceArchiveDigest, installerDigest: declaration.installerDigest, bundleDeclarationDigest: bundle.declarationDigest, trackedAllowlistDigest: declaration.trackedAllowlistDigest, payloadMapDigest: declaration.payloadMapDigest, archiveCommandDigest: declaration.archiveCommandDigest, ...approval, receiptDigest: null, updatedAt: now };
      await writeJournal(paths, journal, settings, runtime, 'PREPARED');
      await copyTree(bundle.payload, stage, settings, runtime); const staged = await inventory(stage, { uid: settings.uid, strict: true, enforceMode: settings.enforceMode });
      if (staged.digest !== bundle.inventory.digest) throw new InstallError('post-copy inventory changed');
      await smokeStage(stage, runtime);
      await assertQuiescent(paths, runtime, now); await assertNotMountpoints(paths, runtime, [stage, retiredName ? join(dirname(paths.installRoot), retiredName) : null].filter(Boolean));
      if (oldRollbackDigest) await durableRename(paths.rollbackRoot, join(dirname(paths.installRoot), retiredName), runtime, 'rename:old-retired');
      await writeJournal(paths, journal, settings, runtime, 'OLD_RETIRED');
      await durableRename(paths.installRoot, paths.rollbackRoot, runtime, 'rename:active-moved'); await writeJournal(paths, journal, settings, runtime, 'ACTIVE_MOVED');
      await durableRename(stage, paths.installRoot, runtime, 'rename:new-active'); await writeJournal(paths, journal, settings, runtime, 'NEW_ACTIVE');
      const body = { schema: 'booking.preprod-control-plane-install-receipt/v3', status: 'pass', action: 'install', environment: 'preprod', project: 'booking-preprod', transactionId, installId: args['install-id'], gitSha: args['git-sha'], approvalId: args['approval-id'], sourceArchiveDigest: declaration.sourceArchiveDigest, installerDigest: declaration.installerDigest, bundleDeclarationDigest: bundle.declarationDigest, trackedAllowlistDigest: declaration.trackedAllowlistDigest, payloadMapDigest: declaration.payloadMapDigest, archiveCommandDigest: declaration.archiveCommandDigest, ...approval, inventoryDigest: staged.digest, oldActiveInventoryDigest: oldActive.digest, rollbackInventoryDigest: oldActive.digest, installedAt: now };
      const receipt = await publishReceipt(join(paths.receiptRoot, `control-plane-install-${args['install-id']}.json`), body, settings.uid, runtime); journal.receiptDigest = receipt.receiptDigest;
      await checkpoint(runtime, 'receipt:published'); await writeJournal(paths, journal, settings, runtime, 'RECEIPT_PUBLISHED');
      if (retiredName) { await rm(join(dirname(paths.installRoot), retiredName), { recursive: true }); await syncDirectory(dirname(paths.installRoot), runtime); }
      await writeJournal(paths, journal, settings, runtime, 'COMPLETE'); await unlink(paths.journalPath); await syncDirectory(dirname(paths.journalPath), runtime); await checkpoint(runtime, 'journal:removed'); await rm(paths.lockPath, { recursive: true }); await syncDirectory(dirname(paths.lockPath), runtime); return receipt;
    }
    requireFields(args, ['rollback-id', 'expected-active-inventory-digest', 'expected-rollback-inventory-digest']);
    if (!INSTALL_ID.test(args['rollback-id']) || args['rollback-id'] !== args['install-id']) throw new InstallError('rollback ID must equal the install being rolled back'); validateDigest(args['expected-active-inventory-digest'], 'active'); validateDigest(args['expected-rollback-inventory-digest'], 'rollback');
    const active = await inventory(paths.installRoot, { uid: settings.uid, enforceMode: settings.enforceMode }); const rollback = await inventory(paths.rollbackRoot, { uid: settings.uid, enforceMode: settings.enforceMode });
    if (active.digest !== args['expected-active-inventory-digest'] || rollback.digest !== args['expected-rollback-inventory-digest']) throw new InstallError('rollback tree identity mismatch');
    const targetInstallReceipt = validateInstallReceipt(await readImmutableJson(join(paths.receiptRoot, `control-plane-install-${args['install-id']}.json`), settings, 'rollback source install receipt'));
    if (targetInstallReceipt.installId !== args['install-id'] || targetInstallReceipt.inventoryDigest !== active.digest || targetInstallReceipt.rollbackInventoryDigest !== rollback.digest) throw new InstallError('rollback trees are not bound to the historical install receipt');
    if (await exists(join(paths.receiptRoot, `control-plane-rollback-${args['rollback-id']}.json`))) throw new InstallError('immutable receipt already exists');
    await assertNotMountpoints(paths, runtime); await assertQuiescent(paths, runtime, now);
    if ((await stat(paths.installRoot)).dev !== (await stat(dirname(paths.installRoot))).dev || (await stat(paths.rollbackRoot)).dev !== (await stat(dirname(paths.installRoot))).dev) throw new InstallError('active or rollback is a different filesystem/mountpoint');
    const swapName = `.happybooking-control-plane-retired-${transactionId}`;
    const journal = { schema: 'booking.preprod-control-plane-transaction/v2', action: 'rollback', transactionId, installId: args['install-id'], rollbackId: args['rollback-id'], gitSha: args['git-sha'], approvalId: args['approval-id'], phase: 'PREPARED', swapName, oldActiveDigest: active.digest, oldRollbackDigest: rollback.digest, targetInstallReceiptDigest: targetInstallReceipt.receiptDigest, receiptDigest: null, updatedAt: now };
    await writeJournal(paths, journal, settings, runtime, 'PREPARED'); await durableRename(paths.rollbackRoot, join(dirname(paths.installRoot), swapName), runtime, 'rename:rollback-retired'); await writeJournal(paths, journal, settings, runtime, 'OLD_RETIRED');
    await durableRename(paths.installRoot, paths.rollbackRoot, runtime, 'rename:rollback-active-moved'); await writeJournal(paths, journal, settings, runtime, 'ACTIVE_MOVED');
    await durableRename(join(dirname(paths.installRoot), swapName), paths.installRoot, runtime, 'rename:rollback-new-active'); await writeJournal(paths, journal, settings, runtime, 'NEW_ACTIVE');
    const body = { schema: 'booking.preprod-control-plane-install-receipt/v3', status: 'pass', action: 'rollback', environment: 'preprod', project: 'booking-preprod', transactionId, installId: args['install-id'], rollbackId: args['rollback-id'], gitSha: args['git-sha'], approvalId: args['approval-id'], targetInstallReceiptDigest: targetInstallReceipt.receiptDigest, inventoryDigest: rollback.digest, oldActiveInventoryDigest: active.digest, rollbackInventoryDigest: active.digest, rolledBackAt: now };
    const receipt = await publishReceipt(join(paths.receiptRoot, `control-plane-rollback-${args['rollback-id']}.json`), body, settings.uid, runtime); journal.receiptDigest = receipt.receiptDigest;
    await checkpoint(runtime, 'receipt:published'); await writeJournal(paths, journal, settings, runtime, 'RECEIPT_PUBLISHED'); await writeJournal(paths, journal, settings, runtime, 'COMPLETE');
    await unlink(paths.journalPath); await syncDirectory(dirname(paths.journalPath), runtime); await checkpoint(runtime, 'journal:removed'); await rm(paths.lockPath, { recursive: true }); await syncDirectory(dirname(paths.lockPath), runtime); return receipt;
  } catch (error) {
    if (error instanceof SimulatedInstallCrash || await exists(paths.journalPath)) preserve = true;
    throw error;
  } finally {
    if (!preserve && await exists(paths.lockPath)) { await rm(paths.lockPath, { recursive: true }); await syncDirectory(dirname(paths.lockPath), runtime); }
  }
}

async function smokeStage(stage, runtime) {
  if (runtime.smokeStage) return runtime.smokeStage(stage);
  const mjs = (await inventory(stage, { uid: 0, strict: true })).entries.filter((entry) => entry.type === 'file' && entry.path.endsWith('.mjs')).map((entry) => join(stage, ...entry.path.split('/')));
  for (const file of mjs) { const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }); if (check.status !== 0) throw new InstallError(`syntax smoke failed: ${basename(file)}`); }
  const program = "import {pathToFileURL} from 'node:url'; for (const p of process.argv.slice(1)) await import(pathToFileURL(p).href);";
  const imports = spawnSync(process.execPath, ['--input-type=module', '--eval', program, ...mjs], { encoding: 'utf8' }); if (imports.status !== 0) throw new InstallError('import smoke failed');
  const launcher = spawnSync('/bin/sh', [join(stage, 'run-booking-preprod-control-plane'), 'manage-deploy-state', '--action', 'renew', '--execute', 'true', '--environment', 'preprod', '--project', 'booking-preprod', '--approval-id', 'smoke', '--expected-generation', '1', '--expected-fencing-epoch', '1', '--manifest-digest', `sha256:${'0'.repeat(64)}`, '--lease-id', 'smoke', '--holder-id', 'smoke', '--lease-duration-ms', '30000'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', BOOKING_CONTROL_PLANE_DRY_RUN: 'true' } });
  if (launcher.status !== 0 || !launcher.stdout.includes('/var/packages/ContainerManager/target/usr/bin/docker')) throw new InstallError('launcher dry-run smoke failed');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${canonicalJson(await runControlPlaneInstaller(process.argv.slice(2)))}\n`); }
  catch (error) { process.stderr.write(`booking-preprod control-plane installer rejected the request: ${error instanceof InstallError ? error.message : 'unexpected failure'}\n`); process.exitCode = 64; }
}
