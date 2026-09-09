#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ContractError, EXIT, parseArgs } from './lib/contracts.mjs';
import { LEGACY_OLD_BINDING } from './lib/legacy-preprod.mjs';

const ORIGIN = 'https://booking-preprod.happybooking.uk';
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RELEASE = /^booking-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/;
const SHA = /^[0-9a-f]{40}$/;
const MAX_BODY_BYTES = 32 * 1024;
const IDENTITY_KEYS = ['status', 'releaseId', 'gitSha', 'manifestDigest', 'slot'];
const RESPONSE_KEYS = [...IDENTITY_KEYS, 'configSchema', 'migrationFloor',
  'migrationCatalogDigest', 'telegramBotMode', 'telegramWebhookEnabled', 'telegramWebhookUrl'];

async function readJson(path, fetcher, expectedKeys) {
  const url = `${ORIGIN}${path}`;
  let response;
  try {
    response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(8_000), headers: { accept: 'application/json' } });
  } catch {
    throw new ContractError('public preproduction probe failed HTTPS/TLS validation', EXIT.READINESS);
  }
  if (!response?.ok || response.redirected === true || response.url !== url) {
    throw new ContractError('public preproduction probe returned a redirect, wrong origin, or non-success status', EXIT.READINESS);
  }
  const contentType = response.headers?.get?.('content-type') || '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw new ContractError('public preproduction probe content type is not JSON', EXIT.READINESS);
  let text;
  try { text = await response.text(); }
  catch { throw new ContractError('public preproduction probe body cannot be read', EXIT.READINESS); }
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new ContractError('public preproduction probe body exceeds the fixed size limit', EXIT.READINESS);
  let body;
  try { body = JSON.parse(text); }
  catch { throw new ContractError('public preproduction probe did not return JSON', EXIT.READINESS); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== [...expectedKeys].sort().join(',')) {
    throw new ContractError('public preproduction probe returned an unexpected JSON shape', EXIT.READINESS);
  }
  return body;
}

export async function runPublicProbe(args, runtime = {}) {
  const allowed = new Set(['release-id', 'git-sha', 'manifest-digest', 'slot', 'config-schema', 'migration-floor',
    'migration-catalog-digest', 'telegram-bot-mode', 'telegram-webhook-enabled', 'telegram-webhook-url']);
  const identityFields = ['release-id', 'git-sha', 'manifest-digest', 'slot'];
  if (Object.keys(args).some((key) => !allowed.has(key)) || identityFields.some((key) => !args[key])) {
    throw new ContractError('public probe arguments are incomplete or attempt to override the fixed origin', EXIT.READINESS);
  }
  if (!RELEASE.test(args['release-id']) || !SHA.test(args['git-sha']) || !DIGEST.test(args['manifest-digest']) || !['blue', 'green'].includes(args.slot)) {
    throw new ContractError('public probe expected identity is invalid', EXIT.IDENTITY);
  }
  const exactLegacy = args['release-id'] === LEGACY_OLD_BINDING.releaseId && args['git-sha'] === LEGACY_OLD_BINDING.gitSha &&
    args['manifest-digest'] === LEGACY_OLD_BINDING.manifestRawDigest && args.slot === 'green';
  const metadataFields = [...allowed].filter((key) => !identityFields.includes(key));
  if ((!exactLegacy && metadataFields.some((key) => !args[key])) ||
      (exactLegacy && metadataFields.some((key) => args[key] !== undefined))) {
    throw new ContractError('public probe arguments do not match the exact legacy or current endpoint contract', EXIT.READINESS);
  }
  if (!exactLegacy && (!DIGEST.test(args['migration-catalog-digest']) || args['telegram-bot-mode'] !== 'webhook' ||
      args['telegram-webhook-enabled'] !== 'true' || args['telegram-webhook-url'] !== `${ORIGIN}/telegram/webhook`)) {
    throw new ContractError('public probe expected runtime metadata is invalid', EXIT.IDENTITY);
  }
  const fetcher = runtime.fetch || fetch;
  const expectedKeys = exactLegacy ? IDENTITY_KEYS : RESPONSE_KEYS;
  const [live, ready, version] = await Promise.all([readJson('/livez', fetcher, expectedKeys), readJson('/readyz', fetcher, expectedKeys), readJson('/__ops/version', fetcher, expectedKeys)]);
  for (const observed of [live, ready, version]) {
    if (observed.releaseId !== args['release-id'] || observed.gitSha !== args['git-sha'] || observed.manifestDigest !== args['manifest-digest'] || observed.slot !== args.slot) {
      throw new ContractError('public endpoint identity mismatch', EXIT.READINESS);
    }
    if (!exactLegacy && (observed.configSchema !== args['config-schema'] || observed.migrationFloor !== args['migration-floor'] ||
        observed.migrationCatalogDigest !== args['migration-catalog-digest'] || observed.telegramBotMode !== args['telegram-bot-mode'] ||
        observed.telegramWebhookEnabled !== (args['telegram-webhook-enabled'] === 'true') ||
        observed.telegramWebhookUrl !== args['telegram-webhook-url'])) {
      throw new ContractError('public endpoint runtime metadata mismatch', EXIT.READINESS);
    }
  }
  if (live.status !== 'up' || ready.status !== 'ready' || version.status !== 'up') {
    throw new ContractError('public liveness/readiness/version status is invalid', EXIT.READINESS);
  }
  return { status: 'pass', origin: ORIGIN, releaseId: args['release-id'], gitSha: args['git-sha'], manifestDigest: args['manifest-digest'], slot: args.slot,
    ...(!exactLegacy ? { configSchema: args['config-schema'], migrationFloor: args['migration-floor'],
      migrationCatalogDigest: args['migration-catalog-digest'], telegramBotMode: args['telegram-bot-mode'],
      telegramWebhookEnabled: true, telegramWebhookUrl: args['telegram-webhook-url'] } : {}) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let output;
  let exitCode = EXIT.PASS;
  try { output = await runPublicProbe(parseArgs(process.argv.slice(2))); }
  catch (error) {
    const failure = error instanceof ContractError ? error : new ContractError('public preproduction probe failed', EXIT.READINESS);
    exitCode = failure.exitCode;
    output = { status: 'fail', code: 'PUBLIC_PREPROD_PROBE_REJECTED', detail: failure.message };
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = exitCode;
}
