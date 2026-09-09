#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalDocument, cleanGitSource, createBuildInputInventory } from './lib/artifacts.mjs';
import { ContractError, gateResult, parseArgs } from './lib/contracts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
try {
  const args = parseArgs(process.argv.slice(2));
  const component = args.component;
  if (!['backend', 'gateway'].includes(component) || !args.output) throw new ContractError('--component (backend|gateway) and --output are required');
  const source = cleanGitSource(root);
  const document = await createBuildInputInventory(root, component, source.gitSha);
  await writeFile(args.output, canonicalDocument(document), 'utf8');
  process.stdout.write(`${JSON.stringify(gateResult({ gate: 'build-input-inventory', checks: [{ name: component, status: 'pass', code: 'BUILD_INPUT_INVENTORY_GENERATED' }] }))}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 10;
}
