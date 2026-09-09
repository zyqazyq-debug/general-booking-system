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
  if (!['backend', 'gateway', 'telegram-egress'].includes(component) || !args.output) throw new ContractError('--component (backend|gateway|telegram-egress) and --output are required');
  const source = cleanGitSource(root);
  const aptSources = component === 'telegram-egress' ? {
    debianMirror: args['debian-mirror'], securityMirror: args['security-mirror'],
  } : null;
  if (component !== 'telegram-egress' && (args['base-image'] || args['debian-mirror'] || args['security-mirror'])) {
    throw new ContractError('base image and APT source parameters are valid only for telegram-egress');
  }
  const document = await createBuildInputInventory(root, component, source.gitSha, {
    baseImage: args['base-image'] || null, aptSources,
  });
  await writeFile(args.output, canonicalDocument(document), 'utf8');
  process.stdout.write(`${JSON.stringify(gateResult({ gate: 'build-input-inventory', checks: [{ name: component, status: 'pass', code: 'BUILD_INPUT_INVENTORY_GENERATED' }] }))}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 10;
}
