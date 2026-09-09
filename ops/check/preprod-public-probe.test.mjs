import assert from 'node:assert/strict';
import test from 'node:test';

import { runPublicProbe } from '../release/probe-fenced-public.mjs';
import { LEGACY_OLD_BINDING } from '../release/lib/legacy-preprod.mjs';

const identity = { 'release-id': 'booking-20260909T010203Z-abcdef123456', 'git-sha': 'a'.repeat(40),
  'manifest-digest': `sha256:${'b'.repeat(64)}`, slot: 'blue' };
const expected = { ...identity, 'config-schema': 'booking.config/v1',
  'migration-floor': '1788760000000-AddOrderCreatedConsumerIdempotency',
  'migration-catalog-digest': `sha256:${'c'.repeat(64)}`, 'telegram-bot-mode': 'webhook',
  'telegram-webhook-enabled': 'true', 'telegram-webhook-url': 'https://booking-preprod.happybooking.uk/telegram/webhook' };

function response(url, body, overrides = {}) {
  return { ok: true, redirected: false, url, headers: { get: (name) => name === 'content-type' ? 'application/json; charset=utf-8' : null },
    text: async () => JSON.stringify(body), ...overrides };
}

function body(status = 'up') {
  return { status, releaseId: identity['release-id'], gitSha: identity['git-sha'], manifestDigest: identity['manifest-digest'], slot: identity.slot,
    configSchema: 'booking.config/v1', migrationFloor: '1788760000000-AddOrderCreatedConsumerIdempotency',
    migrationCatalogDigest: `sha256:${'c'.repeat(64)}`, telegramBotMode: 'webhook', telegramWebhookEnabled: true,
    telegramWebhookUrl: 'https://booking-preprod.happybooking.uk/telegram/webhook' };
}

test('public probe fixes HTTPS host and verifies ready/version exact identity without redirects', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return response(url, body(url.endsWith('/readyz') ? 'ready' : 'up'));
  };
  const result = await runPublicProbe(expected, { fetch });
  assert.equal(result.origin, 'https://booking-preprod.happybooking.uk');
  assert.deepEqual(calls.map((call) => call.url).sort(), [
    'https://booking-preprod.happybooking.uk/__ops/version',
    'https://booking-preprod.happybooking.uk/livez',
    'https://booking-preprod.happybooking.uk/readyz',
  ]);
  assert.ok(calls.every((call) => call.options.redirect === 'error'));
});

test('public probe rejects caller origin overrides, redirects, wrong origins and TLS failures', async () => {
  await assert.rejects(runPublicProbe({ ...expected, 'base-url': 'http://127.0.0.1:18083' }, { fetch: async () => null }), /override the fixed origin/);
  const exact = 'https://booking-preprod.happybooking.uk/readyz';
  await assert.rejects(runPublicProbe(expected, { fetch: async (url) => response(url === exact ? url : url, body('ready'), { redirected: true }) }), /redirect/);
  await assert.rejects(runPublicProbe(expected, { fetch: async (url) => response(url.replace('booking-preprod', 'localhost'), {}, {}) }), /wrong origin/);
  await assert.rejects(runPublicProbe(expected, { fetch: async () => { throw new Error('self signed certificate'); } }), /HTTPS\/TLS validation/);
  await assert.rejects(runPublicProbe(expected, { fetch: async (url) => response(url, body(url.endsWith('/readyz') ? 'ready' : 'up'),
    { headers: { get: () => 'text/html' } }) }), /content type/);
  await assert.rejects(runPublicProbe(expected, { fetch: async (url) => response(url, body(url.endsWith('/readyz') ? 'ready' : 'up'),
    { text: async () => JSON.stringify({ ...body('up'), extra: true }) }) }), /unexpected JSON shape/);
  await assert.rejects(runPublicProbe(expected, { fetch: async (url) => response(url, body('up'), { text: async () => 'x'.repeat(33 * 1024) }) }), /size limit/);
});

test('current public probe rejects drift in every contract and Telegram runtime field', async () => {
  const fields = ['configSchema', 'migrationFloor', 'migrationCatalogDigest', 'telegramBotMode', 'telegramWebhookEnabled', 'telegramWebhookUrl'];
  for (const field of fields) {
    const fetch = async (url) => {
      const observed = body(url.endsWith('/readyz') ? 'ready' : 'up');
      observed[field] = field === 'telegramWebhookEnabled' ? false : 'drifted';
      return response(url, observed);
    };
    await assert.rejects(runPublicProbe(expected, { fetch }), /runtime metadata mismatch/);
  }
  const missing = body('up');
  delete missing.configSchema;
  await assert.rejects(runPublicProbe(expected, { fetch: async (url) => response(url, { ...missing,
    status: url.endsWith('/readyz') ? 'ready' : 'up' }) }), /unexpected JSON shape/);
});

test('exact legacy rollback accepts only the strict five-field endpoint contract', async () => {
  const legacy = { 'release-id': LEGACY_OLD_BINDING.releaseId, 'git-sha': LEGACY_OLD_BINDING.gitSha,
    'manifest-digest': LEGACY_OLD_BINDING.manifestRawDigest, slot: 'green' };
  const legacyBody = (status) => ({ status, releaseId: legacy['release-id'], gitSha: legacy['git-sha'],
    manifestDigest: legacy['manifest-digest'], slot: legacy.slot });
  const result = await runPublicProbe(legacy, { fetch: async (url) => response(url, legacyBody(url.endsWith('/readyz') ? 'ready' : 'up')) });
  assert.equal(result.releaseId, LEGACY_OLD_BINDING.releaseId);
  await assert.rejects(runPublicProbe({ ...legacy, 'git-sha': 'a'.repeat(40) }, {
    fetch: async (url) => response(url, legacyBody(url.endsWith('/readyz') ? 'ready' : 'up')),
  }), /arguments do not match/);
  await assert.rejects(runPublicProbe(legacy, { fetch: async (url) => response(url, {
    ...legacyBody(url.endsWith('/readyz') ? 'ready' : 'up'), configSchema: 'booking.config/v1',
  }) }), /unexpected JSON shape/);
});
