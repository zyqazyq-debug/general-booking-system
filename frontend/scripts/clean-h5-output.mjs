import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(frontendRoot, 'dist', 'build', 'h5');
const expectedParent = resolve(frontendRoot, 'dist', 'build');

if (dirname(outputRoot) !== expectedParent || outputRoot === frontendRoot) {
  throw new Error(`refusing to clean unexpected H5 output: ${outputRoot}`);
}

await rm(outputRoot, { recursive: true, force: true });
process.stdout.write(`cleaned ${outputRoot}\n`);
