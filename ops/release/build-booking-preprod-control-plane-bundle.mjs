#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectControlPlaneInventory, runControlPlaneInstaller } from './install-booking-preprod-control-plane.mjs';

const GIT_SHA = /^[0-9a-f]{40}$/;
const INSTALL_ID = /^booking-control-[0-9]{8}T[0-9]{6}Z-([0-9a-f]{12})$/;
const APPROVAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

async function freezePayloadTree(root) {
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) if (entry.isDirectory()) await walk(join(directory, entry.name));
    await chmod(directory, 0o555); const handle = await open(directory, 'r'); try { await handle.sync(); } finally { await handle.close(); }
  }
  await walk(root);
}

export const FIXED_CONTROL_PLANE_SOURCES = Object.freeze([
  'ops/release/attest-registry-evidence.mjs',
  'ops/release/build-booking-preprod-control-plane-bundle.mjs',
  'ops/release/execute-fenced-action.mjs',
  'ops/release/generate-build-input-inventory.mjs',
  'ops/release/generate-database-backup-receipt.mjs',
  'ops/release/generate-image-sbom.mjs',
  'ops/release/generate-manifest.mjs',
  'ops/release/generate-provenance.mjs',
  'ops/release/generate-sbom.mjs',
  'ops/release/generate-schema-diff-receipt.mjs',
  'ops/release/install-booking-preprod-control-plane.mjs',
  'ops/release/legacy-preprod-rollback.compose.yml',
  'ops/release/lib/artifacts.mjs',
  'ops/release/lib/contracts.mjs',
  'ops/release/lib/deploy-state-store.mjs',
  'ops/release/lib/evidence-deploy-binding.mjs',
  'ops/release/lib/external-action-contract.mjs',
  'ops/release/lib/fenced-resource-store.mjs',
  'ops/release/lib/legacy-preprod.mjs',
  'ops/release/lib/registry-attestation.mjs',
  'ops/release/lib/registry-runtime-gate.mjs',
  'ops/release/lib/state-machine.mjs',
  'ops/release/manage-deploy-state.mjs',
  'ops/release/manage-preprod-singletons.mjs',
  'ops/release/migrate-booking-preprod-legacy-active-root.mjs',
  'ops/release/probe-fenced-business.mjs',
  'ops/release/probe-fenced-candidate.mjs',
  'ops/release/probe-fenced-public.mjs',
  'ops/release/recover-stale-fencing-lock.mjs',
  'ops/release/run-booking-preprod-control-plane',
  'ops/release/run-booking-preprod-control-plane-installer',
  'ops/release/switch-preprod-ingress',
  'ops/release/switch-preprod-ingress.mjs',
  'ops/release/validate-artifacts.mjs',
  'ops/release/validate-compose.mjs',
  'ops/release/validate-release.mjs',
  'ops/release/validate-transition.mjs',
  'ops/release/verify-telegram-egress.mjs',
].sort());

const ROOT_COPIES = new Map([
  ['ops/release/run-booking-preprod-control-plane', 'run-booking-preprod-control-plane'],
  ['ops/release/switch-preprod-ingress', 'switch-preprod-ingress'],
  ['ops/release/switch-preprod-ingress.mjs', 'switch-preprod-ingress.mjs'],
]);

function cleanGitEnvironment(input = process.env) {
  const output = {};
  for (const [key, value] of Object.entries(input)) if (!key.toUpperCase().startsWith('GIT_') && value !== undefined) output[key] = value;
  const nullConfig = process.platform === 'win32' ? 'NUL' : '/dev/null';
  return { ...output, GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: nullConfig, GIT_CONFIG_SYSTEM: nullConfig };
}
function git(repoRoot, args, encoding = 'utf8') {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding, env: cleanGitEnvironment(), maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout;
}
async function exists(path) { try { await lstat(path); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } }

function parseArgs(argv) {
  if (argv.length !== 6) throw new Error('expected --git-sha, --install-id and --approval-id');
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--git-sha', '--install-id', '--approval-id'].includes(argv[i]) || values[argv[i]]) throw new Error('unsupported or duplicate option');
    values[argv[i]] = argv[i + 1];
  }
  const sha = values['--git-sha']; const installId = values['--install-id']; const approvalId = values['--approval-id'];
  if (!GIT_SHA.test(sha || '') || !INSTALL_ID.test(installId || '') || INSTALL_ID.exec(installId)[1] !== sha.slice(0, 12) || !APPROVAL_ID.test(approvalId || '')) throw new Error('bundle identity is invalid');
  return { sha, installId, approvalId };
}

async function writeCommittedFile(repoRoot, sha, sourcePath, destination) {
  const tree = git(repoRoot, ['ls-tree', sha, '--', sourcePath]).trim();
  const [metadata, listedPath] = tree.split('\t'); const [mode, type] = (metadata || '').split(' ');
  if (listedPath !== sourcePath || type !== 'blob' || !['100644', '100755'].includes(mode)) throw new Error(`fixed source is not a committed regular file: ${sourcePath}`);
  const bytes = git(repoRoot, ['show', `${sha}:${sourcePath}`], null);
  await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes); await chmod(destination, mode === '100755' ? 0o555 : 0o444);
}

export async function buildControlPlaneBundle(argv, runtime = {}) {
  const { sha, installId, approvalId } = parseArgs(argv);
  const repoRoot = resolve(runtime.repoRoot || join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const outputRoot = resolve(runtime.outputRoot || join(repoRoot, '.g4', 'control-plane-bundle-build'));
  if (git(repoRoot, ['rev-parse', 'HEAD']).trim() !== sha) throw new Error('Git SHA must be the exact clean HEAD');
  if (git(repoRoot, ['replace', '-l']).trim()) throw new Error('Git replacement refs are forbidden');
  if (git(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all', '--', ...FIXED_CONTROL_PLANE_SOURCES]).trim()) throw new Error('fixed control-plane source set is dirty');
  const tracked = git(repoRoot, ['ls-tree', '-r', '--name-only', sha, '--', ...FIXED_CONTROL_PLANE_SOURCES]).trim().split(/\r?\n/).filter(Boolean).sort();
  if (canonical(tracked) !== canonical(FIXED_CONTROL_PLANE_SOURCES)) throw new Error('fixed control-plane source allowlist is not exactly committed');
  if (process.platform === 'win32') throw new Error('control-plane bundle must be built on a POSIX filesystem');

  const finalRoot = join(outputRoot, 'bundles', installId); const stagingParent = join(outputRoot, `.bundle-${installId}.${process.pid}.tmp`);
  const staging = join(stagingParent, installId); const validationRoot = join(outputRoot, `.validation-${installId}`);
  const tuplePath = join(outputRoot, 'approval-tuples', `${installId}.json`); let tuplePublishedIdentity = null; let tupleBytes = null;
  if (await exists(finalRoot) || await exists(tuplePath)) throw new Error('immutable bundle or approval tuple already exists');
  await mkdir(outputRoot, { recursive: true }); await rm(stagingParent, { recursive: true, force: true }); await rm(validationRoot, { recursive: true, force: true });
  await mkdir(join(staging, 'payload'), { recursive: true });
  try {
    const payloadMap = [];
    for (const sourcePath of FIXED_CONTROL_PLANE_SOURCES) {
      const payloadPath = `control-plane/${sourcePath}`; await writeCommittedFile(repoRoot, sha, sourcePath, join(staging, 'payload', ...payloadPath.split('/'))); payloadMap.push({ payloadPath, sourcePath });
      if (ROOT_COPIES.has(sourcePath)) { const rootPath = ROOT_COPIES.get(sourcePath); await writeCommittedFile(repoRoot, sha, sourcePath, join(staging, 'payload', rootPath)); payloadMap.push({ payloadPath: rootPath, sourcePath }); }
    }
    payloadMap.sort((a, b) => a.payloadPath < b.payloadPath ? -1 : a.payloadPath > b.payloadPath ? 1 : 0);
    const installerBytes = git(repoRoot, ['show', `${sha}:ops/release/install-booking-preprod-control-plane.mjs`], null);
    await writeFile(join(staging, 'installer.mjs'), installerBytes); await chmod(join(staging, 'installer.mjs'), 0o555);
    const archiveCommand = ['git', 'archive', '--format=tar', '--prefix=source/', sha, '--', ...FIXED_CONTROL_PLANE_SOURCES];
    const archive = git(repoRoot, archiveCommand.slice(1), null);
    const mirrorParent = await mkdtemp(join(tmpdir(), 'booking-control-plane-git-proof-')); const mirror = join(mirrorParent, 'repo');
    try {
      git(mirrorParent, ['clone', '--quiet', '--no-hardlinks', '--no-local', repoRoot, mirror]);
      if (git(mirror, ['rev-parse', 'HEAD']).trim() !== sha || git(mirror, ['replace', '-l']).trim()) throw new Error('independent Git clone identity differs');
      const mirrorArchive = git(mirror, archiveCommand.slice(1), null); if (!archive.equals(mirrorArchive)) throw new Error('independent Git archive differs');
      for (const sourcePath of FIXED_CONTROL_PLANE_SOURCES) {
        if (!git(repoRoot, ['show', `${sha}:${sourcePath}`], null).equals(git(mirror, ['show', `${sha}:${sourcePath}`], null))) throw new Error(`independent committed object differs: ${sourcePath}`);
      }
    } finally { await rm(mirrorParent, { recursive: true, force: true }); }
    await writeFile(join(staging, 'source-archive.tar'), archive); await chmod(join(staging, 'source-archive.tar'), 0o444);
    await freezePayloadTree(join(staging, 'payload'));
    const inventory = await inspectControlPlaneInventory(join(staging, 'payload'), { uid: null, strict: true, enforceMode: true });
    const trackedFiles = inventory.entries.filter((entry) => entry.type === 'file').map((entry) => entry.path).sort();
    const declaration = { schema: 'booking.preprod-control-plane-bundle/v1', installId, gitSha: sha, approvalId,
      sourceArchiveDigest: digest(archive), installerDigest: digest(installerBytes), inventoryDigest: inventory.digest,
      trackedAllowlistDigest: digest(canonical(trackedFiles)), trackedFiles, payloadMap, payloadMapDigest: digest(canonical(payloadMap)),
      archiveCommand, archiveCommandDigest: digest(canonical(archiveCommand)) };
    await writeFile(join(staging, 'bundle-declaration.json'), `${canonical(declaration)}\n`); await chmod(join(staging, 'bundle-declaration.json'), 0o444);
    const receiptRoot = join(validationRoot, 'receipts'); const installParent = join(validationRoot, 'libexec');
    await mkdir(receiptRoot, { recursive: true }); await mkdir(installParent, { recursive: true });
    const verified = await runControlPlaneInstaller(['--action', 'inventory', '--install-id', installId, '--git-sha', sha, '--approval-id', approvalId], {
      paths: { installRoot: join(installParent, 'happybooking'), rollbackRoot: join(installParent, 'happybooking.rollback'), bundleRoot: stagingParent, receiptRoot,
        lockPath: join(installParent, '.happybooking-control-plane-install.lock'), journalPath: join(installParent, '.happybooking-control-plane-install.journal.json'),
        migrationLockPath: join(installParent, '.happybooking-legacy-active-migration.lock'),
        migrationJournalPath: join(installParent, '.happybooking-legacy-active-migration.journal.json'),
        deployStatePath: join(validationRoot, 'deploy-state.json') },
      expectedUid: null, enforceMode: true, assertQuiescent: async () => {}, assertNotMountpoints: async () => {}, syncDirectory: async () => {}, syncFile: async () => {},
    });
    await rm(validationRoot, { recursive: true, force: true });
    const declarationDigest = digest(canonical(declaration));
    if (verified.declarationDigest !== declarationDigest || verified.inventoryDigest !== inventory.digest) throw new Error('installer self-validation disagrees with bundle builder');
    const bootstrapInstallerLauncherDigest = digest(git(repoRoot, [`show`, `${sha}:ops/release/run-booking-preprod-control-plane-installer`], null));
    const tupleBody = { schema: 'booking.preprod-control-plane-approval-tuple/v1', status: 'awaiting-independent-approval', installId, gitSha: sha, approvalId,
      archiveCommand, archiveCommandDigest: declaration.archiveCommandDigest, sourceArchiveDigest: declaration.sourceArchiveDigest,
      payloadMapDigest: declaration.payloadMapDigest, inventoryDigest: declaration.inventoryDigest, installerDigest: declaration.installerDigest,
      bootstrapInstallerLauncherDigest, declarationDigest };
    const tuple = { ...tupleBody, tupleDigest: digest(canonical(tupleBody)) }; tupleBytes = `${canonical(tuple)}\n`; const tupleTemporary = join(stagingParent, 'approval-tuple.json');
    await writeFile(tupleTemporary, tupleBytes, { flag: 'wx', mode: 0o444 }); await chmod(tupleTemporary, 0o444);
    if ((await readFile(tupleTemporary, 'utf8')) !== tupleBytes) throw new Error('approval tuple readback differs before bundle publication');
    await mkdir(dirname(tuplePath), { recursive: true }); await link(tupleTemporary, tuplePath); tuplePublishedIdentity = await lstat(tuplePath);
    if ((await readFile(tuplePath, 'utf8')) !== tupleBytes) throw new Error('published approval tuple readback differs before bundle publication');
    await runtime.checkpoint?.('tuple:linked'); await runtime.checkpoint?.('bundle:before-publish');
    await mkdir(dirname(finalRoot), { recursive: true }); await rename(staging, finalRoot); await rm(stagingParent, { recursive: true, force: true }).catch(() => {});
    return { bundlePath: finalRoot, approvalTuplePath: tuplePath, declaration, declarationDigest, tuple };
  } catch (error) {
    await Promise.allSettled([rm(stagingParent, { recursive: true, force: true }), rm(validationRoot, { recursive: true, force: true })]);
    if (tuplePublishedIdentity) {
      try {
        const current = await lstat(tuplePath);
        if (current.dev === tuplePublishedIdentity.dev && current.ino === tuplePublishedIdentity.ino && (await readFile(tuplePath, 'utf8')) === tupleBytes) await rm(tuplePath);
      } catch {}
    }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${canonical(await buildControlPlaneBundle(process.argv.slice(2)))}\n`); }
  catch (error) { process.stderr.write(`control-plane bundle build rejected: ${error.message}\n`); process.exitCode = 64; }
}
