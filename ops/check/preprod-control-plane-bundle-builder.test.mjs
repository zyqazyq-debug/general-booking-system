import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildControlPlaneBundle, FIXED_CONTROL_PLANE_SOURCES } from '../release/build-booking-preprod-control-plane-bundle.mjs';
import { inspectControlPlaneSourceArchive } from '../release/install-booking-preprod-control-plane.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXECUTABLE_SOURCES = new Set([
  'ops/release/run-booking-preprod-control-plane',
  'ops/release/run-booking-preprod-control-plane-installer',
  'ops/release/switch-preprod-ingress',
]);
function git(repo, args) { const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); }

async function committedFixture() {
  const root = await mkdtemp(join(tmpdir(), 'booking-bundle-builder-')); git(root, ['init']); git(root, ['config', 'user.email', 'builder@example.invalid']); git(root, ['config', 'user.name', 'Bundle Test']);
  const runningInstaller = await readFile(join(project, 'ops', 'release', 'install-booking-preprod-control-plane.mjs'));
  for (const sourcePath of FIXED_CONTROL_PLANE_SOURCES) {
    const path = join(root, ...sourcePath.split('/')); await mkdir(dirname(path), { recursive: true });
    const executable = EXECUTABLE_SOURCES.has(sourcePath);
    const bytes = sourcePath === 'ops/release/install-booking-preprod-control-plane.mjs' ? runningInstaller
      : executable ? Buffer.from('#!/bin/sh\nexit 0\n')
      : Buffer.from(`export const fixture = ${JSON.stringify(sourcePath)};\n`);
    await writeFile(path, bytes); await chmod(path, executable ? 0o755 : 0o644);
  }
  git(root, ['add', '--', ...FIXED_CONTROL_PLANE_SOURCES]);
  for (const sourcePath of EXECUTABLE_SOURCES) git(root, ['update-index', '--chmod=+x', '--', sourcePath]);
  for (const sourcePath of EXECUTABLE_SOURCES) assert.match(git(root, ['ls-files', '--stage', '--', sourcePath]), /^100755 /);
  git(root, ['commit', '-m', 'exact reviewed control plane']);
  return { root, sha: git(root, ['rev-parse', 'HEAD']), outputRoot: join(root, '.g4', 'build') };
}
const builderRuntime = (f) => ({ repoRoot: f.root, outputRoot: f.outputRoot });

test('builder self-validation keeps installer and migration mutex artifacts under one isolated parent', async () => {
  const source = await readFile(join(project, 'ops', 'release', 'build-booking-preprod-control-plane-bundle.mjs'), 'utf8');
  assert.match(source, /migrationLockPath:\s*join\(installParent, '\.happybooking-legacy-active-migration\.lock'\)/);
  assert.match(source, /migrationJournalPath:\s*join\(installParent, '\.happybooking-legacy-active-migration\.journal\.json'\)/);
});

test('builder uses exact clean HEAD committed bytes and emits an installer-verified approval tuple', { skip: process.platform === 'win32' }, async (t) => {
  const f = await committedFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const installId = `booking-control-20260913T010203Z-${f.sha.slice(0, 12)}`; const approvalId = 'approval.g4.control-plane.test';
  const result = await buildControlPlaneBundle(['--git-sha', f.sha, '--install-id', installId, '--approval-id', approvalId], builderRuntime(f));
  assert.equal(result.tuple.status, 'awaiting-independent-approval'); assert.equal(result.tuple.gitSha, f.sha); assert.equal(result.tuple.declarationDigest, result.declarationDigest);
  assert.match(result.tuple.bootstrapInstallerLauncherDigest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(result.declaration.archiveCommand, ['git', 'archive', '--format=tar', '--prefix=source/', f.sha, '--', ...FIXED_CONTROL_PLANE_SOURCES]);
  const archive = await readFile(join(result.bundlePath, 'source-archive.tar')); const inspected = inspectControlPlaneSourceArchive(archive, f.sha);
  assert.deepEqual(inspected.entries.filter((entry) => entry.type === 'file').map((entry) => entry.path).sort(), [...FIXED_CONTROL_PLANE_SOURCES]);
  assert.equal(JSON.parse(await readFile(result.approvalTuplePath, 'utf8')).tupleDigest, result.tuple.tupleDigest);
});

test('builder rejects refs/replace even though every Git object read disables replacement objects', async (t) => {
  const f = await committedFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  git(f.root, ['commit', '--allow-empty', '-m', 'review marker']); const head = git(f.root, ['rev-parse', 'HEAD']); const prior = git(f.root, ['rev-parse', 'HEAD^']);
  git(f.root, ['replace', head, prior]);
  await assert.rejects(buildControlPlaneBundle(['--git-sha', head, '--install-id', `booking-control-20260913T010203Z-${head.slice(0, 12)}`, '--approval-id', 'approval.g4.test'],
    builderRuntime(f)), /replacement refs are forbidden/);
});

test('builder strips inherited Git repository and object database redirection variables', { skip: process.platform === 'win32' }, async (t) => {
  const f = await committedFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE, GIT_OBJECT_DIRECTORY: process.env.GIT_OBJECT_DIRECTORY, GIT_ALTERNATE_OBJECT_DIRECTORIES: process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES };
  Object.assign(process.env, { GIT_DIR: join(f.root, 'missing-git-dir'), GIT_WORK_TREE: join(f.root, 'wrong-tree'), GIT_OBJECT_DIRECTORY: join(f.root, 'wrong-objects'), GIT_ALTERNATE_OBJECT_DIRECTORIES: join(f.root, 'wrong-alternates') });
  try {
    const installId = `booking-control-20260913T010204Z-${f.sha.slice(0, 12)}`;
    const result = await buildControlPlaneBundle(['--git-sha', f.sha, '--install-id', installId, '--approval-id', 'approval.g4.env-test'], builderRuntime(f));
    assert.equal(result.tuple.gitSha, f.sha);
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('builder refuses a non-HEAD SHA, dirty fixed source and an already published bundle', async (t) => {
  const f = await committedFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const installId = `booking-control-20260913T010203Z-${f.sha.slice(0, 12)}`; const args = ['--git-sha', f.sha, '--install-id', installId, '--approval-id', 'approval.g4.test'];
  await writeFile(join(f.root, 'ops', 'release', 'manage-deploy-state.mjs'), 'export const dirty=true;\n');
  await assert.rejects(buildControlPlaneBundle(args, builderRuntime(f)), /source set is dirty/);
  git(f.root, ['checkout', '--', 'ops/release/manage-deploy-state.mjs']);
  await assert.rejects(buildControlPlaneBundle(['--git-sha', '0'.repeat(40), '--install-id', `booking-control-20260913T010203Z-${'0'.repeat(12)}`, '--approval-id', 'approval.g4.test'], builderRuntime(f)), /exact clean HEAD/);
  if (process.platform === 'win32') {
    await assert.rejects(buildControlPlaneBundle(args, builderRuntime(f)), /POSIX filesystem/);
    await assert.rejects(access(f.outputRoot), /ENOENT/);
    return;
  }
  await buildControlPlaneBundle(args, builderRuntime(f));
  await assert.rejects(buildControlPlaneBundle(args, builderRuntime(f)), /EEXIST|exist/i);
});

test('production builder rejects Windows before creating a misleading published bundle', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await committedFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const installId = `booking-control-20260913T010205Z-${f.sha.slice(0, 12)}`;
  await assert.rejects(buildControlPlaneBundle(['--git-sha', f.sha, '--install-id', installId, '--approval-id', 'approval.g4.posix-only'],
    { repoRoot: f.root, outputRoot: f.outputRoot }), /POSIX filesystem/);
  await assert.rejects(access(f.outputRoot), /ENOENT/);
});

test('tuple and pre-publication failures leave no final bundle, tuple, staging, or validation artifact', { skip: process.platform === 'win32' }, async (t) => {
  for (const checkpoint of ['tuple:linked', 'bundle:before-publish']) {
    const f = await committedFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
    const installId = `booking-control-20260913T010206Z-${f.sha.slice(0, 12)}`; const tuple = join(f.outputRoot, 'approval-tuples', `${installId}.json`);
    await assert.rejects(buildControlPlaneBundle(['--git-sha', f.sha, '--install-id', installId, '--approval-id', 'approval.g4.atomic-publication'], {
      ...builderRuntime(f), checkpoint: async (value) => { if (value === checkpoint) throw new Error(`injected ${checkpoint}`); },
    }), new RegExp(`injected ${checkpoint.replace(':', '\\:')}`));
    await assert.rejects(access(join(f.outputRoot, 'bundles', installId)), /ENOENT/); await assert.rejects(access(tuple), /ENOENT/);
    assert.equal((await readdir(f.outputRoot)).some((name) => name.startsWith('.bundle-') || name.startsWith('.validation-')), false);
  }
});
