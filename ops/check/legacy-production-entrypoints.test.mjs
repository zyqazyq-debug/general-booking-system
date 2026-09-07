import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const entries = [
  { path: 'ops/deploy-prod.ps1', marker: 'LEGACY_PRODUCTION_DEPLOYMENT_DISABLED' },
  { path: 'tools/ops/deploy-prod.ps1', marker: 'LEGACY_PRODUCTION_DEPLOYMENT_DISABLED' },
  { path: 'ops/stop-prod.ps1', marker: 'LEGACY_PRODUCTION_STOP_DISABLED' },
  { path: 'tools/ops/stop-prod.ps1', marker: 'LEGACY_PRODUCTION_STOP_DISABLED' },
];

test('legacy production entrypoints are parser-safe local fail-closed stubs', async () => {
  for (const entry of entries) {
    const absolutePath = resolve(root, entry.path);
    const source = await readFile(absolutePath, 'utf8');
    assert.match(source, /^\[CmdletBinding\(\)\]\s*\r?\nparam\(/);
    assert.match(source, new RegExp(entry.marker));
    assert.match(source, /exit 80/);
    assert.doesNotMatch(source, /\bssh\b|\bdocker\b|\btar\b|\brm\b|192\.168\./i);

    const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-File', absolutePath], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.error, undefined, `${entry.path} should launch PowerShell`);
    assert.equal(result.status, 80, `${entry.path} must fail closed with exit 80`);
    assert.match(`${result.stdout}${result.stderr}`, new RegExp(entry.marker));
  }
});
