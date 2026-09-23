import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const modules = [
  '../release/probe-fenced-candidate.mjs',
  '../release/validate-artifacts.mjs',
  '../release/validate-release.mjs',
  '../release/validate-transition.mjs',
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

test('control-plane CLI modules import without output or exitCode side effects', () => {
  const program = `
    import { pathToFileURL } from 'node:url';
    for (const path of process.argv.slice(2)) await import(pathToFileURL(path).href);
    process.stdout.write(JSON.stringify({ exitCode: process.exitCode ?? null }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', program, 'import-smoke', ...modules], { encoding: 'utf8' });

  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, '{"exitCode":null}');
});

test('direct execution retains each CLI failure channel and exit status', () => {
  const [candidate, artifacts, release, transition] = modules.map((path) =>
    spawnSync(process.execPath, [path], { encoding: 'utf8' }));

  assert.equal(candidate.status, 30);
  assert.equal(candidate.stderr, '');
  assert.deepEqual(JSON.parse(candidate.stdout), {
    status: 'fail',
    code: 'CANDIDATE_READBACK_REJECTED',
    detail: 'candidate readback arguments are incomplete',
  });

  assert.equal(artifacts.status, 10);
  assert.equal(artifacts.stdout, '');
  assert.equal(artifacts.stderr, '--manifest is required\n');

  assert.equal(release.status, 10);
  assert.equal(release.stderr, '');
  assert.equal(JSON.parse(release.stdout).checks[0].detail, '--manifest is required');

  assert.equal(transition.status, 10);
  assert.equal(transition.stderr, '');
  assert.equal(JSON.parse(transition.stdout).checks[0].detail, '--state, --to, and --static-only true are required');
});
