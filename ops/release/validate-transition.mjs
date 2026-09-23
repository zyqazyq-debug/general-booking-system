#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ContractError, EXIT, gateResult, parseArgs, readJsonFile } from './lib/contracts.mjs';
import { assertStaticTransition } from './lib/state-machine.mjs';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let exitCode = EXIT.PASS;
  let output;
  try {
    const args = parseArgs(process.argv.slice(2));
    for (const key of Object.keys(args)) {
      if (!['state', 'to', 'static-only'].includes(key)) throw new ContractError(`unsupported static-check argument: --${key}`);
    }
    if (!args.state || !args.to || args['static-only'] !== 'true') {
      throw new ContractError('--state, --to, and --static-only true are required');
    }
    const state = await readJsonFile(args.state);
    assertStaticTransition(state, args.to);
    output = gateResult({
      gate: 'release-transition-static',
      releaseId: (state.candidate || state.active).releaseId,
      slot: (state.candidate || state.active).slot,
      checks: [{ name: `${state.phase}->${args.to}`, status: 'pass', code: 'STATIC_TRANSITION_LEGAL_NOT_AUTHORIZED', detail: 'No clock, lease ownership, CAS, fencing, or external resource was checked.' }],
    });
  } catch (error) {
    const failure = error instanceof ContractError ? error : new ContractError('unexpected transition validation failure');
    exitCode = failure.exitCode;
    output = gateResult({
      gate: 'release-transition-static',
      checks: [{ name: 'transition', status: 'fail', code: 'TRANSITION_REJECTED', detail: failure.message }],
    });
  }

  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = exitCode;
}
