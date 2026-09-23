#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalDocument, createReleaseManifest, releaseInputs } from './lib/artifacts.mjs';
import { ContractError, gateResult, parseArgs, sha256 } from './lib/contracts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.output) throw new ContractError('--output is required');
  const inputs = await releaseInputs(root, args);
  const rollbackCompatibleRelease = args['rollback-compatible-release'] || null;
  const manifest = createReleaseManifest({ ...inputs, rollbackCompatibleRelease });
  await writeFile(args.output, canonicalDocument(manifest), 'utf8');
  process.stdout.write(`${JSON.stringify(gateResult({ gate: 'immutable-release-artifacts', releaseId: manifest.releaseId, checks: [
    { name: 'clean-git-source', status: 'pass', code: 'GIT_CLEAN' },
    { name: 'artifact-identities', status: 'pass', code: 'DIGEST_BOUND' },
    { name: 'h5-and-route-contract', status: 'pass', code: 'H5_ROUTE_BOUND' },
    { name: 'migration-compatibility', status: 'pass', code: 'EXPAND_CONTRACT' },
    { name: 'manifest', status: 'pass', code: `MANIFEST_DIGEST_${sha256(manifest).slice(7, 19)}` },
  ] }))}\n`);
}

export async function run(argv = process.argv.slice(2)) {
  try { await main(argv); }
  catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 10;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
