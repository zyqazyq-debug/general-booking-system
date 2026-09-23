#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function main() {
  process.stderr.write('generate-sbom.mjs is disabled: source inputs are not an image SBOM. Use generate-build-input-inventory.mjs for source evidence and generate-image-sbom.mjs for a real booking.image-sbom/v2 image scan.\n');
  return 10;
}

export function run() {
  process.exitCode = main();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
