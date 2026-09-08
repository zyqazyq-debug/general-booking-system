#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalDocument, cleanGitSource, digestFile } from './lib/artifacts.mjs';
import { ContractError, gateResult, parseArgs } from './lib/contracts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
try {
  const args = parseArgs(process.argv.slice(2));
  const component = args.component;
  if (!['backend', 'gateway'].includes(component) || !args.output) throw new ContractError('--component (backend|gateway) and --output are required');
  const source = cleanGitSource(root);
  const inputs = component === 'backend'
    ? ['backend/Dockerfile', 'backend/package.json', 'backend/package-lock.json']
    : ['frontend/Dockerfile', 'frontend/nginx.release.conf.template', 'frontend/package.json', 'frontend/package-lock.json'];
  const files = [];
  for (const path of inputs) files.push({ path, digest: await digestFile(resolve(root, path)) });
  const document = { schema: 'booking.local-sbom/v1', component, source: { gitSha: source.gitSha }, files };
  await writeFile(args.output, canonicalDocument(document), 'utf8');
  process.stdout.write(`${JSON.stringify(gateResult({ gate: 'local-sbom', checks: [{ name: component, status: 'pass', code: 'SBOM_GENERATED' }] }))}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 10;
}
