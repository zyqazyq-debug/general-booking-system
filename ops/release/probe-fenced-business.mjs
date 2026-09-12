#!/usr/bin/env node
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ContractError, EXIT, parseArgs, sha256 } from './lib/contracts.mjs';
import { runPublicProbe } from './probe-fenced-public.mjs';

const ORIGIN = 'https://booking-preprod.happybooking.uk';
const DATABASE = 'booking_preprod';
const DATABASE_USER = 'booking_preprod';
const POSTGRES_CONTAINER = 'booking-preprod-postgres-1';
const PREPROD_ENV_FILE = '/volume1/happybooking/booking-preprod/.env';
const WEBHOOK_SECRET_FILE = '/volume1/happybooking/booking-preprod/.g4/secrets/telegram-webhook-secret';
const REQUEST_CACHE_CONTROL = 'no-cache, no-store, max-age=0';
const MAX_JSON_BYTES = 64 * 1024;
const MAX_HTML_BYTES = 512 * 1024;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RELEASE = /^booking-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/;
const SHA = /^[0-9a-f]{40}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TELEGRAM_BOT_USERNAME = /^[A-Za-z][A-Za-z0-9_]{1,28}bot$/i;
const TELEGRAM_BOT_TOKEN = /^\d+:[A-Za-z0-9_-]{20,}$/;
const REJECTED_CF_CACHE_STATUSES = new Set(['HIT', 'STALE', 'REVALIDATED', 'UPDATING']);

function fail(message, exitCode = EXIT.READINESS) {
  throw new ContractError(message, exitCode);
}

function fixtureIdentity(args) {
  const trace = `${args['operation-id']}:${args['action-id']}:${args.generation}:${args['fencing-epoch']}`;
  const hex = createHash('sha256').update(trace).digest('hex');
  const marker = `g4_${hex.slice(0, 24)}`;
  const value = 8_000_000_000_000_000n + (BigInt(`0x${hex.slice(24, 38)}`) % 100_000_000_000_000n);
  const telegramValue = 7_000_000_000_000_000n + (BigInt(`0x${hex.slice(38, 52)}`) % 100_000_000_000_000n);
  return { marker, updateId: Number(value), telegramId: Number(telegramValue) };
}

function validateArgs(args) {
  const publicKeys = ['release-id', 'git-sha', 'manifest-digest', 'slot', 'config-schema', 'migration-floor', 'migration-catalog-digest', 'telegram-bot-mode', 'telegram-webhook-enabled', 'telegram-webhook-url'];
  const required = [...publicKeys, 'operation-id', 'action-id', 'generation', 'fencing-epoch'];
  if (Object.keys(args).some((key) => !required.includes(key)) || required.some((key) => !args[key])) {
    fail('business smoke arguments are incomplete or attempt to override a fixed preproduction target', EXIT.IDENTITY);
  }
  if (!RELEASE.test(args['release-id']) || !SHA.test(args['git-sha']) || !DIGEST.test(args['manifest-digest']) ||
      !['blue', 'green'].includes(args.slot) || !IDENTIFIER.test(args['operation-id']) || !IDENTIFIER.test(args['action-id']) ||
      !/^\d+$/.test(args.generation) || !/^\d+$/.test(args['fencing-epoch']) || Number(args.generation) < 1 || Number(args['fencing-epoch']) < 1 ||
      !DIGEST.test(args['migration-catalog-digest']) || args['telegram-bot-mode'] !== 'webhook' ||
      args['telegram-webhook-enabled'] !== 'true' || args['telegram-webhook-url'] !== `${ORIGIN}/telegram/webhook`) {
    fail('business smoke identity is invalid', EXIT.IDENTITY);
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    fail('business smoke refuses disabled TLS certificate verification', EXIT.IDENTITY);
  }
}

function cacheHeaders(extra = {}) {
  return { 'cache-control': REQUEST_CACHE_CONTROL, pragma: 'no-cache', ...extra };
}

function assertFreshResponse(response, expectedUrl, { status, mediaType, allowRedirect = false }) {
  if (!response || response.url !== expectedUrl || response.redirected === true || response.status !== status) {
    fail('business smoke received a redirect, wrong origin, or unexpected HTTP status');
  }
  const age = response.headers?.get?.('age');
  if (age !== null && age !== undefined && age !== '' && (!/^\d+$/.test(String(age).trim()) || BigInt(String(age).trim()) > 0n)) {
    fail('business smoke response has cached Age metadata');
  }
  const cfStatuses = String(response.headers?.get?.('cf-cache-status') || '').split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
  if (cfStatuses.some((value) => REJECTED_CF_CACHE_STATUSES.has(value))) fail('business smoke response was served from a disallowed cache state');
  if (mediaType && !String(response.headers?.get?.('content-type') || '').toLowerCase().startsWith(mediaType)) {
    fail('business smoke response media type is invalid');
  }
}

async function boundedText(response, limit) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const value = await response.text();
    if (Buffer.byteLength(value) > limit) fail('business smoke response exceeds its bounded size');
    return value;
  }
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) fail('business smoke response stream is malformed');
      size += value.byteLength;
      if (size > limit) fail('business smoke response exceeds its bounded size');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size).toString('utf8');
  } finally {
    reader.releaseLock?.();
  }
}

async function request(fetcher, path, options, expected) {
  const url = `${ORIGIN}${path}`;
  let response;
  try {
    response = await fetcher(url, { redirect: expected.allowRedirect ? 'manual' : 'error', signal: AbortSignal.timeout(8_000), ...options,
      headers: cacheHeaders(options?.headers || {}) });
  } catch {
    fail('business smoke HTTPS request failed TLS validation or timed out');
  }
  assertFreshResponse(response, url, expected);
  return response;
}

async function externalRequest(fetcher, url, options, expected) {
  if (!url.startsWith('https://oauth.telegram.org/')) fail('Telegram widget probe target is outside its fixed TLS origin', EXIT.IDENTITY);
  let response;
  try {
    response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(8_000), ...options,
      headers: cacheHeaders(options?.headers || {}) });
  } catch {
    fail('Telegram widget HTTPS request failed TLS validation or timed out');
  }
  assertFreshResponse(response, url, expected);
  return response;
}

async function jsonRequest(fetcher, path, options, status) {
  const response = await request(fetcher, path, options, { status, mediaType: 'application/json' });
  let value;
  try { value = JSON.parse(await boundedText(response, MAX_JSON_BYTES)); }
  catch (error) { if (error instanceof ContractError) throw error; fail('business smoke API response is not JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('business smoke API response shape is invalid');
  return value;
}

function unwrapSuccess(value, label) {
  if (value.code !== 0 || value.message !== 'OK' || !value.data || typeof value.data !== 'object' || Array.isArray(value.data)) {
    fail(`${label} did not return the success envelope`);
  }
  return value.data;
}

function assertPair(value, label, requireUser = false) {
  const data = unwrapSuccess(value, label);
  if (typeof data.access_token !== 'string' || data.access_token.length < 16 || typeof data.refresh_token !== 'string' || data.refresh_token.length < 16 ||
      (requireUser && (!data.user || !UUID.test(data.user.id || '') || typeof data.user.username !== 'string'))) {
    fail(`${label} did not return a complete session pair`);
  }
  return data;
}

async function defaultCommandRunner(executable, argv, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, argv, { shell: false, windowsHide: true, stdio: [options.inputPath ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let size = 0;
    const collect = (target) => (chunk) => { size += chunk.length; if (size > MAX_JSON_BYTES) child.kill('SIGKILL'); else target.push(chunk); };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    if (options.inputPath) createReadStream(options.inputPath).pipe(child.stdin);
    const timer = setTimeout(() => child.kill('SIGTERM'), options.timeoutMs || 8_000);
    child.once('error', reject);
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolvePromise({ exitCode, signal, overflow: size > MAX_JSON_BYTES, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
  });
}

async function queryDatabase(sql, runtime) {
  if (runtime.queryDatabase) return runtime.queryDatabase(sql);
  const runner = runtime.commandRunner || defaultCommandRunner;
  const docker = runtime.dockerExecutable || '/var/packages/ContainerManager/target/usr/bin/docker';
  const result = await runner(docker, ['exec', POSTGRES_CONTAINER, 'psql', '--no-password', '--tuples-only', '--no-align', '--quiet',
    '--set', 'ON_ERROR_STOP=1', '--username', DATABASE_USER, '--dbname', DATABASE, '--command', sql], { timeoutMs: 8_000 });
  if (!result || result.exitCode !== 0 || result.signal || result.overflow) fail('isolated preproduction database query failed', EXIT.DATABASE);
  return result.stdout.trim();
}

function parseDatabaseJson(value, label) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    return parsed;
  } catch { fail(`${label} database readback is invalid`, EXIT.DATABASE); }
}

async function readWebhookSecret(runtime) {
  let value;
  if (runtime.readWebhookSecret) {
    value = await runtime.readWebhookSecret();
  } else {
    const canonical = await realpath(WEBHOOK_SECRET_FILE).catch(() => fail('fixed preproduction webhook proof file is unavailable', EXIT.IDENTITY));
    const metadata = await stat(canonical);
    validateWebhookSecretMetadata(canonical, metadata);
    value = (await readFile(canonical, 'utf8')).trim();
  }
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(value)) fail('fixed preproduction webhook proof is invalid', EXIT.IDENTITY);
  return value;
}

export function validateWebhookSecretMetadata(canonical, metadata, expectedPath = WEBHOOK_SECRET_FILE) {
  const permissions = metadata?.mode & 0o777;
  if (canonical !== expectedPath || !metadata?.isFile?.() || metadata.uid !== 0 || ![0o400, 0o440].includes(permissions)) {
    fail('fixed preproduction webhook proof file must be canonical, root-owned, non-writable, non-executable, and inaccessible to others', EXIT.IDENTITY);
  }
  return true;
}

export function validateTelegramSigningKeyMetadata(canonical, metadata, expectedPath = PREPROD_ENV_FILE) {
  const permissions = metadata?.mode & 0o777;
  if (canonical !== expectedPath || !metadata?.isFile?.() || metadata.uid !== 0 || (permissions & 0o400) === 0 || (permissions & 0o077) !== 0 ||
      !Number.isInteger(metadata.size) || metadata.size < 1 || metadata.size > 16 * 1024) {
    fail('fixed preproduction environment file must be canonical, root-owned, owner-readable, and inaccessible to group or others', EXIT.IDENTITY);
  }
  return true;
}

export function parseTelegramSigningKey(contents) {
  if (typeof contents !== 'string' || Buffer.byteLength(contents) > 16 * 1024) fail('fixed preproduction Telegram signing key source is invalid', EXIT.IDENTITY);
  const matches = contents.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('TELEGRAM_BOT_TOKEN='));
  if (matches.length !== 1) fail('fixed preproduction Telegram signing key source is invalid', EXIT.IDENTITY);
  let value = matches[0].slice('TELEGRAM_BOT_TOKEN='.length).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  if (!TELEGRAM_BOT_TOKEN.test(value)) fail('fixed preproduction Telegram signing key source is invalid', EXIT.IDENTITY);
  return value;
}

async function readTelegramSigningKey(runtime) {
  if (runtime.readTelegramSigningKey) {
    const value = await runtime.readTelegramSigningKey();
    if (!TELEGRAM_BOT_TOKEN.test(value || '')) fail('fixed preproduction Telegram signing key source is invalid', EXIT.IDENTITY);
    return value;
  }
  const canonical = await realpath(PREPROD_ENV_FILE).catch(() => fail('fixed preproduction environment file is unavailable', EXIT.IDENTITY));
  const metadata = await stat(canonical);
  validateTelegramSigningKeyMetadata(canonical, metadata);
  return parseTelegramSigningKey(await readFile(canonical, 'utf8'));
}

function telegramBotUsername(runtime) {
  const value = runtime.telegramBotUsername || process.env.BOOKING_TELEGRAM_BOT_NAME;
  if (!TELEGRAM_BOT_USERNAME.test(value || '')) fail('manifest-bound preproduction Telegram bot username is unavailable or invalid', EXIT.IDENTITY);
  return value;
}

async function probeTelegramWidget(fetcher, botUsername) {
  const url = `https://oauth.telegram.org/embed/${botUsername}?origin=${encodeURIComponent(ORIGIN)}&size=large&request_access=write`;
  const response = await externalRequest(fetcher, url, { method: 'GET', headers: { accept: 'text/html' } }, { status: 200, mediaType: 'text/html' });
  const html = await boundedText(response, 128 * 1024);
  if (/bot\s+domain\s+invalid|domain\s+invalid/i.test(html)) fail('Telegram Login Widget rejected the preproduction origin; verify BotFather /setdomain');
  if (!/TWidgetLogin\.init\s*\(/.test(html) || !/tgme_widget_login/.test(html)) {
    fail('Telegram Login Widget embed did not initialize for the preproduction origin');
  }
  return {
    origin: ORIGIN,
    botUsername,
    transport: 'tls-validated-no-redirect-no-cache',
    domainAccepted: true,
    embedInitialized: true,
  };
}

function signedTelegramLogin(fixture, signingKey, runtime) {
  const now = runtime.now instanceof Date ? runtime.now : new Date(runtime.now || Date.now());
  if (!Number.isFinite(now.getTime())) fail('Telegram login smoke clock is invalid', EXIT.IDENTITY);
  const data = { id: fixture.telegramId, first_name: 'G4 Smoke Fixture', username: fixture.marker,
    auth_date: Math.floor(now.getTime() / 1000) };
  const checkString = Object.entries(data).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secretKey = createHash('sha256').update(signingKey).digest();
  return { ...data, hash: createHmac('sha256', secretKey).update(checkString).digest('hex'),
    deviceInfo: { purpose: 'g4-telegram-login-smoke', fixture: fixture.marker } };
}

function sqlLiteral(value) {
  if (!/^[A-Za-z0-9_.@-]+$/.test(value)) fail('business smoke fixture identity cannot be used for database readback', EXIT.IDENTITY);
  return `'${value}'`;
}

async function cleanupFixture(runtime, marker, userId = null) {
  const ownershipMarker = `${marker}@smoke.invalid`;
  const ownedRaw = await queryDatabase(`SELECT json_build_object('database',current_database(),'db_user',current_user,'rows',count(*),'owned',count(*) FILTER (WHERE email = ${sqlLiteral(ownershipMarker)}))::text FROM public."user" WHERE username = ${sqlLiteral(marker)};`, runtime);
  const ownership = parseDatabaseJson(ownedRaw, 'fixture ownership');
  if (ownership.database !== DATABASE || ownership.db_user !== DATABASE_USER || !Number.isInteger(ownership.rows) ||
      !Number.isInteger(ownership.owned) || ownership.rows > 1 || ownership.owned !== ownership.rows) {
    fail('deterministic fixture username is not exclusively owned by the business smoke', EXIT.DATABASE);
  }
  const idPredicate = userId && UUID.test(userId) ? `id = ${sqlLiteral(userId)}::uuid AND ` : '';
  const deleted = await queryDatabase(`WITH deleted AS (DELETE FROM public."user" WHERE ${idPredicate}username = ${sqlLiteral(marker)} AND email = ${sqlLiteral(ownershipMarker)} RETURNING id) SELECT json_build_object('database',current_database(),'db_user',current_user,'deleted',count(*))::text FROM deleted;`, runtime);
  const cleanup = parseDatabaseJson(deleted, 'fixture cleanup');
  if (cleanup.database !== DATABASE || cleanup.db_user !== DATABASE_USER || !Number.isInteger(cleanup.deleted) || cleanup.deleted > 1) {
    fail('fixture cleanup database identity is invalid', EXIT.DATABASE);
  }
  const remaining = await queryDatabase(`SELECT json_build_object('database',current_database(),'db_user',current_user,'remaining',count(*))::text FROM public."user" WHERE username = ${sqlLiteral(marker)};`, runtime);
  const proof = parseDatabaseJson(remaining, 'fixture cleanup');
  if (proof.database !== DATABASE || proof.db_user !== DATABASE_USER || proof.remaining !== 0) fail('business smoke test user cleanup was not read back', EXIT.DATABASE);
  return cleanup.deleted;
}

async function userReadback(runtime, marker, userId, expectedTokens, expectedRevoked) {
  const ownershipMarker = `${marker}@smoke.invalid`;
  const raw = await queryDatabase(`SELECT json_build_object('database',current_database(),'db_user',current_user,'rows',count(*),'sessions',(SELECT count(*) FROM public.user_tokens t WHERE t.user_id = ${sqlLiteral(userId)}::uuid),'revoked',(SELECT count(*) FROM public.user_tokens t WHERE t.user_id = ${sqlLiteral(userId)}::uuid AND t.revoked_at IS NOT NULL))::text FROM public."user" u WHERE u.id = ${sqlLiteral(userId)}::uuid AND u.username = ${sqlLiteral(marker)} AND u.email = ${sqlLiteral(ownershipMarker)};`, runtime);
  const proof = parseDatabaseJson(raw, 'test user');
  if (proof.database !== DATABASE || proof.db_user !== DATABASE_USER || proof.rows !== 1 || proof.sessions !== expectedTokens || proof.revoked !== expectedRevoked) {
    fail('test user database write/readback mismatch', EXIT.DATABASE);
  }
  return proof;
}

function telegramUsernamePrefix(telegramId) {
  return `tg_${telegramId}_`;
}

async function cleanupTelegramFixture(runtime, fixture, generatedUsername = null) {
  const telegramId = String(fixture.telegramId);
  const prefix = telegramUsernamePrefix(telegramId);
  const ownedRaw = await queryDatabase(`SELECT json_build_object('database',current_database(),'db_user',current_user,'telegram_rows',count(*),'telegram_owned',count(*) FILTER (WHERE telegram_username = ${sqlLiteral(fixture.marker)} AND nickname = 'G4 Smoke Fixture' AND username LIKE ${sqlLiteral(prefix)} || '%'))::text FROM public."user" WHERE telegram_chat_id = ${sqlLiteral(telegramId)};`, runtime);
  const ownership = parseDatabaseJson(ownedRaw, 'Telegram fixture ownership');
  if (ownership.database !== DATABASE || ownership.db_user !== DATABASE_USER || !Number.isInteger(ownership.telegram_rows) ||
      !Number.isInteger(ownership.telegram_owned) || ownership.telegram_rows > 1 || ownership.telegram_owned !== ownership.telegram_rows) {
    fail('deterministic Telegram fixture identity is not exclusively owned by the business smoke', EXIT.DATABASE);
  }
  const usernamePredicate = generatedUsername ? `username = ${sqlLiteral(generatedUsername)} AND ` : `username LIKE ${sqlLiteral(prefix)} || '%' AND `;
  const deleted = await queryDatabase(`WITH deleted AS (DELETE FROM public."user" WHERE ${usernamePredicate}telegram_chat_id = ${sqlLiteral(telegramId)} AND telegram_username = ${sqlLiteral(fixture.marker)} AND nickname = 'G4 Smoke Fixture' RETURNING id) SELECT json_build_object('database',current_database(),'db_user',current_user,'telegram_deleted',count(*))::text FROM deleted;`, runtime);
  const cleanup = parseDatabaseJson(deleted, 'Telegram fixture cleanup');
  if (cleanup.database !== DATABASE || cleanup.db_user !== DATABASE_USER || !Number.isInteger(cleanup.telegram_deleted) || cleanup.telegram_deleted > 1) {
    fail('Telegram fixture cleanup database identity is invalid', EXIT.DATABASE);
  }
  const remaining = await queryDatabase(`SELECT json_build_object('database',current_database(),'db_user',current_user,'telegram_remaining',count(*))::text FROM public."user" WHERE telegram_chat_id = ${sqlLiteral(telegramId)};`, runtime);
  const proof = parseDatabaseJson(remaining, 'Telegram fixture cleanup');
  if (proof.database !== DATABASE || proof.db_user !== DATABASE_USER || proof.telegram_remaining !== 0) {
    fail('business smoke Telegram test user cleanup was not read back', EXIT.DATABASE);
  }
  return cleanup.telegram_deleted;
}

async function telegramUserReadback(runtime, fixture, userId, username, expectedTokens, expectedRevoked) {
  const raw = await queryDatabase(`SELECT json_build_object('database',current_database(),'db_user',current_user,'telegram_user_rows',count(*),'telegram_sessions',(SELECT count(*) FROM public.user_tokens t WHERE t.user_id = ${sqlLiteral(userId)}::uuid),'telegram_revoked',(SELECT count(*) FROM public.user_tokens t WHERE t.user_id = ${sqlLiteral(userId)}::uuid AND t.revoked_at IS NOT NULL))::text FROM public."user" u WHERE u.id = ${sqlLiteral(userId)}::uuid AND u.username = ${sqlLiteral(username)} AND u.telegram_chat_id = ${sqlLiteral(String(fixture.telegramId))} AND u.telegram_username = ${sqlLiteral(fixture.marker)} AND u.nickname = 'G4 Smoke Fixture' AND u.is_verified = true;`, runtime);
  const proof = parseDatabaseJson(raw, 'Telegram test user');
  if (proof.database !== DATABASE || proof.db_user !== DATABASE_USER || proof.telegram_user_rows !== 1 ||
      proof.telegram_sessions !== expectedTokens || proof.telegram_revoked !== expectedRevoked) {
    fail('Telegram test user database write/readback mismatch', EXIT.DATABASE);
  }
  return proof;
}

async function telegramReadback(runtime, updateId) {
  const raw = await queryDatabase(`SELECT json_build_object('database',current_database(),'db_user',current_user,'rows',count(*),'processed',count(*) FILTER (WHERE status = 'processed'),'has_processed_at',bool_and(processed_at IS NOT NULL),'operations',(SELECT count(*) FROM public.telegram_webhook_operations o WHERE o.update_id = ${updateId}))::text FROM public.telegram_webhook_updates WHERE update_id = ${updateId};`, runtime);
  const proof = parseDatabaseJson(raw, 'Telegram inbox');
  if (proof.database !== DATABASE || proof.db_user !== DATABASE_USER || proof.rows !== 1 || proof.processed !== 1 || proof.has_processed_at !== true || proof.operations !== 0) {
    fail('Telegram duplicate-delivery inbox readback mismatch', EXIT.DATABASE);
  }
  return proof;
}

export async function runBusinessSmoke(args, runtime = {}) {
  validateArgs(args);
  const fetcher = runtime.fetch || fetch;
  const fixture = fixtureIdentity(args);
  const publicIdentity = await runPublicProbe(Object.fromEntries(Object.entries(args).filter(([key]) => !['operation-id', 'action-id', 'generation', 'fencing-epoch'].includes(key))), { fetch: fetcher });
  const rootNonce = randomUUID();
  const root = await request(fetcher, `/?nonce=${rootNonce}`, { method: 'GET', headers: { accept: 'text/html' } }, { status: 200, mediaType: 'text/html' });
  const rootHtml = await boundedText(root, MAX_HTML_BYTES);
  if (!/^\s*<!doctype html/i.test(rootHtml) || !/<div[^>]+id=["']app["']/i.test(rootHtml)) fail('public root UI shell is incomplete');

  const shortCode = `G4${fixture.marker.slice(3, 15).toUpperCase()}`;
  const referralShort = await request(fetcher, `/r/${shortCode}`, { method: 'GET', headers: { accept: 'text/html' } }, { status: 302, allowRedirect: true });
  const expectedReferralLocation = `/#/pages/login/register?ref=${shortCode}`;
  if (referralShort.headers?.get?.('location') !== expectedReferralLocation) fail('public referral short-link redirect target is not exact');
  const shareSlug = fixture.marker;
  const shareShort = await request(fetcher, `/s/${shareSlug}`, { method: 'GET', headers: { accept: 'text/html' } }, { status: 302, allowRedirect: true });
  const expectedShareLocation = `/#/pages/booking/detail?slug=${shareSlug}`;
  if (shareShort.headers?.get?.('location') !== expectedShareLocation) fail('public share short-link redirect target is not exact');

  const botUsername = telegramBotUsername(runtime);
  const telegramWidget = await probeTelegramWidget(fetcher, botUsername);
  const signingKey = await readTelegramSigningKey(runtime);
  const telegramLoginBody = signedTelegramLogin(fixture, signingKey, runtime);

  await cleanupTelegramFixture(runtime, fixture);
  await cleanupFixture(runtime, fixture.marker);
  const password = `${randomBytes(32).toString('base64url')}Aa1!`;
  const ownershipMarker = `${fixture.marker}@smoke.invalid`;
  let userId = null;
  try {
    const registered = assertPair(await jsonRequest(fetcher, '/api/auth/register', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ username: fixture.marker, password, email: ownershipMarker, locale: 'zh-CN' }) }, 201), 'registration', true);
    if (registered.user.username !== fixture.marker) fail('registration returned the wrong fixture identity');
    userId = registered.user.id;
    await userReadback(runtime, fixture.marker, userId, 1, 0);

    const loggedIn = assertPair(await jsonRequest(fetcher, '/api/auth/login', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ username: fixture.marker, password, deviceInfo: { purpose: 'g4-business-smoke', fixture: fixture.marker } }) }, 201), 'login', true);
    if (loggedIn.user.id !== userId || loggedIn.user.username !== fixture.marker) fail('login returned the wrong fixture identity');
    const refreshed = assertPair(await jsonRequest(fetcher, '/api/auth/refresh', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: loggedIn.refresh_token }) }, 201), 'refresh');
    if (refreshed.refresh_token === loggedIn.refresh_token || refreshed.access_token === loggedIn.access_token) fail('refresh did not rotate the session pair');

    const me = unwrapSuccess(await jsonRequest(fetcher, '/api/users/me', { method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${refreshed.access_token}` } }, 200), 'authenticated user readback');
    if (me.id !== userId || me.username !== fixture.marker) fail('authenticated user readback returned the wrong identity');
    const logout = unwrapSuccess(await jsonRequest(fetcher, '/api/auth/logout', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${refreshed.access_token}` },
      body: JSON.stringify({ refresh_token: refreshed.refresh_token }) }, 201), 'logout');
    if (logout.success !== true) fail('logout did not confirm session revocation');
    await jsonRequest(fetcher, '/api/auth/refresh', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshed.refresh_token }) }, 401);
    const initialLogout = unwrapSuccess(await jsonRequest(fetcher, '/api/auth/logout', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${registered.access_token}` },
      body: JSON.stringify({ refresh_token: registered.refresh_token }) }, 201), 'registration-session logout');
    if (initialLogout.success !== true) fail('registration session was not revoked');
    await userReadback(runtime, fixture.marker, userId, 2, 2);
  } finally {
    await cleanupFixture(runtime, fixture.marker, userId);
  }

  let telegramUserId = null;
  let telegramGeneratedUsername = null;
  try {
    const telegramSession = assertPair(await jsonRequest(fetcher, '/api/auth/telegram', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(telegramLoginBody) }, 201), 'signed Telegram login', true);
    telegramUserId = telegramSession.user.id;
    telegramGeneratedUsername = telegramSession.user.username;
    const expectedPrefix = telegramUsernamePrefix(fixture.telegramId);
    if (!telegramGeneratedUsername.startsWith(expectedPrefix) || !/^[a-z0-9]+$/.test(telegramGeneratedUsername.slice(expectedPrefix.length))) {
      fail('signed Telegram login returned the wrong synthetic fixture identity');
    }
    await telegramUserReadback(runtime, fixture, telegramUserId, telegramGeneratedUsername, 1, 0);

    const telegramMe = unwrapSuccess(await jsonRequest(fetcher, '/api/users/me', { method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${telegramSession.access_token}` } }, 200), 'Telegram authenticated user readback');
    if (telegramMe.id !== telegramUserId || telegramMe.username !== telegramGeneratedUsername) fail('Telegram authenticated readback returned the wrong fixture identity');
    const telegramLogout = unwrapSuccess(await jsonRequest(fetcher, '/api/auth/logout', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${telegramSession.access_token}` },
      body: JSON.stringify({ refresh_token: telegramSession.refresh_token }) }, 201), 'Telegram session logout');
    if (telegramLogout.success !== true) fail('Telegram session logout did not confirm revocation');
    await jsonRequest(fetcher, '/api/auth/refresh', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: telegramSession.refresh_token }) }, 401);
    await telegramUserReadback(runtime, fixture, telegramUserId, telegramGeneratedUsername, 1, 1);
  } finally {
    await cleanupTelegramFixture(runtime, fixture, telegramGeneratedUsername);
  }

  const webhookProof = await readWebhookSecret(runtime);
  const deliveryCodes = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request(fetcher, '/telegram/webhook', { method: 'POST', headers: { accept: 'text/plain', 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': webhookProof },
      body: JSON.stringify({ update_id: fixture.updateId }) }, { status: 200 });
    deliveryCodes.push(response.status);
  }
  const inbox = await telegramReadback(runtime, fixture.updateId);

  return {
    schema: 'booking.preprod-business-smoke/v2', status: 'pass', origin: ORIGIN,
    releaseId: args['release-id'], gitSha: args['git-sha'], manifestDigest: args['manifest-digest'], slot: args.slot,
    configSchema: args['config-schema'], migrationFloor: args['migration-floor'], migrationCatalogDigest: args['migration-catalog-digest'],
    telegramBotMode: 'webhook', telegramWebhookEnabled: true, telegramWebhookUrl: `${ORIGIN}/telegram/webhook`,
    fixture: { marker: fixture.marker, updateId: fixture.updateId, operationId: args['operation-id'], actionId: args['action-id'], generation: Number(args.generation), fencingEpoch: Number(args['fencing-epoch']) },
    checks: {
      publicIdentity: { status: publicIdentity.status },
      rootUi: { statusCode: root.status, bodyDigest: sha256(rootHtml) },
      sessionChain: { registered: true, loggedIn: true, rotated: true, authenticatedReadback: true, loggedOut: true, revokedReadback: true },
      shortLinks: {
        referral: { statusCode: referralShort.status, location: expectedReferralLocation },
        share: { statusCode: shareShort.status, location: expectedShareLocation },
      },
      database: { database: DATABASE, databaseUser: DATABASE_USER, writeReadback: true, sessionRows: 2, revokedRows: 2,
        fixtureOwnership: 'username-and-smoke-email', fixtureCleanup: 'deleted-and-read-back' },
      telegramWidget,
      telegramLogin: {
        signatureAlgorithm: 'sha256-bot-token+hmac-sha256',
        syntheticFixture: true,
        sessionCreated: true,
        authenticatedReadback: true,
        databaseIdentityReadback: true,
        logoutConfirmed: true,
        revokedSessionRejected: true,
        databaseRevocationReadback: true,
        fixtureCleanup: 'deleted-and-read-back',
      },
      telegramInbox: { deliveryStatusCodes: deliveryCodes, rowCount: inbox.rows, processedCount: inbox.processed, processedAtPresent: inbox.has_processed_at, sideEffectOperations: inbox.operations },
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let output;
  let exitCode = EXIT.PASS;
  try { output = await runBusinessSmoke(parseArgs(process.argv.slice(2))); }
  catch (error) {
    const failure = error instanceof ContractError ? error : new ContractError('preproduction business smoke failed', EXIT.READINESS);
    exitCode = failure.exitCode;
    output = { status: 'fail', code: 'PREPROD_BUSINESS_SMOKE_REJECTED', detail: failure.message };
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = exitCode;
}
