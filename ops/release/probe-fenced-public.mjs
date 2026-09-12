#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
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
const RESPONSE_KEYS = [...IDENTITY_KEYS, 'configSchema', 'migrationFloor', 'migrationCatalogDigest', 'telegramBotMode', 'telegramWebhookEnabled', 'telegramWebhookUrl'];
const REQUEST_CACHE_CONTROL = 'no-cache, no-store, max-age=0';
const REJECTED_CF_CACHE_STATUSES = new Set(['HIT', 'STALE', 'REVALIDATED', 'UPDATING']);
const LEGACY_ALLOWED_CF_CACHE_STATUSES = new Set(['BYPASS', 'DYNAMIC', 'MISS']);

function createProbeUrl(path, issuedNonces) {
  let nonce;
  do {
    nonce = randomUUID();
  } while (issuedNonces.has(nonce));
  issuedNonces.add(nonce);
  return `${ORIGIN}${path}?nonce=${encodeURIComponent(nonce)}`;
}

function assertUncachedResponse(response, { requireNoStore, requireCloudflareProof }) {
  const cacheControl = response.headers?.get?.('cache-control') || '';
  const directives = cacheControl.split(',').map((directive) => directive.trim().toLowerCase());
  if (requireNoStore && !directives.includes('no-store')) {
    throw new ContractError('public preproduction probe response does not prohibit storage', EXIT.READINESS);
  }
  const age = response.headers?.get?.('age');
  if (age !== null && age !== undefined && age !== '') {
    const normalizedAge = String(age).trim();
    if (!/^\d+$/.test(normalizedAge) || BigInt(normalizedAge) > 0n) {
      throw new ContractError('public preproduction probe response has cached Age metadata', EXIT.READINESS);
    }
  }
  const cfCacheStatus = response.headers?.get?.('cf-cache-status') || '';
  const cfStatuses = cfCacheStatus.split(',').map((status) => status.trim().toUpperCase()).filter(Boolean);
  if (cfStatuses.some((status) => REJECTED_CF_CACHE_STATUSES.has(status))) {
    throw new ContractError('public preproduction probe response was served from a disallowed Cloudflare cache state', EXIT.READINESS);
  }
  if (requireCloudflareProof && (cfStatuses.length !== 1 || !LEGACY_ALLOWED_CF_CACHE_STATUSES.has(cfStatuses[0]))) {
    throw new ContractError('legacy public preproduction probe lacks an explicit Cloudflare non-cache proof', EXIT.READINESS);
  }
}

async function readBoundedResponseText(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
      throw new ContractError('public preproduction probe body exceeds the fixed size limit', EXIT.READINESS);
    }
    return text;
  }
  const chunks = [];
  let retainedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new ContractError('public preproduction probe body stream is malformed', EXIT.READINESS);
      }
      const remaining = MAX_BODY_BYTES + 1 - retainedBytes;
      const retained = value.subarray(0, Math.max(0, remaining));
      if (retained.byteLength) {
        chunks.push(Buffer.from(retained));
        retainedBytes += retained.byteLength;
      }
      if (retainedBytes > MAX_BODY_BYTES || retained.byteLength !== value.byteLength) {
        throw new ContractError('public preproduction probe body exceeds the fixed size limit', EXIT.READINESS);
      }
    }
    return Buffer.concat(chunks, retainedBytes).toString('utf8');
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof ContractError) throw error;
    throw new ContractError('public preproduction probe body cannot be read', EXIT.READINESS);
  } finally {
    reader.releaseLock?.();
  }
}

async function readJson(path, fetcher, expectedKeys, issuedNonces, cacheRequirements) {
  const url = createProbeUrl(path, issuedNonces);
  let response;
  try {
    response = await fetcher(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
      headers: {
        accept: 'application/json',
        'cache-control': REQUEST_CACHE_CONTROL,
        pragma: 'no-cache',
      },
    });
  } catch {
    throw new ContractError('public preproduction probe failed HTTPS/TLS validation', EXIT.READINESS);
  }
  if (!response?.ok || response.redirected === true || response.url !== url) {
    throw new ContractError('public preproduction probe returned a redirect, wrong origin, or non-success status', EXIT.READINESS);
  }
  assertUncachedResponse(response, cacheRequirements);
  const contentType = response.headers?.get?.('content-type') || '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw new ContractError('public preproduction probe content type is not JSON', EXIT.READINESS);
  let text;
  try {
    text = await readBoundedResponseText(response);
  } catch (error) {
    throw error instanceof ContractError ? error : new ContractError('public preproduction probe body cannot be read', EXIT.READINESS);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ContractError('public preproduction probe did not return JSON', EXIT.READINESS);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== [...expectedKeys].sort().join(',')) {
    throw new ContractError('public preproduction probe returned an unexpected JSON shape', EXIT.READINESS);
  }
  return body;
}

export async function runPublicProbe(args, runtime = {}) {
  const allowed = new Set(['release-id', 'git-sha', 'manifest-digest', 'slot', 'config-schema', 'migration-floor', 'migration-catalog-digest', 'telegram-bot-mode', 'telegram-webhook-enabled', 'telegram-webhook-url']);
  const identityFields = ['release-id', 'git-sha', 'manifest-digest', 'slot'];
  if (Object.keys(args).some((key) => !allowed.has(key)) || identityFields.some((key) => !args[key])) {
    throw new ContractError('public probe arguments are incomplete or attempt to override the fixed origin', EXIT.READINESS);
  }
  if (!RELEASE.test(args['release-id']) || !SHA.test(args['git-sha']) || !DIGEST.test(args['manifest-digest']) || !['blue', 'green'].includes(args.slot)) {
    throw new ContractError('public probe expected identity is invalid', EXIT.IDENTITY);
  }
  const exactLegacy = args['release-id'] === LEGACY_OLD_BINDING.releaseId && args['git-sha'] === LEGACY_OLD_BINDING.gitSha && args['manifest-digest'] === LEGACY_OLD_BINDING.manifestRawDigest && args.slot === 'green';
  const metadataFields = [...allowed].filter((key) => !identityFields.includes(key));
  if ((!exactLegacy && metadataFields.some((key) => !args[key])) || (exactLegacy && metadataFields.some((key) => args[key] !== undefined))) {
    throw new ContractError('public probe arguments do not match the exact legacy or current endpoint contract', EXIT.READINESS);
  }
  if (!exactLegacy && (!DIGEST.test(args['migration-catalog-digest']) || args['telegram-bot-mode'] !== 'webhook' || args['telegram-webhook-enabled'] !== 'true' || args['telegram-webhook-url'] !== `${ORIGIN}/telegram/webhook`)) {
    throw new ContractError('public probe expected runtime metadata is invalid', EXIT.IDENTITY);
  }
  const fetcher = runtime.fetch || fetch;
  const expectedKeys = exactLegacy ? IDENTITY_KEYS : RESPONSE_KEYS;
  const issuedNonces = new Set();
  const [live, ready, version] = await Promise.all([
    readJson('/livez', fetcher, expectedKeys, issuedNonces, { requireNoStore: !exactLegacy, requireCloudflareProof: exactLegacy }),
    readJson('/readyz', fetcher, expectedKeys, issuedNonces, { requireNoStore: !exactLegacy, requireCloudflareProof: exactLegacy }),
    readJson('/__ops/version', fetcher, expectedKeys, issuedNonces, { requireNoStore: !exactLegacy, requireCloudflareProof: exactLegacy }),
  ]);
  for (const observed of [live, ready, version]) {
    if (observed.releaseId !== args['release-id'] || observed.gitSha !== args['git-sha'] || observed.manifestDigest !== args['manifest-digest'] || observed.slot !== args.slot) {
      throw new ContractError('public endpoint identity mismatch', EXIT.READINESS);
    }
    if (!exactLegacy && (observed.configSchema !== args['config-schema'] || observed.migrationFloor !== args['migration-floor'] || observed.migrationCatalogDigest !== args['migration-catalog-digest'] || observed.telegramBotMode !== args['telegram-bot-mode'] || observed.telegramWebhookEnabled !== (args['telegram-webhook-enabled'] === 'true') || observed.telegramWebhookUrl !== args['telegram-webhook-url'])) {
      throw new ContractError('public endpoint runtime metadata mismatch', EXIT.READINESS);
    }
  }
  if (live.status !== 'up' || ready.status !== 'ready' || version.status !== 'up') {
    throw new ContractError('public liveness/readiness/version status is invalid', EXIT.READINESS);
  }
  return {
    status: 'pass',
    origin: ORIGIN,
    releaseId: args['release-id'],
    gitSha: args['git-sha'],
    manifestDigest: args['manifest-digest'],
    slot: args.slot,
    ...(!exactLegacy
      ? {
          configSchema: args['config-schema'],
          migrationFloor: args['migration-floor'],
          migrationCatalogDigest: args['migration-catalog-digest'],
          telegramBotMode: args['telegram-bot-mode'],
          telegramWebhookEnabled: true,
          telegramWebhookUrl: args['telegram-webhook-url'],
        }
      : {}),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let output;
  let exitCode = EXIT.PASS;
  try {
    output = await runPublicProbe(parseArgs(process.argv.slice(2)));
  } catch (error) {
    const failure = error instanceof ContractError ? error : new ContractError('public preproduction probe failed', EXIT.READINESS);
    exitCode = failure.exitCode;
    output = {
      status: 'fail',
      code: 'PUBLIC_PREPROD_PROBE_REJECTED',
      detail: failure.message,
    };
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = exitCode;
}
