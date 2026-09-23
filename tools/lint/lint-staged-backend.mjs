import { spawnSync } from 'node:child_process';
import { resolve, relative, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const backendRoot = join(root, 'backend');
const staged = spawnSync('git', ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], {
  cwd: root,
  encoding: 'utf8',
});
if (staged.status !== 0 || staged.error) {
  process.stderr.write('Unable to enumerate staged backend files.\n');
  process.exit(1);
}

const files = staged.stdout.split('\0').filter((path) => /^backend\/.*\.(?:js|ts)$/.test(path)).map((path) => {
  const inside = relative(backendRoot, resolve(root, path));
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`)) {
    throw new Error('Staged backend path escapes the backend directory');
  }
  return inside;
});

if (files.length > 0) {
  const eslint = join(backendRoot, 'node_modules', 'eslint', 'bin', 'eslint.js');
  const result = spawnSync(process.execPath, [eslint, '--no-fix', '--quiet', '--', ...files], {
    cwd: backendRoot,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
