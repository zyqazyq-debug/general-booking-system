#!/usr/bin/env node
import { ContractError, EXIT, gateResult, parseArgs, readJsonFile } from '../release/lib/contracts.mjs';
import { probeSlot } from './lib/probes.mjs';

let exitCode = EXIT.PASS;
let output;
try {
  const args = parseArgs(process.argv.slice(2));
  if (!args['base-url'] || !args.manifest || !args.slot) {
    throw new ContractError('--base-url, --manifest, and --slot are required');
  }
  const manifest = await readJsonFile(args.manifest);
  output = await probeSlot({
    baseUrl: args['base-url'],
    manifest,
    slot: args.slot,
    timeoutMs: args['timeout-ms'] ? Number(args['timeout-ms']) : 5000,
  });
  if (output.status !== 'pass') exitCode = EXIT.READINESS;
} catch (error) {
  const failure = error instanceof ContractError ? error : new ContractError('unexpected slot probe failure', EXIT.READINESS);
  exitCode = failure.exitCode;
  output = gateResult({ gate: 'slot-ready', checks: [{ name: 'probe', status: 'fail', code: 'PROBE_REJECTED', detail: failure.message }] });
}

process.stdout.write(`${JSON.stringify(output)}\n`);
process.exitCode = exitCode;
