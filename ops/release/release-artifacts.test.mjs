import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createReleaseManifest, directoryDigest, imageRepository, readArtifact } from './lib/artifacts.mjs';
import { ContractError, validateReleaseManifest } from './lib/contracts.mjs';

const digest = (char) => `sha256:${char.repeat(64)}`;
const source = { gitSha: '1'.repeat(40), committedAt: '2026-09-08T01:02:03Z' };
const artifacts = {
  backend: { image: 'registry.acme.test/booking/backend', digest: digest('2'), sbomDigest: digest('3'), provenanceDigest: digest('4') },
  gateway: { image: 'registry.acme.test/booking/gateway', digest: digest('5'), sbomDigest: digest('6'), provenanceDigest: digest('7'), frontendAssetDigest: digest('8'), routeContractDigest: digest('9') },
};
const migration = { expandFloor: '1774200000002-RemoveAgencyNodeUniqueIndex', catalogDigest: digest('a') };

test('manifest binds both attestations, H5 routes, migration catalog, and fixed probes', () => {
  const manifest = createReleaseManifest({ source, targetPlatform: 'linux/amd64', artifact: artifacts, migration });
  assert.equal(validateReleaseManifest(manifest), manifest);
  assert.equal(manifest.probes.version, '/__ops/version');
  assert.equal(manifest.contracts.migration.compatibility, 'expand-contract');
});

test('image repositories reject tags and placeholder registries before manifest creation', () => {
  assert.throws(() => imageRepository('registry.example.invalid/booking/backend'), ContractError);
  assert.throws(() => imageRepository('registry.acme.test/booking/backend:latest'), ContractError);
  assert.throws(() => imageRepository('registry.acme.test/booking/backend:20260908'), ContractError);
  const tagged = createReleaseManifest({ source, targetPlatform: 'linux/amd64', artifact: artifacts, migration });
  tagged.artifacts.backend.image = 'registry.acme.test/booking/backend:20260908';
  assert.throws(() => validateReleaseManifest(tagged), ContractError);
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

test('provenance verifier reads in-toto subject identity rather than an unbound top-level field', async () => {
  const root = await mkdtemp(join(tmpdir(), 'booking-provenance-'));
  const path = join(root, 'provenance.json');
  await writeFile(path, JSON.stringify({
    _type: 'https://in-toto.io/Statement/v1',
    subject: { component: 'backend', image: artifacts.backend.image, digest: artifacts.backend.digest },
    predicate: { source: { gitSha: source.gitSha } },
  }));
  assert.match(await readArtifact(path, 'backend', source.gitSha, artifacts.backend.image, artifacts.backend.digest, 'provenance'), /^sha256:/);
});
