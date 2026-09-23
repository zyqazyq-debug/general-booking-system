#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReleaseManifest, releaseInputs } from './lib/artifacts.mjs';
import { ContractError, gateResult, parseArgs, readJsonFile, sha256 } from './lib/contracts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.manifest) throw new ContractError('--manifest is required');
    const manifest = await readJsonFile(args.manifest);
    const expected = createReleaseManifest({ ...await releaseInputs(root, args), rollbackCompatibleRelease: manifest.contracts?.rollbackCompatibleRelease ?? null });
    if (sha256(manifest) !== sha256(expected)) throw new ContractError('manifest differs from the clean source and declared immutable artifacts');
    process.stdout.write(`${JSON.stringify(gateResult({ gate: 'immutable-release-artifacts', releaseId: manifest.releaseId, checks: [{ name: 'recomputed-identity', status: 'pass', code: 'ARTIFACTS_REPRODUCIBLE' }] }))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 10;
  }
}
