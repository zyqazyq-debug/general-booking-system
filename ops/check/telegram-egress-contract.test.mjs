import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ContractError, validateReleaseManifest } from '../release/lib/contracts.mjs';
import { TELEGRAM_PROXY_URL, verifyTelegramEgressReceipt } from '../release/verify-telegram-egress.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const digest = (letter) => `sha256:${letter.repeat(64)}`;
const receipt = () => ({ schema: 'booking.telegram-egress-receipt/v1', status: 'pass', releaseId: 'booking-20260910T000000Z-0123456', manifestDigest: digest('a'), egress: { imageDigest: digest('b'), network: 'booking-preprod-telegram', proxyUrl: TELEGRAM_PROXY_URL }, transport: { target: 'api.telegram.org', tokenFree: true, httpStatus: 404 }, observedAt: '2026-09-10T00:00:00.000Z' });

test('egress receipt is token-free, network-bound, and immutable-image-bound', () => {
  assert.equal(verifyTelegramEgressReceipt(receipt(), { releaseId: receipt().releaseId, manifestDigest: digest('a'), imageDigest: digest('b') }).status, 'pass');
  for (const mutate of [
    (v) => { v.egress.proxyUrl = 'http://192.168.3.5:7893'; },
    (v) => { v.egress.network = 'bridge'; },
    (v) => { v.transport.tokenFree = false; },
    (v) => { v.transport.httpStatus = 200; },
  ]) { const value = receipt(); mutate(value); assert.throws(() => verifyTelegramEgressReceipt(value, { releaseId: value.releaseId, manifestDigest: digest('a'), imageDigest: digest('b') }), ContractError); }
});

test('egress overlay forbids shared proxy, host networking, ports, privileges and worker access', async () => {
  const [compose, dockerfile] = await Promise.all([readFile(resolve(root, 'ops/compose/compose.preprod-telegram-egress.yml'), 'utf8'), readFile(resolve(root, 'ops/telegram-egress/Dockerfile'), 'utf8')]);
  assert.match(compose, /image:\s*\$\{BOOKING_TELEGRAM_EGRESS_IMAGE:\?[^}]*\}@\$\{BOOKING_TELEGRAM_EGRESS_DIGEST:\?[^}]*\}/);
  assert.match(compose, /preprod-telegram:\s*\n\s*name: booking-preprod-telegram\s*\n\s*internal: true/);
  assert.match(compose, /TELEGRAM_PROXY_URL: socks5h:\/\/telegram-egress:1080/);
  assert.doesNotMatch(compose, /192\.168\.3\.5:7893|network_mode:|privileged:|^\s+ports:/m);
  assert.doesNotMatch(compose, /order-worker-(blue|green):/);
  assert.match(dockerfile, /FROM debian:bookworm-20260824-slim@sha256:[0-9a-f]{64}/);
  assert.match(dockerfile, /CLOUDFLARE_WARP_VERSION=2026\.7\.1377\.0/);
  assert.match(dockerfile, /CLOUDFLARE_WARP_DEB_SHA256=95d33c2b4fc42f21c204981c51470a6a679d618fb0b78ee64bdd0db142230c55/);
  assert.doesNotMatch(dockerfile, /:latest/);
});

test('manifest rejects mutable or incomplete Telegram egress identity', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'ops/contracts/examples/release-manifest.example.json'), 'utf8'));
  assert.equal(validateReleaseManifest(manifest), manifest);
  for (const mutate of [(v) => { v.artifacts.telegramEgress.image = 'registry.test/egress:latest'; }, (v) => { delete v.artifacts.telegramEgress.warpPackage.sha256; }]) {
    const value = structuredClone(manifest); mutate(value); assert.throws(() => validateReleaseManifest(value), ContractError);
  }
});
