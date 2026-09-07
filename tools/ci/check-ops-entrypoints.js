const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function checkRootEntrypoints() {
  const metadata = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
  );
  const missing = [];
  for (const [name, command] of Object.entries(metadata.scripts || {})) {
    const references = String(command).matchAll(
      /(?:node|File)\s+([.]?[\\/][A-Za-z0-9_.\\/-]+)/g,
    );
    for (const match of references) {
      const target = path.resolve(repoRoot, match[1]);
      if (!fs.existsSync(target)) missing.push(`${name}: ${match[1]}`);
    }
  }
  if (missing.length) {
    throw new Error(`root script entrypoints are missing:\n${missing.join('\n')}`);
  }
}

function checkPowerShellSyntax() {
  const scripts = [
    ...walk(path.join(repoRoot, 'ops')),
    ...walk(path.join(repoRoot, 'tools', 'ops')),
  ].filter((file) => file.toLowerCase().endsWith('.ps1'));
  if (!scripts.length) throw new Error('no PowerShell ops scripts found');
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const result = spawnSync(
    shell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      path.join(repoRoot, 'tools/lint/Test-PowerShellSyntax.ps1'),
      ...scripts,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stdout || '') + (result.stderr || ''));
  }
  process.stdout.write(result.stdout || '');
}

try {
  checkRootEntrypoints();
  checkPowerShellSyntax();
  console.log('[ops-entrypoints] PASS');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
