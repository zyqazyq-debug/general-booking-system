import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';
import businessSmokeSchema from '../contracts/preprod-business-smoke.schema.json' with { type: 'json' };

import { parseTelegramSigningKey, runBusinessSmoke, validateTelegramSigningKeyMetadata,
  validateWebhookSecretMetadata } from '../release/probe-fenced-business.mjs';

const args = {
  'release-id': 'booking-20260913T010203Z-abcdef123456',
  'git-sha': 'a'.repeat(40),
  'manifest-digest': `sha256:${'b'.repeat(64)}`,
  slot: 'blue',
  'config-schema': 'booking.config/v1',
  'migration-floor': '1788760000000-AddOrderCreatedConsumerIdempotency',
  'migration-catalog-digest': `sha256:${'c'.repeat(64)}`,
  'telegram-bot-mode': 'webhook',
  'telegram-webhook-enabled': 'true',
  'telegram-webhook-url': 'https://booking-preprod.happybooking.uk/telegram/webhook',
  'operation-id': 'g4.business.01',
  'action-id': 'observation-business-01',
  generation: '17',
  'fencing-epoch': '3',
};
const TELEGRAM_SIGNING_KEY = '123456:fixture_bot_signing_key_material_012345';
const TELEGRAM_BOT_NAME = 'fixture_preprod_bot';

function headers(values = {}) {
  const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name) => normalized[String(name).toLowerCase()] ?? null };
}

function response(url, status, body, values = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { url, status, ok: status >= 200 && status < 300, redirected: false,
    headers: headers(values), text: async () => text };
}

function telegramWidgetResponse(url, body = '<!doctype html><div class="tgme_widget_login"></div><script>TWidgetLogin.init("widget_login", {});</script>') {
  return response(url, 200, body, { 'content-type': 'text/html; charset=utf-8', age: '0', 'cf-cache-status': 'DYNAMIC' });
}

function envelope(data) { return { code: 0, message: 'OK', data }; }

function healthBody(path) {
  return {
    status: path === '/readyz' ? 'ready' : 'up', releaseId: args['release-id'], gitSha: args['git-sha'],
    manifestDigest: args['manifest-digest'], slot: args.slot, configSchema: args['config-schema'],
    migrationFloor: args['migration-floor'], migrationCatalogDigest: args['migration-catalog-digest'],
    telegramBotMode: 'webhook', telegramWebhookEnabled: true, telegramWebhookUrl: args['telegram-webhook-url'],
  };
}

test('observation business smoke proves public UI/API, session chain, both short links, database write/readback and duplicate Telegram inbox delivery', async () => {
  const proofValue = 'fixture_webhook_proof_value';
  const signingKey = TELEGRAM_SIGNING_KEY;
  const botUsername = TELEGRAM_BOT_NAME;
  const passwordValue = 'fixture-password-that-must-never-escape';
  const sessionValues = {
    registerAccess: 'register-access-value-000001', registerRefresh: 'register-refresh-value-00001',
    loginAccess: 'login-access-value-000000001', loginRefresh: 'login-refresh-value-00000001',
    rotatedAccess: 'rotated-access-value-0000001', rotatedRefresh: 'rotated-refresh-value-000001',
    telegramAccess: 'telegram-access-value-000001', telegramRefresh: 'telegram-refresh-value-00001',
  };
  const state = { marker: null, userId: '11111111-1111-4111-8111-111111111111', sessions: 0, revoked: 0,
    telegramId: null, telegramUsername: null, telegramUserId: '22222222-2222-4222-8222-222222222222', telegramSessions: 0,
    telegramRevoked: 0, telegramPresent: false, telegramCleanupReadbacks: 0, telegramHash: null, updateId: null, webhookCalls: 0,
    webhookBodiesSafe: true, proofObserved: false, cleanupReadbacks: 0 };
  const requests = [];

  const fetch = async (url, options) => {
    const parsed = new URL(url);
    requests.push({ hostname: parsed.hostname, pathname: parsed.pathname, redirect: options.redirect,
      cacheControl: options.headers['cache-control'], pragma: options.headers.pragma });
    if (parsed.hostname === 'oauth.telegram.org') {
      assert.equal(url, `https://oauth.telegram.org/embed/${botUsername}?origin=${encodeURIComponent('https://booking-preprod.happybooking.uk')}&size=large&request_access=write`);
      return telegramWidgetResponse(url);
    }
    if (['/livez', '/readyz', '/__ops/version'].includes(parsed.pathname)) {
      return response(url, 200, healthBody(parsed.pathname), { 'content-type': 'application/json', 'cache-control': 'no-store', age: '0', 'cf-cache-status': 'DYNAMIC' });
    }
    if (parsed.pathname === '/') return response(url, 200, '<!doctype html><html><body><div id="app"></div></body></html>', { 'content-type': 'text/html; charset=utf-8', age: '0', 'cf-cache-status': 'DYNAMIC' });
    if (parsed.pathname.startsWith('/r/')) return response(url, 302, '', { location: `/#/pages/login/register?ref=${parsed.pathname.slice(3)}`, age: '0', 'cf-cache-status': 'DYNAMIC' });
    if (parsed.pathname.startsWith('/s/')) return response(url, 302, '', { location: `/#/pages/booking/detail?slug=${parsed.pathname.slice(3)}`, age: '0', 'cf-cache-status': 'DYNAMIC' });
    if (parsed.pathname === '/api/auth/register') {
      const body = JSON.parse(options.body);
      state.marker = body.username;
      assert.equal(body.email, `${body.username}@smoke.invalid`);
      if (body.password === passwordValue) throw new Error('test must not inject its sentinel as the generated password');
      state.sessions = 1;
      return response(url, 201, envelope({ access_token: sessionValues.registerAccess, refresh_token: sessionValues.registerRefresh,
        user: { id: state.userId, username: state.marker } }), { 'content-type': 'application/json', age: '0' });
    }
    if (parsed.pathname === '/api/auth/login') {
      const body = JSON.parse(options.body);
      assert.equal(body.username, state.marker);
      state.sessions = 2;
      return response(url, 201, envelope({ access_token: sessionValues.loginAccess, refresh_token: sessionValues.loginRefresh,
        user: { id: state.userId, username: state.marker } }), { 'content-type': 'application/json', age: '0' });
    }
    if (parsed.pathname === '/api/auth/refresh') {
      const body = JSON.parse(options.body);
      if (body.refresh_token === sessionValues.loginRefresh) {
        return response(url, 201, envelope({ access_token: sessionValues.rotatedAccess, refresh_token: sessionValues.rotatedRefresh }), { 'content-type': 'application/json', age: '0' });
      }
      assert.ok([sessionValues.rotatedRefresh, sessionValues.telegramRefresh].includes(body.refresh_token));
      return response(url, 401, { code: 401, message: 'Invalid refresh', data: null }, { 'content-type': 'application/json', age: '0' });
    }
    if (parsed.pathname === '/api/users/me') {
      if (options.headers.authorization === `Bearer ${sessionValues.rotatedAccess}`) {
        return response(url, 200, envelope({ id: state.userId, username: state.marker }), { 'content-type': 'application/json', age: '0' });
      }
      assert.equal(options.headers.authorization, `Bearer ${sessionValues.telegramAccess}`);
      return response(url, 200, envelope({ id: state.telegramUserId, username: state.telegramUsername }), { 'content-type': 'application/json', age: '0' });
    }
    if (parsed.pathname === '/api/auth/logout') {
      const body = JSON.parse(options.body);
      if (body.refresh_token === sessionValues.telegramRefresh) state.telegramRevoked += 1;
      else state.revoked += 1;
      return response(url, 201, envelope({ success: true }), { 'content-type': 'application/json', age: '0' });
    }
    if (parsed.pathname === '/api/auth/telegram') {
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body).sort(), ['auth_date', 'deviceInfo', 'first_name', 'hash', 'id', 'username'].sort());
      assert.equal(body.first_name, 'G4 Smoke Fixture');
      assert.equal(body.deviceInfo.purpose, 'g4-telegram-login-smoke');
      assert.equal(body.deviceInfo.fixture, body.username);
      const { hash, deviceInfo: _deviceInfo, ...signedFields } = body;
      const checkString = Object.entries(signedFields).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join('\n');
      const expectedHash = createHmac('sha256', createHash('sha256').update(signingKey).digest()).update(checkString).digest('hex');
      assert.equal(hash, expectedHash, 'payload must use the real Telegram Login Widget signing algorithm');
      state.telegramHash = hash;
      state.marker = body.username;
      state.telegramId = String(body.id);
      state.telegramUsername = `tg_${body.id}_fixture`;
      state.telegramPresent = true;
      state.telegramSessions = 1;
      return response(url, 201, envelope({ access_token: sessionValues.telegramAccess, refresh_token: sessionValues.telegramRefresh,
        user: { id: state.telegramUserId, username: state.telegramUsername } }), { 'content-type': 'application/json', age: '0' });
    }
    if (parsed.pathname === '/telegram/webhook') {
      const body = JSON.parse(options.body);
      state.webhookCalls += 1;
      state.webhookBodiesSafe &&= Object.keys(body).length === 1 && Number.isSafeInteger(body.update_id);
      if (state.updateId === null) state.updateId = body.update_id;
      else assert.equal(body.update_id, state.updateId);
      state.proofObserved ||= options.headers['x-telegram-bot-api-secret-token'] === proofValue;
      return response(url, 200, '', { age: '0', 'cf-cache-status': 'DYNAMIC' });
    }
    throw new Error(`unexpected path ${parsed.pathname}`);
  };

  const queryDatabase = async (sql) => {
    if (sql.includes("'telegram_rows'")) {
      const rows = state.telegramPresent ? 1 : 0;
      return JSON.stringify({ database: 'booking_preprod', db_user: 'booking_preprod', telegram_rows: rows, telegram_owned: rows });
    }
    if (sql.includes("'telegram_deleted'")) {
      const deleted = state.telegramPresent && sql.includes(state.marker) && sql.includes(state.telegramId) ? 1 : 0;
      if (deleted) { state.telegramPresent = false; state.telegramSessions = 0; state.telegramRevoked = 0; }
      return JSON.stringify({ database: 'booking_preprod', db_user: 'booking_preprod', telegram_deleted: deleted });
    }
    if (sql.includes("'telegram_remaining'")) {
      state.telegramCleanupReadbacks += 1;
      return JSON.stringify({ database: 'booking_preprod', db_user: 'booking_preprod', telegram_remaining: state.telegramPresent ? 1 : 0 });
    }
    if (sql.includes("'telegram_user_rows'")) {
      return JSON.stringify({ database: 'booking_preprod', db_user: 'booking_preprod', telegram_user_rows: state.telegramPresent ? 1 : 0,
        telegram_sessions: state.telegramSessions, telegram_revoked: state.telegramRevoked });
    }
    if (sql.includes("'owned'")) {
      const rows = state.marker && sql.includes(state.marker) ? 1 : 0;
      return JSON.stringify({ database: 'booking_preprod', db_user: 'booking_preprod', rows, owned: rows });
    }
    if (sql.startsWith('WITH deleted AS')) {
      const deleted = state.marker && sql.includes(state.marker) ? 1 : 0;
      if (deleted) { state.marker = null; state.sessions = 0; state.revoked = 0; }
      return JSON.stringify({ database: 'booking_preprod', db_user: 'booking_preprod', deleted });
    }
    if (sql.includes("'remaining'")) {
      state.cleanupReadbacks += 1;
      return JSON.stringify({ database: 'booking_preprod', db_user: 'booking_preprod', remaining: state.marker ? 1 : 0 });
    }
    if (sql.includes('FROM public."user" u')) {
      return JSON.stringify({ database: 'booking_preprod', db_user: 'booking_preprod', rows: 1, sessions: state.sessions, revoked: state.revoked });
    }
    if (sql.includes('FROM public.telegram_webhook_updates')) {
      return JSON.stringify({ database: 'booking_preprod', db_user: 'booking_preprod', rows: 1, processed: 1, has_processed_at: true, operations: 0 });
    }
    throw new Error('unexpected isolated database query');
  };

  const now = new Date('2026-09-13T01:02:03.000Z');
  const result = await runBusinessSmoke(args, { fetch, queryDatabase, readWebhookSecret: async () => proofValue,
    readTelegramSigningKey: async () => signingKey, telegramBotUsername: botUsername, now });
  assert.equal(result.status, 'pass');
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(businessSmokeSchema);
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
  const widened = structuredClone(result);
  widened.checks.sessionChain.password = passwordValue;
  assert.equal(validate(widened), false, 'the receipt contract must reject added secret-bearing fields');
  assert.equal(result.checks.shortLinks.referral.statusCode, 302);
  assert.equal(result.checks.shortLinks.share.statusCode, 302);
  assert.deepEqual(result.checks.telegramInbox.deliveryStatusCodes, [200, 200]);
  assert.deepEqual(result.checks.telegramWidget, {
    origin: 'https://booking-preprod.happybooking.uk',
    botUsername,
    transport: 'tls-validated-no-redirect-no-cache',
    domainAccepted: true,
    embedInitialized: true,
  });
  assert.deepEqual(result.checks.telegramLogin, {
    signatureAlgorithm: 'sha256-bot-token+hmac-sha256',
    syntheticFixture: true,
    sessionCreated: true,
    authenticatedReadback: true,
    databaseIdentityReadback: true,
    logoutConfirmed: true,
    revokedSessionRejected: true,
    databaseRevocationReadback: true,
    fixtureCleanup: 'deleted-and-read-back',
  });
  assert.equal(state.webhookCalls, 2);
  assert.equal(state.webhookBodiesSafe, true, 'Telegram fixture payload must contain update_id only');
  assert.equal(state.proofObserved, true);
  assert.ok(state.cleanupReadbacks >= 2);
  assert.ok(state.telegramCleanupReadbacks >= 2);
  assert.ok(requests.every((item) => item.cacheControl === 'no-cache, no-store, max-age=0' && item.pragma === 'no-cache'));
  assert.ok(requests.filter((item) => item.pathname.startsWith('/r/') || item.pathname.startsWith('/s/')).every((item) => item.redirect === 'manual'));
  assert.ok(requests.filter((item) => !item.pathname.startsWith('/r/') && !item.pathname.startsWith('/s/')).every((item) => item.redirect === 'error'));

  const serialized = JSON.stringify(result);
  for (const forbidden of [passwordValue, proofValue, signingKey, state.telegramHash, ...Object.values(sessionValues)]) assert.equal(serialized.includes(forbidden), false);
  assert.doesNotMatch(serialized, /password|access[_-]?token|refresh[_-]?token|authorization|webhook[_-]?secret|cookie/i);
});

test('business smoke fails closed on a wrong short-link target and still removes the uniquely traced user fixture', async () => {
  let cleanupCalls = 0;
  const fetch = async (url) => {
    const path = new URL(url).pathname;
    if (['/livez', '/readyz', '/__ops/version'].includes(path)) return response(url, 200, healthBody(path), { 'content-type': 'application/json', 'cache-control': 'no-store' });
    if (path === '/') return response(url, 200, '<!doctype html><div id="app"></div>', { 'content-type': 'text/html' });
    if (path.startsWith('/r/')) return response(url, 302, '', { location: '/wrong' });
    throw new Error('must stop before mutation');
  };
  await assert.rejects(runBusinessSmoke(args, { fetch, queryDatabase: async () => { cleanupCalls += 1; return '{}'; },
    readWebhookSecret: async () => 'unused_value' }), /referral short-link redirect target is not exact/);
  assert.equal(cleanupCalls, 0, 'short-link failure must happen before database mutation');
});

test('business smoke never deletes a foreign row that collides with the deterministic username', async () => {
  let deleteAttempted = false;
  let registrationAttempted = false;
  const fetch = async (url) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (parsed.hostname === 'oauth.telegram.org') return telegramWidgetResponse(url);
    if (['/livez', '/readyz', '/__ops/version'].includes(path)) return response(url, 200, healthBody(path), { 'content-type': 'application/json', 'cache-control': 'no-store' });
    if (path === '/') return response(url, 200, '<!doctype html><div id="app"></div>', { 'content-type': 'text/html' });
    if (path.startsWith('/r/')) return response(url, 302, '', { location: `/#/pages/login/register?ref=${path.slice(3)}` });
    if (path.startsWith('/s/')) return response(url, 302, '', { location: `/#/pages/booking/detail?slug=${path.slice(3)}` });
    if (path === '/api/auth/register') registrationAttempted = true;
    throw new Error('unexpected mutation');
  };
  const queryDatabase = async (sql) => {
    if (sql.includes("'telegram_rows'")) return JSON.stringify({ database: 'booking_preprod', db_user: 'booking_preprod', telegram_rows: 0, telegram_owned: 0 });
    if (sql.includes("'telegram_deleted'")) return JSON.stringify({ database: 'booking_preprod', db_user: 'booking_preprod', telegram_deleted: 0 });
    if (sql.includes("'telegram_remaining'")) return JSON.stringify({ database: 'booking_preprod', db_user: 'booking_preprod', telegram_remaining: 0 });
    if (sql.includes("'owned'")) return JSON.stringify({ database: 'booking_preprod', db_user: 'booking_preprod', rows: 1, owned: 0 });
    if (sql.startsWith('WITH deleted AS')) deleteAttempted = true;
    throw new Error('foreign row must stop cleanup');
  };
  await assert.rejects(runBusinessSmoke(args, { fetch, queryDatabase, readTelegramSigningKey: async () => TELEGRAM_SIGNING_KEY,
    telegramBotUsername: TELEGRAM_BOT_NAME }), /not exclusively owned/);
  assert.equal(deleteAttempted, false);
  assert.equal(registrationAttempted, false);
});

test('business smoke rejects disabled TLS validation before any network or database access', async () => {
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  let calls = 0;
  try {
    await assert.rejects(runBusinessSmoke(args, { fetch: async () => { calls += 1; }, queryDatabase: async () => { calls += 1; } }), /refuses disabled TLS/);
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
  }
});

test('business smoke fails before mutation when Telegram Login Widget rejects the preproduction BotFather domain', async () => {
  let databaseCalls = 0;
  let signingKeyReads = 0;
  const fetch = async (url) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (parsed.hostname === 'oauth.telegram.org') return telegramWidgetResponse(url, '<!doctype html><div>Bot domain invalid</div>');
    if (['/livez', '/readyz', '/__ops/version'].includes(path)) return response(url, 200, healthBody(path), { 'content-type': 'application/json', 'cache-control': 'no-store' });
    if (path === '/') return response(url, 200, '<!doctype html><div id="app"></div>', { 'content-type': 'text/html' });
    if (path.startsWith('/r/')) return response(url, 302, '', { location: `/#/pages/login/register?ref=${path.slice(3)}` });
    if (path.startsWith('/s/')) return response(url, 302, '', { location: `/#/pages/booking/detail?slug=${path.slice(3)}` });
    throw new Error('must stop before mutation');
  };
  await assert.rejects(runBusinessSmoke(args, { fetch, telegramBotUsername: TELEGRAM_BOT_NAME,
    readTelegramSigningKey: async () => { signingKeyReads += 1; return TELEGRAM_SIGNING_KEY; },
    queryDatabase: async () => { databaseCalls += 1; return '{}'; } }), /BotFather \/setdomain/);
  assert.equal(signingKeyReads, 0, 'domain rejection must happen before reading signing material');
  assert.equal(databaseCalls, 0, 'domain rejection must happen before database mutation');
});

test('business smoke never deletes or signs in over a foreign Telegram identity collision', async () => {
  let deleteAttempted = false;
  let telegramLoginAttempted = false;
  const fetch = async (url) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (parsed.hostname === 'oauth.telegram.org') return telegramWidgetResponse(url);
    if (['/livez', '/readyz', '/__ops/version'].includes(path)) return response(url, 200, healthBody(path), { 'content-type': 'application/json', 'cache-control': 'no-store' });
    if (path === '/') return response(url, 200, '<!doctype html><div id="app"></div>', { 'content-type': 'text/html' });
    if (path.startsWith('/r/')) return response(url, 302, '', { location: `/#/pages/login/register?ref=${path.slice(3)}` });
    if (path.startsWith('/s/')) return response(url, 302, '', { location: `/#/pages/booking/detail?slug=${path.slice(3)}` });
    if (path === '/api/auth/telegram') telegramLoginAttempted = true;
    throw new Error('foreign Telegram row must stop all mutation');
  };
  const queryDatabase = async (sql) => {
    if (sql.includes("'telegram_rows'")) return JSON.stringify({ database: 'booking_preprod', db_user: 'booking_preprod', telegram_rows: 1, telegram_owned: 0 });
    if (sql.includes("'telegram_deleted'")) deleteAttempted = true;
    throw new Error('foreign Telegram row must stop cleanup');
  };
  await assert.rejects(runBusinessSmoke(args, { fetch, queryDatabase, readTelegramSigningKey: async () => TELEGRAM_SIGNING_KEY,
    telegramBotUsername: TELEGRAM_BOT_NAME }), /Telegram fixture identity is not exclusively owned/);
  assert.equal(deleteAttempted, false);
  assert.equal(telegramLoginAttempted, false);
});

test('webhook proof metadata accepts root 0400/0440 and rejects unsafe owner, permissions, type, or symlink resolution', () => {
  const expected = '/fixed/preprod/proof';
  const metadata = (mode, uid = 0, file = true) => ({ mode, uid, isFile: () => file });
  assert.equal(validateWebhookSecretMetadata(expected, metadata(0o100400), expected), true);
  assert.equal(validateWebhookSecretMetadata(expected, metadata(0o100440), expected), true);
  for (const scenario of [
    [expected, metadata(0o100640)],
    [expected, metadata(0o100444)],
    [expected, metadata(0o100600)],
    [expected, metadata(0o100450)],
    [expected, metadata(0o100440, 1000)],
    [expected, metadata(0o040400, 0, false)],
    ['/resolved/symlink-target', metadata(0o100400)],
  ]) assert.throws(() => validateWebhookSecretMetadata(scenario[0], scenario[1], expected), /canonical, root-owned/);
});

test('Telegram signing key source is root-only, bounded, canonical and parsed without exposing unrelated environment values', () => {
  const expected = '/fixed/preprod/.env';
  const metadata = (mode, uid = 0, file = true, size = 100) => ({ mode, uid, size, isFile: () => file });
  assert.equal(validateTelegramSigningKeyMetadata(expected, metadata(0o100400), expected), true);
  assert.equal(validateTelegramSigningKeyMetadata(expected, metadata(0o100600), expected), true);
  for (const scenario of [
    [expected, metadata(0o100440)],
    [expected, metadata(0o100604)],
    [expected, metadata(0o100600, 1000)],
    [expected, metadata(0o040600, 0, false)],
    [expected, metadata(0o100200)],
    [expected, metadata(0o100600, 0, true, 0)],
    [expected, metadata(0o100600, 0, true, 16 * 1024 + 1)],
    ['/resolved/symlink-target', metadata(0o100600)],
  ]) assert.throws(() => validateTelegramSigningKeyMetadata(scenario[0], scenario[1], expected), /canonical, root-owned/);
  assert.equal(parseTelegramSigningKey(`POSTGRES_DB=booking_preprod\nTELEGRAM_BOT_TOKEN='${TELEGRAM_SIGNING_KEY}'\n`), TELEGRAM_SIGNING_KEY);
  assert.throws(() => parseTelegramSigningKey('TELEGRAM_BOT_TOKEN=short\n'), /signing key source is invalid/);
  assert.throws(() => parseTelegramSigningKey(`TELEGRAM_BOT_TOKEN=${TELEGRAM_SIGNING_KEY}\nTELEGRAM_BOT_TOKEN=${TELEGRAM_SIGNING_KEY}\n`), /signing key source is invalid/);
});
