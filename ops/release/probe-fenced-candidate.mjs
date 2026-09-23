#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ContractError, EXIT, parseArgs } from './lib/contracts.mjs';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RELEASE = /^booking-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/;
const SHA = /^[0-9a-f]{40}$/;

function requireExactLoopback(value) {
  let url;
  try { url = new URL(value); } catch { throw new ContractError('candidate base URL is invalid', EXIT.READINESS); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new ContractError('candidate readback is restricted to an exact loopback origin', EXIT.READINESS);
  }
  return url.toString().replace(/\/$/, '');
}

async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000), headers: { accept: 'application/json' } });
  if (!response.ok) throw new ContractError(`candidate readback returned HTTP ${response.status}`, EXIT.READINESS);
  return response.json();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let output;
  let exitCode = EXIT.PASS;
  try {
    const args = parseArgs(process.argv.slice(2));
    const allowed = new Set(['base-url', 'release-id', 'git-sha', 'manifest-digest', 'slot']);
    if (Object.keys(args).some((key) => !allowed.has(key)) || [...allowed].some((key) => !args[key])) throw new ContractError('candidate readback arguments are incomplete', EXIT.READINESS);
    if (!RELEASE.test(args['release-id']) || !SHA.test(args['git-sha']) || !DIGEST.test(args['manifest-digest']) || !['blue', 'green'].includes(args.slot)) {
      throw new ContractError('candidate readback expected identity is invalid', EXIT.IDENTITY);
    }
    const base = requireExactLoopback(args['base-url']);
    const [ready, version] = await Promise.all([readJson(`${base}/readyz`), readJson(`${base}/__ops/version`)]);
    for (const observed of [ready, version]) {
      if (observed.releaseId !== args['release-id'] || observed.gitSha !== args['git-sha'] || observed.manifestDigest !== args['manifest-digest'] || observed.slot !== args.slot) {
        throw new ContractError('candidate endpoint identity mismatch', EXIT.READINESS);
      }
    }
    if (ready.status !== 'ready') throw new ContractError('candidate readiness endpoint is not ready', EXIT.READINESS);
    output = { status: 'pass', releaseId: args['release-id'], gitSha: args['git-sha'], manifestDigest: args['manifest-digest'], slot: args.slot };
  } catch (error) {
    const failure = error instanceof ContractError ? error : new ContractError('candidate readback failed', EXIT.READINESS);
    exitCode = failure.exitCode;
    output = { status: 'fail', code: 'CANDIDATE_READBACK_REJECTED', detail: failure.message };
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = exitCode;
}
