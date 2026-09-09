import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  canonicalSourceFile,
  createBuildInputInventory,
  createLocalProvenance,
  createReleaseManifest,
  digestFile,
  directoryDigest,
  imageRepository,
  readArtifact,
  validateBuildInputInventory,
  validateImageSbom,
  validateLocalProvenance,
  telegramEgressAptSources,
  telegramEgressBaseImage,
} from './lib/artifacts.mjs';
import { ContractError, validateReleaseManifest } from './lib/contracts.mjs';

const digest = (char) => `sha256:${char.repeat(64)}`;
const source = { gitSha: '1'.repeat(40), committedAt: '2026-09-08T01:02:03Z' };
const artifacts = {
  backend: { image: 'registry.acme.test/booking/backend', digest: digest('2'), sbomDigest: digest('3'), provenanceDigest: digest('4') },
  gateway: { image: 'registry.acme.test/booking/gateway', digest: digest('5'), sbomDigest: digest('6'), provenanceDigest: digest('7'), frontendAssetDigest: digest('8'), routeContractDigest: digest('9'), telegramBotUsername: 'happybooking_preprod_bot', telegramBotDisplayName: 'HappyBooking Preprod' },
  telegramEgress: { image: 'registry.acme.test/booking/telegram-egress', digest: digest('c'), sbomDigest: digest('d'), provenanceDigest: digest('e'), buildInputDigest: digest('1'),
    baseImage: 'debian:bookworm-20260824-slim', baseImageDigest: digest('f'),
    aptSources: { debianMirror: 'https://deb.debian.org/debian', securityMirror: 'https://deb.debian.org/debian-security' },
    warpPackage: { version: '2026.7.1377.0', sha256: '0'.repeat(64) } },
  deployment: { composeDigest: digest('b') },
};
const migration = { expandFloor: '1774200000002-RemoveAgencyNodeUniqueIndex', catalogDigest: digest('a') };

function imageSbom(component, artifact) {
  return {
    schema: 'booking.image-sbom/v2',
    component,
    image: { name: artifact.image, digest: artifact.digest },
    source: { gitSha: source.gitSha },
    scanner: { name: 'syft', version: '1.51.1', schemaVersion: '16.1.10', nativeDigest: digest('d'), fileSelection: 'all', fileDigestAlgorithm: 'sha256' },
    packages: [{ name: 'booking-runtime', version: '1.0.0', purl: 'pkg:npm/booking-runtime@1.0.0' }],
    files: [{ path: '/app/package.json', digest: digest('c') }],
  };
}

test('manifest binds both attestations, H5 routes, migration catalog, and fixed probes', () => {
  const manifest = createReleaseManifest({ source, targetPlatform: 'linux/amd64', artifact: artifacts, migration });
  assert.equal(validateReleaseManifest(manifest), manifest);
  assert.equal(manifest.probes.version, '/__ops/version');
  assert.equal(manifest.contracts.migration.compatibility, 'expand-contract');
  assert.equal(manifest.artifacts.deployment.composeDigest, digest('b'));
  assert.equal(manifest.artifacts.gateway.telegramBotUsername, 'happybooking_preprod_bot');
});

test('image repositories reject tags and placeholder registries before manifest creation', () => {
  assert.throws(() => imageRepository('registry.example.invalid/booking/backend'), ContractError);
  assert.throws(() => imageRepository('registry.acme.test/booking/backend:latest'), ContractError);
  assert.throws(() => imageRepository('registry.acme.test/booking/backend:20260908'), ContractError);
  const tagged = createReleaseManifest({ source, targetPlatform: 'linux/amd64', artifact: artifacts, migration });
  tagged.artifacts.backend.image = 'registry.acme.test/booking/backend:20260908';
  assert.throws(() => validateReleaseManifest(tagged), ContractError);
});

test('release v1 cannot be reused for a candidate that omits the Compose binding', () => {
  const candidate = createReleaseManifest({ source, targetPlatform: 'linux/amd64', artifact: artifacts, migration });
  candidate.schema = 'booking.release/v1';
  delete candidate.artifacts.deployment;
  assert.throws(() => validateReleaseManifest(candidate), /schema is unsupported/);
});

test('H5 digest is stable across directory traversal order and rejects an empty artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'booking-release-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<!doctype html>');
  await writeFile(join(root, 'assets', 'app.js'), 'console.log(1)');
  assert.equal(await directoryDigest(root, 'fixture H5'), await directoryDigest(root, 'fixture H5'));
  const empty = await mkdtemp(join(tmpdir(), 'booking-empty-'));
  await assert.rejects(directoryDigest(empty, 'empty H5'), ContractError);
});

test('gateway build definition copies the actual uni H5 output and has no mutable runtime bind', async () => {
  const dockerfile = await readFile(new URL('../../frontend/Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /dist\/build\/h5/);
  assert.doesNotMatch(dockerfile, /COPY .*node_modules/i);
});

test('Telegram egress base image accepts only an explicit digest-preserving source or mirror', async () => {
  const dockerfile = await readFile(fileURLToPath(new URL('../telegram-egress/Dockerfile', import.meta.url)), 'utf8');
  const approvedDigest = 'sha256:5ae3c39ebd15e229dcedd5cee596b2497182493d41ff162e824ba13fc1b2b867';
  assert.equal(telegramEgressBaseImage(dockerfile, `debian:bookworm-20260824-slim@${approvedDigest}`).digest, approvedDigest);
  assert.equal(telegramEgressBaseImage(dockerfile, `127.0.0.1:15001/booking-preprod/base/debian:bookworm-20260824-slim@${approvedDigest}`).image,
    '127.0.0.1:15001/booking-preprod/base/debian:bookworm-20260824-slim');
  assert.throws(() => telegramEgressBaseImage(dockerfile, 'debian:bookworm-20260824-slim'), /immutable/);
  assert.throws(() => telegramEgressBaseImage(dockerfile, `debian:bookworm-20260824-slim@${digest('1')}`), /differs/);
});

test('Telegram egress APT sources retain official HTTPS defaults and admit only explicit canonical HTTPS mirrors', async () => {
  const dockerfile = await readFile(fileURLToPath(new URL('../telegram-egress/Dockerfile', import.meta.url)), 'utf8');
  const ustc = { debianMirror: 'https://mirrors.ustc.edu.cn/debian', securityMirror: 'https://mirrors.ustc.edu.cn/debian-security' };
  assert.deepEqual(telegramEgressAptSources(dockerfile, ustc), ustc);
  assert.ok(dockerfile.indexOf('apt-get install -y --no-install-recommends ca-certificates') < dockerfile.indexOf('ARG TELEGRAM_EGRESS_DEBIAN_MIRROR='));
  for (const aptSources of [
    { ...ustc, debianMirror: 'http://mirrors.ustc.edu.cn/debian' },
    { ...ustc, securityMirror: 'https://user:pass@mirrors.ustc.edu.cn/debian-security' },
    { ...ustc, securityMirror: 'https://mirrors.ustc.edu.cn/debian-security/' },
    { debianMirror: ustc.debianMirror },
  ]) assert.throws(() => telegramEgressAptSources(dockerfile, aptSources), ContractError);
});

test('build-input inventory is exact and cannot be presented as an image SBOM', async () => {
  const root = await mkdtemp(join(tmpdir(), 'booking-build-inputs-'));
  try {
    await mkdir(join(root, 'backend'));
    await writeFile(join(root, 'backend', 'Dockerfile'), 'FROM scratch');
    await writeFile(join(root, 'backend', 'package.json'), '{}');
    await writeFile(join(root, 'backend', 'package-lock.json'), '{}');
    const inventory = await createBuildInputInventory(root, 'backend', source.gitSha);
    assert.equal(validateBuildInputInventory(inventory, { component: 'backend', gitSha: source.gitSha }), inventory);
    assert.throws(() => validateImageSbom(inventory, { component: 'backend' }), /image SBOM/);
    inventory.files[0].path = 'backend/not-the-Dockerfile';
    assert.throws(() => validateBuildInputInventory(inventory), /exact expected inventory/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Telegram egress build inventory and provenance bind the actual base image and APT sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'booking-egress-build-inputs-'));
  const baseImage = '127.0.0.1:15001/booking-preprod/base/debian:bookworm-20260824-slim@sha256:5ae3c39ebd15e229dcedd5cee596b2497182493d41ff162e824ba13fc1b2b867';
  const aptSources = { debianMirror: 'https://mirrors.ustc.edu.cn/debian', securityMirror: 'https://mirrors.ustc.edu.cn/debian-security' };
  try {
    await mkdir(join(root, 'ops', 'telegram-egress'), { recursive: true });
    for (const file of ['Dockerfile', 'entrypoint.sh', 'healthcheck.sh', 'readback.sh']) {
      await writeFile(join(root, 'ops', 'telegram-egress', file), `${file}\n`);
    }
    const inventory = await createBuildInputInventory(root, 'telegram-egress', source.gitSha, { baseImage, aptSources });
    assert.equal(validateBuildInputInventory(inventory, {
      component: 'telegram-egress', gitSha: source.gitSha, baseImage, aptSources,
    }), inventory);
    assert.throws(() => validateBuildInputInventory(inventory, {
      component: 'telegram-egress', gitSha: source.gitSha,
      baseImage: `debian:bookworm-20260824-slim@${digest('1')}`,
      aptSources,
    }), /base image binding/);
    assert.throws(() => validateBuildInputInventory(inventory, {
      component: 'telegram-egress', gitSha: source.gitSha, baseImage,
      aptSources: { ...aptSources, securityMirror: 'https://deb.debian.org/debian-security' },
    }), /APT source binding/);

    const provenance = createLocalProvenance({
      component: 'telegram-egress', gitSha: source.gitSha,
      image: artifacts.telegramEgress.image, digest: artifacts.telegramEgress.digest,
      sbomDigest: artifacts.telegramEgress.sbomDigest, baseImage, aptSources,
    });
    assert.equal(validateLocalProvenance(provenance, {
      component: 'telegram-egress', gitSha: source.gitSha,
      image: artifacts.telegramEgress.image, digest: artifacts.telegramEgress.digest,
      sbomDigest: artifacts.telegramEgress.sbomDigest, baseImage, aptSources,
    }), provenance);
    const wrongBase = structuredClone(provenance);
    wrongBase.predicate.materials[2].digest.sha256 = '1'.repeat(64);
    assert.throws(() => validateLocalProvenance(wrongBase, {
      component: 'telegram-egress', gitSha: source.gitSha,
      image: artifacts.telegramEgress.image, digest: artifacts.telegramEgress.digest,
      sbomDigest: artifacts.telegramEgress.sbomDigest, baseImage, aptSources,
    }), /selected base image/);
    const wrongMirror = structuredClone(provenance);
    wrongMirror.predicate.materials[4].uri = 'https://deb.debian.org/debian-security';
    assert.throws(() => validateLocalProvenance(wrongMirror, {
      component: 'telegram-egress', gitSha: source.gitSha,
      image: artifacts.telegramEgress.image, digest: artifacts.telegramEgress.digest,
      sbomDigest: artifacts.telegramEgress.sbomDigest, baseImage, aptSources,
    }), /selected securityMirror/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('legacy source-only SBOM generator fails closed instead of claiming image evidence', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./generate-sbom.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 10);
  assert.match(result.stderr, /source inputs are not an image SBOM/);
  assert.match(result.stderr, /generate-image-sbom\.mjs/);
});

test('image SBOM requires exact image identity and non-empty package and file inventories', () => {
  const valid = imageSbom('backend', artifacts.backend);
  assert.equal(validateImageSbom(valid, {
    component: 'backend', gitSha: source.gitSha, image: artifacts.backend.image, digest: artifacts.backend.digest,
  }), valid);
  for (const field of ['packages', 'files']) {
    const empty = structuredClone(valid);
    empty[field] = [];
    assert.throws(() => validateImageSbom(empty), /must not be empty/);
  }
  const wrongImage = structuredClone(valid);
  wrongImage.image.digest = digest('d');
  assert.throws(() => validateImageSbom(wrongImage, { digest: artifacts.backend.digest }), /immutable image identity/);
  const extra = structuredClone(valid);
  extra.files[0].size = 123;
  assert.throws(() => validateImageSbom(extra), /exact schema/);
  const scannerDrift = structuredClone(valid);
  scannerDrift.scanner.version = '1.50.0';
  assert.throws(() => validateImageSbom(scannerDrift), /scanner binding/);
});

test('normalized image SBOM cannot be admitted without the exact native Syft document', async () => {
  const root = await mkdtemp(join(tmpdir(), 'booking-native-sbom-'));
  const native = join(root, 'native.json');
  const wrongNative = join(root, 'wrong-native.json');
  const normalized = join(root, 'normalized.json');
  try {
    await writeFile(native, '{"syft":"native"}\n');
    await writeFile(wrongNative, '{"syft":"wrong"}\n');
    const value = imageSbom('backend', artifacts.backend);
    value.scanner.nativeDigest = await digestFile(native);
    await writeFile(normalized, JSON.stringify(value));
    await assert.rejects(readArtifact(normalized, 'backend', source.gitSha, artifacts.backend.image, artifacts.backend.digest, 'SBOM'), /native Syft document is required/);
    await assert.rejects(readArtifact(normalized, 'backend', source.gitSha, artifacts.backend.image, artifacts.backend.digest, 'SBOM', { nativePath: wrongNative }), /does not bind/);
    assert.match(await readArtifact(normalized, 'backend', source.gitSha, artifacts.backend.image, artifacts.backend.digest, 'SBOM', { nativePath: native }), /^sha256:/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('provenance exact schema binds its SBOM digest and one immutable image identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'booking-provenance-'));
  const path = join(root, 'provenance.json');
  const provenance = createLocalProvenance({
    component: 'backend', gitSha: source.gitSha, image: artifacts.backend.image,
    digest: artifacts.backend.digest, sbomDigest: artifacts.backend.sbomDigest,
  });
  try {
    await writeFile(path, JSON.stringify(provenance));
    assert.match(await readArtifact(path, 'backend', source.gitSha, artifacts.backend.image, artifacts.backend.digest, 'provenance', {
      sbomDigest: artifacts.backend.sbomDigest,
    }), /^sha256:/);
    for (const mutate of [
      (value) => { value.predicateType = 'https://slsa.dev/provenance/v1'; },
      (value) => { value.predicate.buildType = 'unknown'; },
      (value) => { value.predicate.materials[0].digest.sha256 = 'e'.repeat(64); },
      (value) => { value.predicate.materials[1].uri = 'registry.acme.test/booking/other'; },
      (value) => { value.predicate.unexpected = true; },
    ]) {
      const invalid = structuredClone(provenance);
      mutate(invalid);
      assert.throws(() => validateLocalProvenance(invalid, {
        component: 'backend', gitSha: source.gitSha, image: artifacts.backend.image,
        digest: artifacts.backend.digest, sbomDigest: artifacts.backend.sbomDigest,
      }), ContractError);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('release source contracts reject external or same-named caller files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'booking-source-contract-'));
  const external = await mkdtemp(join(tmpdir(), 'booking-external-contract-'));
  const expected = join(root, 'frontend', 'nginx.preprod.conf');
  try {
    await mkdir(join(root, 'frontend'));
    await writeFile(expected, 'canonical');
    const foreign = join(external, 'nginx.preprod.conf');
    await writeFile(foreign, 'canonical');
    assert.equal(await canonicalSourceFile(root, expected, 'frontend/nginx.preprod.conf', '--route-contract'), expected);
    await assert.rejects(canonicalSourceFile(root, foreign, 'frontend/nginx.preprod.conf', '--route-contract'), /exact regular file from the clean Git source/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(external, { recursive: true, force: true }); }
});
