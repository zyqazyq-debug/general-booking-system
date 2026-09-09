#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { access, chmod, link, mkdir, open, realpath, stat, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson, ContractError, EXIT, parseArgs, readJsonFile, sha256, validateReleaseManifest } from './lib/contracts.mjs';
import { digestFile } from './lib/artifacts.mjs';
import { LEGACY_OLD_BINDING } from './lib/legacy-preprod.mjs';

export const PREPROD_POSTGRES_CONTAINER = 'booking-preprod-postgres-1';
export const PREPROD_DATABASE = 'booking_preprod';
export const PREPROD_DATABASE_USER = 'booking_preprod';
export const PREPROD_BACKUP_ROOT = '/volume1/homes/realzyq/booking-preprod/.g4/backups';
export const PREPROD_RECEIPT_ROOT = '/volume1/homes/realzyq/booking-preprod/.g4/receipts';
export const PREPROD_RELEASE_ROOT = '/volume1/homes/realzyq/booking-preprod/releases';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ALLOWED = new Set(['action', 'execute', 'identity', 'manifest', 'backup-path', 'receipt-path', 'expected-backup-digest']);

async function findDocker() {
  for (const candidate of ['/var/packages/ContainerManager/target/usr/bin/docker', '/usr/bin/docker']) {
    try { await access(candidate, constants.X_OK); return candidate; } catch {}
  }
  throw new ContractError('trusted Docker executable is unavailable', EXIT.DATABASE);
}

async function trustedDirectory(path, runtime) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
  const canonical = await realpath(path);
  const metadata = await stat(canonical);
  if (!metadata.isDirectory() || (!runtime.allowNonRoot && ((process.platform !== 'win32' && metadata.uid !== 0) || (metadata.mode & 0o077) !== 0))) {
    throw new ContractError(`evidence directory is not root-only: ${path}`, EXIT.DATABASE);
  }
  return canonical;
}

function containedPath(root, value, label) {
  if (!isAbsolute(value || '')) throw new ContractError(`${label} must be absolute`, EXIT.DATABASE);
  const candidate = resolve(value);
  const containment = relative(root, candidate);
  if (!containment || containment.startsWith('..') || isAbsolute(containment)) {
    throw new ContractError(`${label} escapes the fixed booking-preprod root`, EXIT.DATABASE);
  }
  return candidate;
}

async function commandRunner(executable, argv, options = {}) {
  const outputHandle = options.outputPath ? await open(options.outputPath, 'wx', 0o600) : null;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, argv, {
      shell: false,
      windowsHide: true,
      stdio: [options.inputPath ? 'pipe' : 'ignore', outputHandle ? outputHandle.fd : 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let settled = false;
    let forceKillTimer;
    const closeOutput = async () => {
      if (outputHandle) { await outputHandle.sync(); await outputHandle.close(); }
    };
    if (!outputHandle) child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 64 * 1024) child.kill('SIGKILL'); else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 64 * 1024) child.kill('SIGKILL'); else stderr.push(chunk);
    });
    const clearTimers = () => { clearTimeout(timer); if (forceKillTimer) clearTimeout(forceKillTimer); };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    }, options.timeoutMs || 600_000);
    if (options.inputPath) {
      const input = createReadStream(options.inputPath);
      input.once('error', (error) => { clearTimers(); child.kill('SIGKILL'); if (!settled) { settled = true; closeOutput().finally(() => reject(error)); } });
      input.pipe(child.stdin);
    }
    child.once('error', (error) => { clearTimers(); if (!settled) { settled = true; closeOutput().finally(() => reject(error)); } });
    child.once('close', async (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimers();
      try {
        await closeOutput();
        resolvePromise({ exitCode: code, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), overflow: bytes > 64 * 1024 });
      } catch (error) { reject(error); }
    });
  });
}

function assertSuccess(result, label) {
  if (!result || result.exitCode !== 0 || result.signal || result.overflow) throw new ContractError(`${label} failed`, EXIT.DATABASE);
}

async function writeImmutableReceipt(path, receipt) {
  const temporary = `${path}.partial-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${canonicalJson(receipt)}\n`);
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporary, path).catch((error) => {
      if (error?.code === 'EEXIST') throw new ContractError('backup receipt path already exists', EXIT.DATABASE);
      throw error;
    });
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } catch (error) { if (!['EINVAL', 'EPERM', 'EISDIR'].includes(error?.code)) throw error; }
    finally { await directory.close(); }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
  }
}

export async function generateDatabaseBackupReceipt(args, runtime = {}) {
  for (const key of Object.keys(args)) if (!ALLOWED.has(key)) throw new ContractError(`unsupported argument: --${key}`, EXIT.DATABASE);
  if (args.execute !== 'true') throw new ContractError('backup receipt generation requires --execute true', EXIT.DATABASE);
  if (!['create', 'bind-existing'].includes(args.action) || !['old', 'candidate'].includes(args.identity)) {
    throw new ContractError('--action (create|bind-existing) and --identity (old|candidate) are required', EXIT.DATABASE);
  }
  for (const key of ['manifest', 'backup-path', 'receipt-path']) if (!args[key]) throw new ContractError(`--${key} is required`, EXIT.DATABASE);

  const backupRoot = await trustedDirectory(runtime.backupRoot || PREPROD_BACKUP_ROOT, runtime);
  const receiptRoot = await trustedDirectory(runtime.receiptRoot || PREPROD_RECEIPT_ROOT, runtime);
  const releaseRoot = await realpath(runtime.releaseRoot || PREPROD_RELEASE_ROOT).catch(() => {
    throw new ContractError('fixed booking-preprod release root is unavailable', EXIT.DATABASE);
  });
  const backupPath = containedPath(backupRoot, args['backup-path'], 'backup path');
  const receiptPath = containedPath(receiptRoot, args['receipt-path'], 'receipt path');
  const manifestPath = containedPath(releaseRoot, await realpath(args.manifest).catch(() => ''), 'manifest path');
  const manifest = validateReleaseManifest(await readJsonFile(manifestPath));
  const legacy = runtime.legacyBinding || LEGACY_OLD_BINDING;
  let manifestDigest;
  let manifestDigestMode;
  if (args.identity === 'old') {
    const rawDigest = await digestFile(manifestPath);
    if (manifest.releaseId !== legacy.releaseId || manifest.source.gitSha !== legacy.gitSha || rawDigest !== legacy.manifestRawDigest ||
        manifest.contracts.migration.catalogDigest !== legacy.migrationCatalogDigest || manifest.contracts.migration.expandFloor !== legacy.migrationFloor ||
        manifest.artifacts.backend.image !== legacy.manifestRepository || manifest.artifacts.backend.digest !== legacy.imageId) {
      throw new ContractError('old identity is not the one-time fixed legacy release', EXIT.IDENTITY);
    }
    manifestDigest = rawDigest;
    manifestDigestMode = 'raw-bytes';
  } else {
    manifestDigest = sha256(manifest);
    manifestDigestMode = 'canonical-json';
  }
  const docker = runtime.dockerExecutable || await findDocker();
  const runner = runtime.commandRunner || commandRunner;
  const timeoutMs = runtime.timeoutMs || 600_000;
  const identity = await runner(docker, ['exec', PREPROD_POSTGRES_CONTAINER, 'psql', '--no-password', '--tuples-only', '--no-align', '--quiet',
    '--username', PREPROD_DATABASE_USER, '--dbname', PREPROD_DATABASE, '--command', "SELECT current_database() || '|' || current_user;"], { timeoutMs });
  assertSuccess(identity, 'database identity readback');
  if (identity.stdout.trim() !== `${PREPROD_DATABASE}|${PREPROD_DATABASE_USER}`) {
    throw new ContractError('database identity does not match fixed booking-preprod target', EXIT.DATABASE);
  }

  if (args.action === 'create') {
    const temporary = `${backupPath}.partial-${randomUUID()}`;
    try { await stat(backupPath); throw new ContractError('backup path already exists', EXIT.DATABASE); }
    catch (error) { if (error instanceof ContractError) throw error; if (error?.code !== 'ENOENT') throw error; }
    try {
      const dump = await runner(docker, ['exec', PREPROD_POSTGRES_CONTAINER, 'pg_dump', '--no-password', '--format=custom', '--no-owner', '--username',
        PREPROD_DATABASE_USER, '--dbname', PREPROD_DATABASE], { outputPath: temporary, timeoutMs });
      assertSuccess(dump, 'pg_dump');
      const metadata = await stat(temporary);
      if (!metadata.isFile() || metadata.size < 1) throw new ContractError('pg_dump produced an empty backup', EXIT.DATABASE);
      await link(temporary, backupPath).catch((error) => {
        if (error?.code === 'EEXIST') throw new ContractError('backup path already exists', EXIT.DATABASE);
        throw error;
      });
    } finally {
      await unlink(temporary).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
    }
  } else {
    if (!DIGEST.test(args['expected-backup-digest'] || '')) throw new ContractError('--expected-backup-digest is required for bind-existing', EXIT.DATABASE);
    const canonicalBackup = await realpath(backupPath).catch(() => { throw new ContractError('existing backup is unavailable', EXIT.DATABASE); });
    if (canonicalBackup !== backupPath) throw new ContractError('existing backup must not be a symlink', EXIT.DATABASE);
  }

  const backupMetadata = await stat(backupPath);
  if (!backupMetadata.isFile() || backupMetadata.size < 1 || (!runtime.allowNonRoot && ((process.platform !== 'win32' && backupMetadata.uid !== 0) || (backupMetadata.mode & 0o077) !== 0))) {
    throw new ContractError('backup object is not a root-only regular file', EXIT.DATABASE);
  }
  const backupDigest = await digestFile(backupPath);
  if (args.action === 'bind-existing' && backupDigest !== args['expected-backup-digest']) {
    throw new ContractError('existing backup digest does not match the explicit binding', EXIT.DATABASE);
  }
  const list = await runner(docker, ['exec', '-i', PREPROD_POSTGRES_CONTAINER, 'pg_restore', '--list'], { inputPath: backupPath, timeoutMs });
  assertSuccess(list, 'pg_restore --list');
  if (!list.stdout.trim()) throw new ContractError('pg_restore --list produced no catalog', EXIT.DATABASE);
  const receipt = {
    schema: 'booking.database-backup-receipt/v1', environment: 'preproduction', database: PREPROD_DATABASE,
    databaseUser: PREPROD_DATABASE_USER,
    releaseId: manifest.releaseId, gitSha: manifest.source.gitSha, manifestDigest,
    manifestDigestMode,
    migrationCatalogDigest: manifest.contracts.migration.catalogDigest, backupDigest,
    verifiedAt: (runtime.now || (() => new Date()))().toISOString(), verification: { pgRestoreList: true },
  };
  await writeImmutableReceipt(receiptPath, receipt);
  return { receipt, receiptDigest: await digestFile(receiptPath), backupPath, receiptPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await generateDatabaseBackupReceipt(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ status: 'pass', receiptDigest: result.receiptDigest, backupDigest: result.receipt.backupDigest })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'fail', code: error instanceof ContractError ? 'BACKUP_RECEIPT_REJECTED' : 'BACKUP_RECEIPT_FAILED' })}\n`);
    process.exitCode = error instanceof ContractError ? error.exitCode : EXIT.DATABASE;
  }
}
