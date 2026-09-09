import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { load as loadYaml } from 'js-yaml';
import { ContractError, validateReleaseManifest } from '../release/lib/contracts.mjs';
import { TELEGRAM_PROXY_URL, verifyTelegramEgressReceipt } from '../release/verify-telegram-egress.mjs';
import { verifyTelegramComposeConfig, verifyTelegramEgressRuntime } from '../release/execute-fenced-action.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const digest = (letter) => `sha256:${letter.repeat(64)}`;
const nowMs = Date.parse('2026-09-10T00:00:30.000Z');
const receipt = () => ({ schema: 'booking.telegram-egress-receipt/v1', status: 'pass', operationId: 'op-1', releaseId: 'booking-20260910T000000Z-0123456', manifestDigest: digest('a'), egress: { imageDigest: digest('b'), network: 'booking-preprod-telegram', proxyUrl: TELEGRAM_PROXY_URL }, container: { id: 'c'.repeat(64), imageId: digest('d'), composeProject: 'booking-preprod', composeService: 'telegram-egress' }, transport: { scheme: 'https', target: 'api.telegram.org', path: '/botinvalid/getMe', tokenFree: true, httpStatus: 404 }, observedAt: '2026-09-10T00:00:00.000Z' });
const expectedReceipt = (value = receipt()) => ({ operationId: 'op-1', releaseId: value.releaseId, manifestDigest: digest('a'), imageDigest: digest('b'), containerId: 'c'.repeat(64), containerImageId: digest('d'), nowMs });

test('egress receipt is token-free, network-bound, and immutable-image-bound', () => {
  assert.equal(verifyTelegramEgressReceipt(receipt(), expectedReceipt()).status, 'pass');
  for (const mutate of [
    (v) => { v.egress.proxyUrl = 'http://192.168.3.5:7893'; },
    (v) => { v.egress.network = 'bridge'; },
    (v) => { v.transport.tokenFree = false; },
    (v) => { v.transport.httpStatus = 403; },
    (v) => { v.transport.httpStatus = 200; },
    (v) => { v.observedAt = '2026-09-09T23:00:00.000Z'; },
    (v) => { v.container.id = 'e'.repeat(64); },
    (v) => { v.extra = 'not-allowed'; },
  ]) { const value = receipt(); mutate(value); assert.throws(() => verifyTelegramEgressReceipt(value, expectedReceipt(value)), ContractError); }
});

test('egress overlay forbids shared proxy, host networking, ports and privileges while constraining worker access', async () => {
  const [compose, dockerfile, entrypoint, healthcheck, readback] = await Promise.all([
    readFile(resolve(root, 'ops/compose/compose.preprod-telegram-egress.yml'), 'utf8'),
    readFile(resolve(root, 'ops/telegram-egress/Dockerfile'), 'utf8'),
    readFile(resolve(root, 'ops/telegram-egress/entrypoint.sh'), 'utf8'),
    readFile(resolve(root, 'ops/telegram-egress/healthcheck.sh'), 'utf8'),
    readFile(resolve(root, 'ops/telegram-egress/readback.sh'), 'utf8'),
  ]);
  assert.match(compose, /image:\s*\$\{BOOKING_TELEGRAM_EGRESS_IMAGE:\?[^}]*\}@\$\{BOOKING_TELEGRAM_EGRESS_DIGEST:\?[^}]*\}/);
  assert.match(compose, /preprod-telegram:\s*\n\s*name: booking-preprod-telegram\s*\n\s*internal: true/);
  assert.match(compose, /TELEGRAM_PROXY_URL: socks5h:\/\/telegram-egress:1080/);
  assert.doesNotMatch(compose, /192\.168\.3\.5:7893|network_mode:|privileged:|^\s+ports:/m);
  assert.match(compose, /order-worker-(blue|green):/);
  assert.match(dockerfile, /ARG TELEGRAM_EGRESS_BASE_IMAGE=debian:bookworm-20260824-slim@sha256:[0-9a-f]{64}/);
  assert.match(dockerfile, /CLOUDFLARE_WARP_VERSION=2026\.7\.1377\.0/);
  assert.match(dockerfile, /CLOUDFLARE_WARP_DEB_SHA256=95d33c2b4fc42f21c204981c51470a6a679d618fb0b78ee64bdd0db142230c55/);
  assert.match(dockerfile, /ARG TELEGRAM_EGRESS_DEBIAN_MIRROR=https:\/\/deb\.debian\.org\/debian/);
  assert.match(dockerfile, /ARG TELEGRAM_EGRESS_DEBIAN_SECURITY_MIRROR=https:\/\/deb\.debian\.org\/debian-security/);
  assert.match(dockerfile, /uk\.happybooking\.apt\.debian-mirror="\$TELEGRAM_EGRESS_DEBIAN_MIRROR"/);
  assert.match(dockerfile, /uk\.happybooking\.apt\.security-mirror="\$TELEGRAM_EGRESS_DEBIAN_SECURITY_MIRROR"/);
  assert.doesNotMatch(dockerfile, /:latest/);
  assert.match(entrypoint, /trap cleanup EXIT/);
  assert.match(entrypoint, /trap 'exit 1' INT TERM/);
  assert.match(entrypoint, /dbus-daemon --system --nofork --nopidfile &/);
  assert.match(entrypoint, /timeout 30 warp-cli --accept-tos registration new/);
  assert.match(entrypoint, /timeout 15 warp-cli --accept-tos proxy port 40000/);
  assert.match(entrypoint, /kill -0 "\$warp_pid" 2>\/dev\/null \|\| exit 1/);
  assert.match(entrypoint, /while kill -0 "\$dbus_pid"[^\n]+kill -0 "\$warp_pid"[^\n]+kill -0 "\$socat_pid"/);
  assert.match(healthcheck, /Status update:\[\[:space:\]\]\*Connected/);
  assert.match(healthcheck, /\[ "\$code" = 404 \]/);
  assert.match(healthcheck, /"ok":false,"error_code":404,"description":"Not Found"/);
  assert.match(readback, /https:\/\/api\.telegram\.org\/botinvalid\/getMe/);
  assert.doesNotMatch(readback, /TELEGRAM_BOT_TOKEN/);
});

test('actual base plus overlay Compose merge preserves app/data/Telegram networks and worker delivery access', async () => {
  const mergeCompose = (base, overlay) => {
    if (Array.isArray(base) && Array.isArray(overlay)) return [...base, ...overlay];
    if (base && overlay && typeof base === 'object' && typeof overlay === 'object' && !Array.isArray(base) && !Array.isArray(overlay)) {
      return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(overlay)])]
        .map((key) => [key, Object.hasOwn(overlay, key) && Object.hasOwn(base, key) ? mergeCompose(base[key], overlay[key]) : structuredClone(overlay[key] ?? base[key])]));
    }
    return structuredClone(overlay);
  };
  const [baseText, overlayText] = await Promise.all([
    readFile(resolve(root, 'ops/compose/compose.preprod.yml'), 'utf8'),
    readFile(resolve(root, 'ops/compose/compose.preprod-telegram-egress.yml'), 'utf8'),
  ]);
  const config = mergeCompose(loadYaml(baseText), loadYaml(overlayText));
  assert.equal(verifyTelegramComposeConfig(JSON.stringify(config)).backendNetworks.length, 3);
  const broken = structuredClone(config);
  broken.services['backend-blue'].networks = broken.services['backend-blue'].networks.filter((network) => network !== 'preprod-data');
  assert.throws(() => verifyTelegramComposeConfig(JSON.stringify(broken)), /lost a required base/);
});

test('runtime readback binds exact egress image labels, container isolation, networks, mounts, and environment', () => {
  const state = { project: 'booking-preprod' };
  const releaseIdentity = { releaseId: 'booking-20260910T000000Z-0123456', gitSha: '1'.repeat(40), manifestDigest: digest('a') };
  const manifest = { artifacts: { telegramEgress: { digest: digest('b'), baseImage: 'debian:bookworm-20260824-slim',
    baseImageDigest: 'sha256:5ae3c39ebd15e229dcedd5cee596b2497182493d41ff162e824ba13fc1b2b867',
    aptSources: { debianMirror: 'https://mirrors.ustc.edu.cn/debian', securityMirror: 'https://mirrors.ustc.edu.cn/debian-security' },
    warpPackage: { version: '2026.7.1377.0', sha256: '95d33c2b4fc42f21c204981c51470a6a679d618fb0b78ee64bdd0db142230c55' } } } };
  const lines = [
    { 'com.docker.compose.project': state.project, 'com.docker.compose.service': 'telegram-egress',
      'org.opencontainers.image.revision': releaseIdentity.gitSha, 'uk.happybooking.release-id': releaseIdentity.releaseId,
      'uk.happybooking.component': 'telegram-egress',
      'uk.happybooking.base-image': `${manifest.artifacts.telegramEgress.baseImage}@${manifest.artifacts.telegramEgress.baseImageDigest}`,
      'uk.happybooking.apt.debian-mirror': manifest.artifacts.telegramEgress.aptSources.debianMirror,
      'uk.happybooking.apt.security-mirror': manifest.artifacts.telegramEgress.aptSources.securityMirror,
      'uk.happybooking.cloudflare-warp.version': manifest.artifacts.telegramEgress.warpPackage.version,
      'uk.happybooking.cloudflare-warp.deb-sha256': manifest.artifacts.telegramEgress.warpPackage.sha256 },
    [`BOOKING_RELEASE_ID=${releaseIdentity.releaseId}`, `BOOKING_GIT_SHA=${releaseIdentity.gitSha}`,
      `BOOKING_MANIFEST_DIGEST=${releaseIdentity.manifestDigest}`, `BOOKING_TELEGRAM_EGRESS_DIGEST=${manifest.artifacts.telegramEgress.digest}`],
    [{ Type: 'tmpfs', Source: '', Destination: '/run', RW: true }, { Type: 'tmpfs', Source: '', Destination: '/tmp', RW: true },
      { Type: 'volume', Source: 'booking-preprod-telegram-warp-state', Destination: '/var/lib/cloudflare-warp', RW: true },
      { Type: 'tmpfs', Source: '', Destination: '/var/log/cloudflare-warp', RW: true }],
    { 'booking-preprod-telegram': {}, 'booking-preprod-warp-uplink': {} }, true, ['ALL'], [], ['no-new-privileges:true'], {},
    '0:0', false, '', '', [],
  ];
  const stdout = lines.map((value) => JSON.stringify(value)).join('\n');
  assert.equal(verifyTelegramEgressRuntime(stdout, state, releaseIdentity, manifest).publishedPorts, 0);
  const privileged = [...lines]; privileged[10] = true;
  assert.throws(() => verifyTelegramEgressRuntime(privileged.map((value) => JSON.stringify(value)).join('\n'), state, releaseIdentity, manifest), /isolation/);
  const leaked = structuredClone(lines); leaked[1].push('TELEGRAM_BOT_TOKEN=secret');
  assert.throws(() => verifyTelegramEgressRuntime(leaked.map((value) => JSON.stringify(value)).join('\n'), state, releaseIdentity, manifest), /environment/);
});

test('manifest rejects mutable or incomplete Telegram egress identity', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'ops/contracts/examples/release-manifest.example.json'), 'utf8'));
  assert.equal(validateReleaseManifest(manifest), manifest);
  for (const mutate of [(v) => { v.artifacts.telegramEgress.image = 'registry.test/egress:latest'; },
    (v) => { delete v.artifacts.telegramEgress.warpPackage.sha256; },
    (v) => { v.artifacts.telegramEgress.aptSources.debianMirror = 'http://mirrors.ustc.edu.cn/debian'; },
    (v) => { delete v.artifacts.telegramEgress.aptSources.securityMirror; },
    (v) => { v.artifacts.telegramEgress.aptSources.unrecordedMirror = 'https://unknown.example/debian'; }]) {
    const value = structuredClone(manifest); mutate(value); assert.throws(() => validateReleaseManifest(value), ContractError);
  }
});
