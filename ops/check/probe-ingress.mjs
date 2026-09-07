#!/usr/bin/env node
import { ContractError, EXIT, gateResult, parseArgs, readJsonFile } from '../release/lib/contracts.mjs';
import { probeIngress } from './lib/probes.mjs';

let exitCode = EXIT.PASS;
let output;
try {
  const args = parseArgs(process.argv.slice(2));
  if (!args['base-url'] || !args.manifest || !args.ingress) {
    throw new ContractError('--base-url, --manifest, and --ingress are required');
  }
  const [manifest, ingress] = await Promise.all([readJsonFile(args.manifest), readJsonFile(args.ingress)]);
  output = await probeIngress({
    baseUrl: args['base-url'],
    manifest,
    ingress,
    timeoutMs: args['timeout-ms'] ? Number(args['timeout-ms']) : 8000,
  });
  if (output.status !== 'pass') exitCode = EXIT.INGRESS;
} catch (error) {
  const failure = error instanceof ContractError ? error : new ContractError('unexpected ingress probe failure', EXIT.INGRESS);
  exitCode = failure.exitCode;
  output = gateResult({ gate: 'public-ingress', checks: [{ name: 'probe', status: 'fail', code: 'PROBE_REJECTED', detail: failure.message }] });
}

process.stdout.write(`${JSON.stringify(output)}\n`);
process.exitCode = exitCode;
