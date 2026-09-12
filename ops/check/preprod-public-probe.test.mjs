import assert from 'node:assert/strict';
import test from 'node:test';

import { runPublicProbe } from '../release/probe-fenced-public.mjs';
import { LEGACY_OLD_BINDING } from '../release/lib/legacy-preprod.mjs';

const identity = {
  'release-id': 'booking-20260909T010203Z-abcdef123456',
  'git-sha': 'a'.repeat(40),
  'manifest-digest': `sha256:${'b'.repeat(64)}`,
  slot: 'blue',
};
const expected = {
  ...identity,
  'config-schema': 'booking.config/v1',
  'migration-floor': '1788760000000-AddOrderCreatedConsumerIdempotency',
  'migration-catalog-digest': `sha256:${'c'.repeat(64)}`,
  'telegram-bot-mode': 'webhook',
  'telegram-webhook-enabled': 'true',
  'telegram-webhook-url': 'https://booking-preprod.happybooking.uk/telegram/webhook',
};

function response(url, body, overrides = {}) {
  const { headers: suppliedHeaders, ...responseOverrides } = overrides;
  const headerValues = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(suppliedHeaders || {}),
  };
  const headers = suppliedHeaders?.get
    ? suppliedHeaders
    : {
        get: (name) => headerValues[String(name).toLowerCase()] ?? null,
      };
  return {
    ok: true,
    redirected: false,
    url,
    headers,
    text: async () => JSON.stringify(body),
    ...responseOverrides,
  };
}

function streamedResponse(url, body, controls = {}) {
  const encoded = new TextEncoder().encode(JSON.stringify(body));
  const chunks = controls.chunks || [encoded.subarray(0, Math.ceil(encoded.length / 2)), encoded.subarray(Math.ceil(encoded.length / 2))];
  let index = 0;
  return response(url, body, {
    body: {
      getReader: () => ({
        read: async () => index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: undefined },
        cancel: async () => { controls.cancelled = (controls.cancelled || 0) + 1; },
        releaseLock: () => { controls.released = (controls.released || 0) + 1; },
      }),
    },
    text: async () => { controls.textCalls = (controls.textCalls || 0) + 1; throw new Error('stream path must not call text'); },
  });
}

const requestPath = (url) => new URL(url).pathname;

function body(status = 'up') {
  return {
    status,
    releaseId: identity['release-id'],
    gitSha: identity['git-sha'],
    manifestDigest: identity['manifest-digest'],
    slot: identity.slot,
    configSchema: 'booking.config/v1',
    migrationFloor: '1788760000000-AddOrderCreatedConsumerIdempotency',
    migrationCatalogDigest: `sha256:${'c'.repeat(64)}`,
    telegramBotMode: 'webhook',
    telegramWebhookEnabled: true,
    telegramWebhookUrl: 'https://booking-preprod.happybooking.uk/telegram/webhook',
  };
}

test('public probe fixes HTTPS host and verifies ready/version exact identity without redirects', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return response(url, body(requestPath(url) === '/readyz' ? 'ready' : 'up'));
  };
  const result = await runPublicProbe(expected, { fetch });
  assert.equal(result.origin, 'https://booking-preprod.happybooking.uk');
  assert.deepEqual(calls.map((call) => requestPath(call.url)).sort(), ['/__ops/version', '/livez', '/readyz']);
  const nonces = calls.map(({ url }) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://booking-preprod.happybooking.uk');
    assert.deepEqual([...parsed.searchParams.keys()], ['nonce']);
    assert.match(parsed.searchParams.get('nonce'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    return parsed.searchParams.get('nonce');
  });
  assert.equal(new Set(nonces).size, 3);
  assert.ok(calls.every((call) => call.options.redirect === 'error'));
  assert.ok(calls.every((call) => call.options.headers['cache-control'] === 'no-cache, no-store, max-age=0'));
  assert.ok(calls.every((call) => call.options.headers.pragma === 'no-cache'));
});

test('public probe rejects caller origin overrides, redirects, wrong origins and TLS failures', async () => {
  await assert.rejects(runPublicProbe({ ...expected, 'base-url': 'http://127.0.0.1:18083' }, { fetch: async () => null }), /override the fixed origin/);
  await assert.rejects(
    runPublicProbe(expected, {
      fetch: async (url) => response(url, body('ready'), { redirected: true }),
    }),
    /redirect/,
  );
  await assert.rejects(
    runPublicProbe(expected, {
      fetch: async (url) => response(url.replace('booking-preprod', 'localhost'), {}, {}),
    }),
    /wrong origin/,
  );
  await assert.rejects(
    runPublicProbe(expected, {
      fetch: async (url) => response(`${new URL(url).origin}${new URL(url).pathname}`, body(requestPath(url) === '/readyz' ? 'ready' : 'up')),
    }),
    /wrong origin/,
  );
  await assert.rejects(
    runPublicProbe(expected, {
      fetch: async () => {
        throw new Error('self signed certificate');
      },
    }),
    /HTTPS\/TLS validation/,
  );
  await assert.rejects(
    runPublicProbe(expected, {
      fetch: async (url) =>
        response(url, body(requestPath(url) === '/readyz' ? 'ready' : 'up'), {
          headers: { 'content-type': 'text/html', 'cache-control': 'no-store' },
        }),
    }),
    /content type/,
  );
  await assert.rejects(
    runPublicProbe(expected, {
      fetch: async (url) =>
        response(url, body(requestPath(url) === '/readyz' ? 'ready' : 'up'), {
          text: async () => JSON.stringify({ ...body('up'), extra: true }),
        }),
    }),
    /unexpected JSON shape/,
  );
  await assert.rejects(
    runPublicProbe(expected, {
      fetch: async (url) => response(url, body('up'), { text: async () => 'x'.repeat(33 * 1024) }),
    }),
    /size limit/,
  );
});

test('public probe rejects cached responses even when a stale origin-down response is HTTP 200', async () => {
  await assert.rejects(
    runPublicProbe(expected, {
      fetch: async (url) =>
        response(url, body(requestPath(url) === '/readyz' ? 'ready' : 'up'), {
          headers: {
            'cache-control': 'no-store',
            'cf-cache-status': 'STALE',
            age: '72',
          },
        }),
    }),
    /cached Age metadata|Cloudflare cache state/,
  );
  for (const status of ['HIT', 'STALE', 'REVALIDATED', 'UPDATING']) {
    await assert.rejects(
      runPublicProbe(expected, {
        fetch: async (url) =>
          response(url, body(requestPath(url) === '/readyz' ? 'ready' : 'up'), {
            headers: {
              'cache-control': 'no-store',
              'cf-cache-status': status,
              age: '0',
            },
          }),
      }),
      /Cloudflare cache state/,
    );
  }
  await assert.rejects(
    runPublicProbe(expected, {
      fetch: async (url) =>
        response(url, body(requestPath(url) === '/readyz' ? 'ready' : 'up'), {
          headers: { 'cache-control': 'no-store', age: '1' },
        }),
    }),
    /cached Age metadata/,
  );
  await assert.rejects(
    runPublicProbe(expected, {
      fetch: async (url) =>
        response(url, body(requestPath(url) === '/readyz' ? 'ready' : 'up'), {
          headers: { 'cache-control': 'no-cache', age: '0' },
        }),
    }),
    /does not prohibit storage/,
  );
});

test('public probe streams at most 32 KiB plus one byte and cancels an oversized body', async () => {
  const validControls = {};
  const valid = await runPublicProbe(expected, { fetch: async (url) => streamedResponse(url,
    body(requestPath(url) === '/readyz' ? 'ready' : 'up'), validControls) });
  assert.equal(valid.status, 'pass');
  assert.equal(validControls.textCalls || 0, 0);
  assert.equal(validControls.released, 3);

  const oversizedControls = { chunks: [new Uint8Array(32 * 1024), new Uint8Array([1])] };
  await assert.rejects(runPublicProbe(expected, {
    fetch: async (url) => streamedResponse(url, body('up'), oversizedControls),
  }), /size limit/);
  assert.equal(oversizedControls.textCalls || 0, 0);
  assert.ok(oversizedControls.cancelled >= 1);
});

test('current public probe rejects drift in every contract and Telegram runtime field', async () => {
  const fields = ['configSchema', 'migrationFloor', 'migrationCatalogDigest', 'telegramBotMode', 'telegramWebhookEnabled', 'telegramWebhookUrl'];
  for (const field of fields) {
    const fetch = async (url) => {
      const observed = body(requestPath(url) === '/readyz' ? 'ready' : 'up');
      observed[field] = field === 'telegramWebhookEnabled' ? false : 'drifted';
      return response(url, observed);
    };
    await assert.rejects(runPublicProbe(expected, { fetch }), /runtime metadata mismatch/);
  }
  const missing = body('up');
  delete missing.configSchema;
  await assert.rejects(
    runPublicProbe(expected, {
      fetch: async (url) =>
        response(url, {
          ...missing,
          status: requestPath(url) === '/readyz' ? 'ready' : 'up',
        }),
    }),
    /unexpected JSON shape/,
  );
});

test('exact legacy rollback accepts only the strict five-field endpoint contract', async () => {
  const legacy = {
    'release-id': LEGACY_OLD_BINDING.releaseId,
    'git-sha': LEGACY_OLD_BINDING.gitSha,
    'manifest-digest': LEGACY_OLD_BINDING.manifestRawDigest,
    slot: 'green',
  };
  const legacyBody = (status) => ({
    status,
    releaseId: legacy['release-id'],
    gitSha: legacy['git-sha'],
    manifestDigest: legacy['manifest-digest'],
    slot: legacy.slot,
  });
  const calls = [];
  const result = await runPublicProbe(legacy, {
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response(url, legacyBody(requestPath(url) === '/readyz' ? 'ready' : 'up'), {
        headers: { 'content-type': 'application/json', age: '0', 'cf-cache-status': 'DYNAMIC' },
      });
    },
  });
  assert.equal(result.releaseId, LEGACY_OLD_BINDING.releaseId);
  assert.equal(new Set(calls.map(({ url }) => new URL(url).searchParams.get('nonce'))).size, 3);
  assert.ok(calls.every(({ options }) => options.headers['cache-control'].includes('no-store')));
  for (const headers of [
    { 'content-type': 'application/json', age: '1', 'cf-cache-status': 'DYNAMIC' },
    { 'content-type': 'application/json', age: '0', 'cf-cache-status': 'STALE' },
    { 'content-type': 'application/json', age: '0' },
  ]) {
    await assert.rejects(
      runPublicProbe(legacy, {
        fetch: async (url) => response(url, legacyBody(requestPath(url) === '/readyz' ? 'ready' : 'up'), { headers }),
      }),
      /cached Age metadata|Cloudflare cache state|lacks an explicit Cloudflare non-cache proof/,
    );
  }
  await assert.rejects(
    runPublicProbe(
      { ...legacy, 'git-sha': 'a'.repeat(40) },
      {
        fetch: async (url) => response(url, legacyBody(requestPath(url) === '/readyz' ? 'ready' : 'up')),
      },
    ),
    /arguments do not match/,
  );
  await assert.rejects(
    runPublicProbe(legacy, {
      fetch: async (url) =>
        response(url, {
          ...legacyBody(requestPath(url) === '/readyz' ? 'ready' : 'up'),
          configSchema: 'booking.config/v1',
        }, { headers: { 'content-type': 'application/json', age: '0', 'cf-cache-status': 'DYNAMIC' } }),
    }),
    /unexpected JSON shape/,
  );
});
