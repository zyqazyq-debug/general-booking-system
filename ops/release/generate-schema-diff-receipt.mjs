#!/usr/bin/env node
import { access, chmod, link, mkdir, open, realpath, stat, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson, ContractError, EXIT, parseArgs, readJsonFile, sha256, validateReleaseManifest } from './lib/contracts.mjs';
import { digestFile } from './lib/artifacts.mjs';
import { LEGACY_OLD_BINDING } from './lib/legacy-preprod.mjs';

export const PREPROD_DATABASE = 'booking_preprod';
export const PREPROD_DATABASE_USER = 'booking_preprod';
export const PREPROD_DATA_NETWORK = 'booking-preprod-data';
export const PREPROD_ENV_FILE = '/volume1/homes/realzyq/booking-preprod/.env';
export const PREPROD_RECEIPT_ROOT = '/volume1/homes/realzyq/booking-preprod/.g4/receipts';
export const PREPROD_RELEASE_ROOT = '/volume1/homes/realzyq/booking-preprod/releases';

const ALLOWED = new Set(['execute', 'identity', 'slot', 'manifest', 'receipt-path']);
const IMAGE_FORMAT = '{{json .Id}}|{{json .RepoDigests}}|{{json .RepoTags}}|{{json .Config.Labels}}';
const GREEN_CONTAINER_FORMAT = '{{json .Image}}|{{json .Config.Image}}|{{json .Config.Labels}}|{{json .State.Status}}';
const SCHEMA_LOG_PROGRAM = String.raw`(async()=>{const m=require('/app/dist/data-source.js');const d=m.default||m;await d.initialize();try{const rows=await d.query('SELECT current_database() AS database, current_user AS user');const q=await d.driver.createSchemaBuilder().log();process.stdout.write(JSON.stringify({schema:'booking.typeorm-schema-log/v1',database:rows[0]?.database,user:rows[0]?.user,upQueries:q.upQueries.map(x=>x.query),downQueries:q.downQueries.map(x=>x.query)})+'\n')}finally{await d.destroy()}})().catch(()=>{process.stderr.write('SCHEMA_LOG_FAILED\n');process.exit(1)})`;

export { LEGACY_OLD_BINDING };

async function findDocker() {
  for (const candidate of ['/var/packages/ContainerManager/target/usr/bin/docker', '/usr/bin/docker']) {
    try { await access(candidate, constants.X_OK); return candidate; } catch {}
  }
  throw new ContractError('trusted Docker executable is unavailable', EXIT.DATABASE);
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

async function assertTrustedEnvironmentFile(path, runtime) {
  const canonical = await realpath(path).catch(() => { throw new ContractError('fixed booking-preprod environment file is unavailable', EXIT.DATABASE); });
  if (canonical !== path) throw new ContractError('booking-preprod environment file must not be a symlink', EXIT.DATABASE);
  const metadata = await stat(canonical);
  if (!metadata.isFile() || (!runtime.allowNonRoot && ((process.platform !== 'win32' && metadata.uid !== 0) || (metadata.mode & 0o077) !== 0))) {
    throw new ContractError('booking-preprod environment file is not root-only', EXIT.DATABASE);
  }
  return canonical;
}

function defaultCommandRunner(executable, argv, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, argv, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    const collect = (target) => (chunk) => {
      bytes += chunk.length;
      if (bytes > 128 * 1024) child.kill('SIGKILL'); else target.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    let forceKillTimer;
    const clearTimers = () => { clearTimeout(timer); if (forceKillTimer) clearTimeout(forceKillTimer); };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    }, options.timeoutMs || 300_000);
    child.once('error', (error) => { clearTimers(); reject(error); });
    child.once('close', (exitCode, signal) => { clearTimers(); resolvePromise({
      exitCode, signal, overflow: bytes > 128 * 1024,
      stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'),
    }); });
  });
}

function assertSuccess(result, label) {
  if (!result || result.exitCode !== 0 || result.signal || result.overflow) throw new ContractError(`${label} failed`, EXIT.DATABASE);
}

function parseImageInspect(stdout) {
  const parts = stdout.trim().split('|');
  if (parts.length !== 4) throw new ContractError('backend image inspect readback is malformed', EXIT.IDENTITY);
  try { return { id: JSON.parse(parts[0]), repoDigests: JSON.parse(parts[1]), repoTags: JSON.parse(parts[2]), labels: JSON.parse(parts[3]) }; }
  catch { throw new ContractError('backend image inspect readback is invalid', EXIT.IDENTITY); }
}

function verifyLegacyImage(inspected, binding) {
  if (!inspected || inspected.id !== binding.imageId || !Array.isArray(inspected.repoDigests) ||
      !Array.isArray(inspected.repoTags) || inspected.repoTags.length !== 1 || inspected.repoTags[0] !== binding.uniqueTag || inspected.labels !== null) {
    throw new ContractError('legacy old backend image does not match the one-time fixed binding', EXIT.IDENTITY);
  }
  return { imageId: inspected.id, uniqueTag: binding.uniqueTag, ociLabelsAbsent: true };
}

function parseGreenContainer(stdout, containerId, binding) {
  const parts = stdout.trim().split('|');
  if (parts.length !== 4) throw new ContractError('current green container inspect is malformed', EXIT.IDENTITY);
  let imageId; let image; let labels; let status;
  try { [imageId, image, labels, status] = parts.map((item) => JSON.parse(item)); }
  catch { throw new ContractError('current green container inspect is invalid', EXIT.IDENTITY); }
  if (imageId !== binding.imageId || image !== binding.uniqueTag || status !== 'running' || labels?.['com.docker.compose.project'] !== 'booking-preprod' ||
      labels?.['com.docker.compose.service'] !== 'backend-green') {
    throw new ContractError('current green container is not the fixed legacy old release', EXIT.IDENTITY);
  }
  return { containerId, imageId };
}

function parseSchemaLog(stdout) {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  let value;
  try { value = JSON.parse(lines.at(-1) || ''); } catch { throw new ContractError('TypeORM schema log output is not JSON', EXIT.DATABASE); }
  const expectedKeys = ['database', 'downQueries', 'schema', 'upQueries', 'user'];
  if (!value || Object.keys(value).sort().join(',') !== expectedKeys.sort().join(',') ||
      value.schema !== 'booking.typeorm-schema-log/v1' || value.database !== PREPROD_DATABASE || value.user !== PREPROD_DATABASE_USER ||
      !Array.isArray(value.upQueries) || !Array.isArray(value.downQueries) ||
      value.upQueries.some((item) => typeof item !== 'string') || value.downQueries.some((item) => typeof item !== 'string')) {
    throw new ContractError('TypeORM schema log identity is invalid', EXIT.DATABASE);
  }
  if (value.upQueries.length !== 0 || value.downQueries.length !== 0) {
    throw new ContractError('old release does not have a zero schema diff', EXIT.DATABASE);
  }
  return value;
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
      if (error?.code === 'EEXIST') throw new ContractError('schema diff receipt path already exists', EXIT.DATABASE);
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

export async function generateSchemaDiffReceipt(args, runtime = {}) {
  for (const key of Object.keys(args)) if (!ALLOWED.has(key)) throw new ContractError(`unsupported argument: --${key}`, EXIT.DATABASE);
  if (args.execute !== 'true' || args.identity !== 'old' || args.slot !== 'green') {
    throw new ContractError('schema diff requires --execute true --identity old --slot green', EXIT.DATABASE);
  }
  if (!args.manifest || !args['receipt-path']) throw new ContractError('--manifest and --receipt-path are required', EXIT.DATABASE);

  const releaseRoot = await realpath(runtime.releaseRoot || PREPROD_RELEASE_ROOT).catch(() => { throw new ContractError('fixed booking-preprod release root is unavailable', EXIT.DATABASE); });
  const manifestPath = containedPath(releaseRoot, await realpath(args.manifest).catch(() => ''), 'manifest path');
  const manifest = validateReleaseManifest(await readJsonFile(manifestPath));
  const manifestDigest = await digestFile(manifestPath);
  const legacy = runtime.legacyBinding || LEGACY_OLD_BINDING;
  if (manifest.releaseId !== legacy.releaseId || manifest.source.gitSha !== legacy.gitSha || manifestDigest !== legacy.manifestRawDigest ||
      manifest.contracts.migration.catalogDigest !== legacy.migrationCatalogDigest || manifest.contracts.migration.expandFloor !== legacy.migrationFloor ||
      manifest.artifacts.backend.image !== legacy.manifestRepository || manifest.artifacts.backend.digest !== legacy.imageId) {
    throw new ContractError('manifest is not the one-time fixed legacy old release', EXIT.IDENTITY);
  }
  const receiptRoot = await trustedDirectory(runtime.receiptRoot || PREPROD_RECEIPT_ROOT, runtime);
  const receiptPath = containedPath(receiptRoot, args['receipt-path'], 'receipt path');
  const envFile = await assertTrustedEnvironmentFile(runtime.envFile || PREPROD_ENV_FILE, runtime);
  const docker = runtime.dockerExecutable || await findDocker();
  const runner = runtime.commandRunner || defaultCommandRunner;
  const timeoutMs = runtime.timeoutMs || 300_000;
  const imageReference = legacy.uniqueTag;

  const inspect = async () => {
    const result = await runner(docker, ['image', 'inspect', '--format', IMAGE_FORMAT, imageReference], { timeoutMs });
    assertSuccess(result, 'backend image inspect');
    return verifyLegacyImage(parseImageInspect(result.stdout), legacy);
  };
  const currentGreen = await runner(docker, ['ps', '--filter', 'label=com.docker.compose.project=booking-preprod',
    '--filter', 'label=com.docker.compose.service=backend-green', '--format', '{{.ID}}'], { timeoutMs });
  assertSuccess(currentGreen, 'current green container lookup');
  const greenIds = currentGreen.stdout.trim().split(/\r?\n/).filter(Boolean);
  if (greenIds.length !== 1 || !/^[0-9a-f]{12,64}$/.test(greenIds[0])) throw new ContractError('exactly one current green backend container is required', EXIT.IDENTITY);
  const greenInspect = await runner(docker, ['container', 'inspect', '--format', GREEN_CONTAINER_FORMAT, greenIds[0]], { timeoutMs });
  assertSuccess(greenInspect, 'current green container inspect');
  const greenEvidence = parseGreenContainer(greenInspect.stdout, greenIds[0], legacy);
  const before = await inspect();
  const containerName = `booking-preprod-schema-diff-${manifestDigest.slice(7, 19)}`;
  let schemaLog;
  let verified = false;
  try {
    const run = await runner(docker, ['run', '--name', containerName, '--network', PREPROD_DATA_NETWORK, '--env-file', envFile,
      '--read-only', '--tmpfs', '/tmp', '--tmpfs', '/app/logs', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '--env', 'NODE_ENV=preproduction', '--env', 'USE_POSTGRES=true', '--env', 'TYPEORM_SYNCHRONIZE=false',
      '--env', 'POSTGRES_HOST=postgres', '--env', 'POSTGRES_PORT=5432', '--env', `POSTGRES_USER=${PREPROD_DATABASE_USER}`,
      '--env', `POSTGRES_DB=${PREPROD_DATABASE}`, '--env', 'BOOKING_RUNTIME_ROLE=migration', '--env', 'BOOKING_WORKERS_ENABLED=false',
      '--env', 'ORDER_OUTBOX_DISPATCH_ENABLED=false', '--env', 'TELEGRAM_ENABLE_WEBHOOK=false', imageReference, 'node', '-e', SCHEMA_LOG_PROGRAM], { timeoutMs });
    assertSuccess(run, 'old-release TypeORM schema log');
    schemaLog = parseSchemaLog(run.stdout);

    const container = await runner(docker, ['container', 'inspect', '--format', '{{.Image}}', containerName], { timeoutMs });
    assertSuccess(container, 'schema diff container image inspect');
    if (container.stdout.trim() !== before.imageId) throw new ContractError('schema diff container does not use the manifest-bound backend image', EXIT.IDENTITY);
    const after = await inspect();
    if (after.imageId !== before.imageId) throw new ContractError('old backend release tag drifted during schema diff', EXIT.IDENTITY);
    verified = true;
  } finally {
    // docker run may outlive a killed client. Always force-remove the fixed-name
    // evidence container so a failed or timed-out attempt cannot poison retry.
    const removed = await runner(docker, ['container', 'rm', '--force', containerName], { timeoutMs });
    if (verified) assertSuccess(removed, 'schema diff container cleanup');
  }

  const receipt = {
    schema: 'booking.schema-diff-receipt/v1', environment: 'preproduction', database: PREPROD_DATABASE,
    databaseUser: PREPROD_DATABASE_USER, releaseId: manifest.releaseId, gitSha: manifest.source.gitSha, slot: 'green', manifestDigest,
    legacyManifestDigestMode: 'raw-bytes',
    migrationCatalogDigest: manifest.contracts.migration.catalogDigest, migrationFloor: manifest.contracts.migration.expandFloor,
    backendImage: imageReference, backendImageDigest: manifest.artifacts.backend.digest, backendImageId: before.imageId,
    legacyImageBinding: { scope: 'preproduction-old-green-only', manifestRepository: legacy.manifestRepository, uniqueTag: legacy.uniqueTag,
      ociLabelsAbsent: true, currentGreenContainerId: greenEvidence.containerId, currentGreenContainerImageBound: true },
    schemaLogDigest: sha256({ upQueries: schemaLog.upQueries, downQueries: schemaLog.downQueries }),
    schemaDiff: { upCount: 0, downCount: 0 }, observedAt: (runtime.now || (() => new Date()))().toISOString(),
    verification: { imageBound: true, containerImageBound: true, exactReadback: true },
  };
  await writeImmutableReceipt(receiptPath, receipt);
  return { receipt, receiptDigest: await digestFile(receiptPath), receiptPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await generateSchemaDiffReceipt(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ status: 'pass', receiptDigest: result.receiptDigest, schemaLogDigest: result.receipt.schemaLogDigest })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'fail', code: error instanceof ContractError ? 'SCHEMA_DIFF_REJECTED' : 'SCHEMA_DIFF_FAILED' })}\n`);
    process.exitCode = error instanceof ContractError ? error.exitCode : EXIT.DATABASE;
  }
}
