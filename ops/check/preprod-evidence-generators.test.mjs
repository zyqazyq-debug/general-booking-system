import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { generateDatabaseBackupReceipt } from '../release/generate-database-backup-receipt.mjs';
import { generateSchemaDiffReceipt } from '../release/generate-schema-diff-receipt.mjs';
import { sha256 } from '../release/lib/contracts.mjs';

const IMAGE_ID = `sha256:${'a'.repeat(64)}`;
const manifest = (releaseId = 'booking-20260908T180317Z-af88755036e1', gitSha = 'b'.repeat(40)) => ({
  schema: 'booking.release/v1', releaseId, source: { gitSha, treeState: 'clean' },
  artifacts: {
    backend: { image: 'booking/backend', digest: IMAGE_ID, sbomDigest: `sha256:${'1'.repeat(64)}`, provenanceDigest: `sha256:${'2'.repeat(64)}` },
    gateway: { image: 'booking/gateway', digest: `sha256:${'c'.repeat(64)}`, sbomDigest: `sha256:${'3'.repeat(64)}`,
      provenanceDigest: `sha256:${'4'.repeat(64)}`, frontendAssetDigest: `sha256:${'5'.repeat(64)}`, routeContractDigest: `sha256:${'6'.repeat(64)}` },
  },
  contracts: { configSchema: 'booking.config/v1', apiVersion: 'v1', frontendCompatibleApi: 'v1',
    migration: { expandFloor: '1788760000000-AddOrderCreatedConsumerIdempotency', catalogDigest: `sha256:${'7'.repeat(64)}`, compatibility: 'expand-contract' },
    rollbackCompatibleRelease: null },
  runtime: { nodeMajor: 20, targetPlatform: 'linux/amd64' }, probes: { live: '/livez', ready: '/readyz', version: '/__ops/version' },
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'booking-preprod-evidence-'));
  const releaseRoot = join(root, 'releases');
  const backupRoot = join(root, 'backups');
  const receiptRoot = join(root, 'receipts');
  const envFile = join(root, '.env');
  await Promise.all([mkdir(releaseRoot), mkdir(backupRoot), mkdir(receiptRoot)]);
  await writeFile(envFile, 'POSTGRES_PASSWORD=fixture-only\n', { mode: 0o600 });
  await chmod(envFile, 0o600);
  const addManifest = async (value) => {
    const directory = join(releaseRoot, value.releaseId);
    await mkdir(directory);
    const path = join(directory, 'release-manifest.json');
    await writeFile(path, `${JSON.stringify(value)}\n`);
    return path;
  };
  return { root, releaseRoot, backupRoot, receiptRoot, envFile, addManifest };
}

const ok = (stdout = '') => ({ exitCode: 0, signal: null, overflow: false, stdout, stderr: '' });

test('creates and independently binds one verified backup to explicit old/candidate identities', async () => {
  const f = await fixture();
  try {
    const old = manifest();
    const candidate = manifest('booking-20260909T010203Z-cdef12345678', 'c'.repeat(40));
    const oldPath = await f.addManifest(old);
    const candidatePath = await f.addManifest(candidate);
    const backupPath = join(f.backupRoot, 'pre-migration.dump');
    const oldReceiptPath = join(f.receiptRoot, 'old-backup.json');
    const calls = [];
    const runner = async (executable, argv, options) => {
      calls.push({ executable, argv: [...argv], options: { ...options } });
      assert.equal(typeof executable, 'string');
      assert.ok(Array.isArray(argv));
      if (argv.includes('psql')) return ok('booking_preprod|booking_preprod\n');
      if (argv.includes('pg_dump')) { await writeFile(options.outputPath, Buffer.from('PGDMP fixture')); return ok(); }
      if (argv.includes('pg_restore')) return ok('TABLE public.orders\n');
      throw new Error(`unexpected command ${argv.join(' ')}`);
    };
    const runtime = { releaseRoot: f.releaseRoot, backupRoot: f.backupRoot, receiptRoot: f.receiptRoot,
      allowNonRoot: true, dockerExecutable: '/trusted/docker', commandRunner: runner, legacyBinding: legacyFor(old), now: () => new Date('2026-09-09T02:00:00.000Z') };
    const created = await generateDatabaseBackupReceipt({ action: 'create', execute: 'true', identity: 'old', manifest: oldPath,
      'backup-path': backupPath, 'receipt-path': oldReceiptPath }, runtime);
    assert.equal(created.receipt.database, 'booking_preprod');
    assert.equal(created.receipt.databaseUser, 'booking_preprod');
    assert.equal(created.receipt.releaseId, old.releaseId);
    assert.equal(created.receipt.manifestDigestMode, 'raw-bytes');
    assert.equal(created.receipt.backupDigest, `sha256:${createHash('sha256').update('PGDMP fixture').digest('hex')}`);
    assert.ok(calls.find((call) => call.argv.includes('pg_dump'))?.argv.includes('--no-password'));
    assert.ok(calls.find((call) => call.argv.includes('pg_restore'))?.argv.includes('-i'));
    assert.ok(calls.every((call) => call.options.timeoutMs === 600_000));
    if (process.platform !== 'win32') assert.equal((await stat(oldReceiptPath)).mode & 0o077, 0);

    const candidateReceiptPath = join(f.receiptRoot, 'candidate-backup.json');
    const rebound = await generateDatabaseBackupReceipt({ action: 'bind-existing', execute: 'true', identity: 'candidate', manifest: candidatePath,
      'backup-path': backupPath, 'receipt-path': candidateReceiptPath, 'expected-backup-digest': created.receipt.backupDigest }, runtime);
    assert.equal(rebound.receipt.releaseId, candidate.releaseId);
    assert.equal(rebound.receipt.manifestDigestMode, 'canonical-json');
    assert.equal(rebound.receipt.backupDigest, created.receipt.backupDigest);
    assert.notEqual(rebound.receipt.manifestDigest, created.receipt.manifestDigest);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('backup failure removes only the partial object and bind-existing rejects a directory', async () => {
  const f = await fixture();
  try {
    const old = manifest();
    const manifestPath = await f.addManifest(old);
    const runtime = { releaseRoot: f.releaseRoot, backupRoot: f.backupRoot, receiptRoot: f.receiptRoot,
      allowNonRoot: true, dockerExecutable: '/trusted/docker', legacyBinding: legacyFor(old), commandRunner: async (_executable, argv, options) => {
        if (argv.includes('psql')) return ok('booking_preprod|booking_preprod\n');
        if (argv.includes('pg_dump')) { await writeFile(options.outputPath, 'partial'); return { ...ok(), exitCode: 1 }; }
        return ok('catalog\n');
      } };
    await assert.rejects(() => generateDatabaseBackupReceipt({ action: 'create', execute: 'true', identity: 'old', manifest: manifestPath,
      'backup-path': join(f.backupRoot, 'failed.dump'), 'receipt-path': join(f.receiptRoot, 'failed.json') }, runtime), /pg_dump failed/);
    assert.deepEqual(await readdir(f.backupRoot), []);
    const directoryBackup = join(f.backupRoot, 'not-a-file');
    await mkdir(directoryBackup);
    await assert.rejects(() => generateDatabaseBackupReceipt({ action: 'bind-existing', execute: 'true', identity: 'candidate', manifest: manifestPath,
      'backup-path': directoryBackup, 'receipt-path': join(f.receiptRoot, 'directory.json'), 'expected-backup-digest': `sha256:${'f'.repeat(64)}` }, runtime),
    /root-only regular file/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('backup generator fails closed on wrong database identity and does not invoke pg_dump', async () => {
  const f = await fixture();
  try {
    const old = manifest();
    const manifestPath = await f.addManifest(old);
    const calls = [];
    await assert.rejects(() => generateDatabaseBackupReceipt({ action: 'create', execute: 'true', identity: 'old', manifest: manifestPath,
      'backup-path': join(f.backupRoot, 'backup.dump'), 'receipt-path': join(f.receiptRoot, 'receipt.json') }, {
      releaseRoot: f.releaseRoot, backupRoot: f.backupRoot, receiptRoot: f.receiptRoot, allowNonRoot: true, dockerExecutable: '/trusted/docker',
      legacyBinding: legacyFor(old),
      commandRunner: async (_exe, argv) => { calls.push(argv); return ok('booking_prod|booking_prod\n'); },
    }), /database identity/);
    assert.equal(calls.some((argv) => argv.includes('pg_dump')), false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

function imageInspect(value = IMAGE_ID) {
  return `${JSON.stringify(value)}|[]|${JSON.stringify(['booking-preprod-backend:booking-20260908T180317Z-af88755036e1'])}|null\n`;
}

function legacyFor(value) {
  return { releaseId: value.releaseId, gitSha: value.source.gitSha,
    manifestRawDigest: `sha256:${createHash('sha256').update(`${JSON.stringify(value)}\n`).digest('hex')}`,
    migrationCatalogDigest: value.contracts.migration.catalogDigest, migrationFloor: value.contracts.migration.expandFloor,
    manifestRepository: value.artifacts.backend.image, imageId: value.artifacts.backend.digest,
    uniqueTag: `booking-preprod-backend:${value.releaseId}` };
}

const GREEN_ID = 'e'.repeat(64);
const greenInspect = (tag) => `${JSON.stringify(IMAGE_ID)}|${JSON.stringify(tag)}|${JSON.stringify({
  'com.docker.compose.project': 'booking-preprod', 'com.docker.compose.service': 'backend-green',
})}|"running"\n`;

test('emits zero schema-diff receipt only after image, container and database readback bind exactly', async () => {
  const f = await fixture();
  try {
    const old = manifest();
    const manifestPath = await f.addManifest(old);
    const receiptPath = join(f.receiptRoot, 'schema-diff.json');
    const calls = [];
    const legacy = legacyFor(old);
    const runner = async (_executable, argv, options) => {
      assert.equal(options.timeoutMs, 300_000);
      calls.push([...argv]);
      if (argv[0] === 'ps') return ok(`${GREEN_ID}\n`);
      if (argv[0] === 'image') return ok(imageInspect());
      if (argv[0] === 'run') return ok(JSON.stringify({ schema: 'booking.typeorm-schema-log/v1', database: 'booking_preprod', user: 'booking_preprod', upQueries: [], downQueries: [] }));
      if (argv[0] === 'container' && argv[1] === 'inspect' && argv.at(-1) === GREEN_ID) return ok(greenInspect(legacy.uniqueTag));
      if (argv[0] === 'container' && argv[1] === 'inspect') return ok(`${IMAGE_ID}\n`);
      if (argv[0] === 'container' && argv[1] === 'rm') return ok('removed\n');
      throw new Error(`unexpected command ${argv.join(' ')}`);
    };
    const result = await generateSchemaDiffReceipt({ execute: 'true', identity: 'old', slot: 'green', manifest: manifestPath, 'receipt-path': receiptPath }, {
      releaseRoot: f.releaseRoot, receiptRoot: f.receiptRoot, envFile: f.envFile, allowNonRoot: true,
      dockerExecutable: '/trusted/docker', commandRunner: runner, legacyBinding: legacy, now: () => new Date('2026-09-09T02:10:00.000Z'),
    });
    assert.equal(result.receipt.schemaDiff.upCount, 0);
    assert.equal(result.receipt.backendImageId, IMAGE_ID);
    assert.equal(result.receipt.databaseUser, 'booking_preprod');
    assert.deepEqual(result.receipt.verification, { imageBound: true, containerImageBound: true, exactReadback: true });
    assert.equal(result.receipt.legacyImageBinding.currentGreenContainerId, GREEN_ID);
    const run = calls.find((argv) => argv[0] === 'run');
    assert.ok(run.includes('--network') && run.includes('booking-preprod-data'));
    assert.ok(run.includes('POSTGRES_DB=booking_preprod'));
    assert.ok(run.includes('BOOKING_WORKERS_ENABLED=false'));
    assert.ok(calls.some((argv) => argv[0] === 'container' && argv[1] === 'rm'));
    assert.ok(calls.every((argv) => Array.isArray(argv)));
    if (process.platform !== 'win32') assert.equal((await stat(receiptPath)).mode & 0o077, 0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('schema-diff generator rejects nonzero diff and wrong runtime image without a receipt', async () => {
  for (const scenario of ['nonzero', 'wrong-image']) {
    const f = await fixture();
    try {
      const manifestPath = await f.addManifest(manifest());
      const value = manifest();
      const legacy = legacyFor(value);
      const receiptPath = join(f.receiptRoot, 'schema-diff.json');
      let oneShotInspect = false;
      let cleanupAttempted = false;
      const runner = async (_executable, argv) => {
        if (argv[0] === 'ps') return ok(`${GREEN_ID}\n`);
        if (argv[0] === 'image') return ok(imageInspect());
        if (argv[0] === 'run') return ok(JSON.stringify({ schema: 'booking.typeorm-schema-log/v1', database: 'booking_preprod', user: 'booking_preprod',
          upQueries: scenario === 'nonzero' ? ['ALTER TABLE x'] : [], downQueries: [] }));
        if (argv[0] === 'container' && argv[1] === 'inspect' && argv.at(-1) === GREEN_ID) return ok(greenInspect(legacy.uniqueTag));
        if (argv[0] === 'container' && argv[1] === 'inspect') { oneShotInspect = true; return ok(`sha256:${'d'.repeat(64)}\n`); }
        if (argv[0] === 'container' && argv[1] === 'rm') { cleanupAttempted = true; return ok(); }
        return ok();
      };
      await assert.rejects(() => generateSchemaDiffReceipt({ execute: 'true', identity: 'old', slot: 'green', manifest: manifestPath, 'receipt-path': receiptPath }, {
        releaseRoot: f.releaseRoot, receiptRoot: f.receiptRoot, envFile: f.envFile, allowNonRoot: true,
        dockerExecutable: '/trusted/docker', commandRunner: runner, legacyBinding: legacy,
      }), scenario === 'nonzero' ? /zero schema diff/ : /manifest-bound/);
      if (scenario === 'wrong-image') assert.equal(oneShotInspect, true);
      assert.equal(cleanupAttempted, true);
      await assert.rejects(() => readFile(receiptPath), /ENOENT/);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});
