import { readdir, rm } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(frontendRoot, 'dist', 'build', 'h5');
if (relative(frontendRoot, outputRoot).replaceAll('\\', '/') !== 'dist/build/h5') {
  throw new Error('refusing to strip source maps outside the exact H5 output');
}

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else files.push(child);
  }
  return files;
}

const maps = (await walk(outputRoot)).filter((path) => extname(path) === '.map');
if (maps.length === 0) {
  throw new Error('refusing to strip: no audited source maps were found');
}
for (const path of maps) await rm(path, { force: false, recursive: false });
const remaining = (await walk(outputRoot)).filter(
  (path) => extname(path) === '.map',
);
if (remaining.length > 0) throw new Error('source map stripping was incomplete');
process.stdout.write(`H5_SOURCE_MAPS_STRIPPED count=${maps.length}\n`);
