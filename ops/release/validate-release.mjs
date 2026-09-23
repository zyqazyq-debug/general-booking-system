#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ContractError, EXIT, gateResult, parseArgs, readJsonFile, validateReleaseManifest } from './lib/contracts.mjs';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let exitCode = EXIT.PASS;
  let output;
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.manifest) throw new ContractError('--manifest is required');
    const manifest = await readJsonFile(args.manifest);
    validateReleaseManifest(manifest);
    output = gateResult({
      gate: 'release-contract',
      releaseId: manifest.releaseId,
      checks: [{ name: 'manifest', status: 'pass', code: 'MANIFEST_VALID' }],
    });
  } catch (error) {
    const failure = error instanceof ContractError ? error : new ContractError('unexpected validation failure');
    exitCode = failure.exitCode;
    output = gateResult({
      gate: 'release-contract',
      checks: [{ name: 'manifest', status: 'fail', code: 'MANIFEST_INVALID', detail: failure.message }],
    });
  }

  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = exitCode;
}
