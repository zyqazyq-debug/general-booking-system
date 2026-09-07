#!/usr/bin/env node
import { ContractError, EXIT, gateResult, parseArgs, readJsonFile } from './lib/contracts.mjs';
import { assertTransition } from './lib/state-machine.mjs';

let exitCode = EXIT.PASS;
let output;
try {
  const args = parseArgs(process.argv.slice(2));
  if (!args.state || !args.to || args['expected-generation'] === undefined) {
    throw new ContractError('--state, --to, and --expected-generation are required');
  }
  const state = await readJsonFile(args.state);
  const generation = Number(args['expected-generation']);
  assertTransition(state, args.to, generation);
  output = gateResult({
    gate: 'release-transition',
    releaseId: state.candidateRelease || state.activeRelease,
    slot: state.candidateSlot,
    checks: [{ name: `${state.phase}->${args.to}`, status: 'pass', code: 'TRANSITION_ALLOWED' }],
  });
} catch (error) {
  const failure = error instanceof ContractError ? error : new ContractError('unexpected transition validation failure');
  exitCode = failure.exitCode;
  output = gateResult({
    gate: 'release-transition',
    checks: [{ name: 'transition', status: 'fail', code: 'TRANSITION_REJECTED', detail: failure.message }],
  });
}

process.stdout.write(`${JSON.stringify(output)}\n`);
process.exitCode = exitCode;
