import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { generateImageSbom, normalizeSyftImageSbom, parseImageSbomArgs, SYFT_VERSION } from '../release/generate-image-sbom.mjs';
import { digestFile, validateImageSbom } from '../release/lib/artifacts.mjs';

const hex = (character) => character.repeat(64);
const digest = (character) => `sha256:${hex(character)}`;
const image = 'registry.acme.test/booking/backend';
const imageDigest = digest('a');
const gitSha = 'b'.repeat(40);
const nativeDigest = digest('c');
const imageRef = `${image}@${imageDigest}`;

function nativeDocument() {
  return {
    artifacts: [
      { id: 'two', name: 'zlib', version: '1.3.1', type: 'apk', foundBy: 'apk-db-cataloger', locations: [], licenses: [], language: 'c', cpes: [], purl: 'pkg:apk/alpine/zlib@1.3.1' },
      { id: 'one', name: 'booking-runtime', version: '1.0.0', type: 'npm', foundBy: 'javascript-package-cataloger', locations: [], licenses: [], language: 'javascript', cpes: [], purl: 'pkg:npm/booking-runtime@1.0.0' },
    ],
    artifactRelationships: [],
    files: [
      { id: 'two', location: { path: '/usr/lib/libz.so' }, digests: [{ algorithm: 'sha256', value: hex('e') }] },
      { id: 'one', location: { path: '/app/package.json' }, digests: [{ algorithm: 'sha1', value: 'f'.repeat(40) }, { algorithm: 'sha256', value: hex('d') }] },
    ],
    source: { id: digest('f'), name: imageRef, version: imageDigest, type: 'image', metadata: {
      imageID: digest('9'), manifestDigest: imageDigest, repoDigests: [imageRef], tags: [],
    } },
    distro: { name: 'alpine', version: '3.22' },
    descriptor: { name: 'syft', version: SYFT_VERSION, configuration: {} },
    schema: { version: '16.1.10', url: 'https://raw.githubusercontent.com/anchore/syft/main/schema/json/schema-16.1.10.json' },
  };
}

function dockerInspect({ id = digest('9'), revision = gitSha, component = 'backend', repoDigests = [imageRef] } = {}) {
  return JSON.stringify({ Id: id, RepoDigests: repoDigests, Config: { Labels: {
    'org.opencontainers.image.revision': revision,
    'uk.happybooking.component': component,
  } } });
}

test('normalizes version-pinned Syft image JSON deterministically and binds the native report', () => {
  const document = normalizeSyftImageSbom(nativeDocument(), { component: 'backend', gitSha, image, digest: imageDigest, nativeDigest });
  assert.equal(validateImageSbom(document, { component: 'backend', gitSha, image, digest: imageDigest }), document);
  assert.deepEqual(document.packages.map((entry) => entry.name), ['zlib', 'booking-runtime']);
  assert.deepEqual(document.files.map((entry) => entry.path), ['/app/package.json', '/usr/lib/libz.so']);
  assert.deepEqual(document.scanner, {
    name: 'syft', version: SYFT_VERSION, schemaVersion: '16.1.10', nativeDigest,
    fileSelection: 'all', fileDigestAlgorithm: 'sha256',
  });
});

test('rejects Syft reports that do not prove exact image source, scanner, package, and all-file SHA-256 evidence', () => {
  const cases = [
    [(value) => { value.source.type = 'directory'; }, /container image/],
    [(value) => { value.source.metadata.manifestDigest = digest('1'); }, /exact requested repository digest/],
    [(value) => { value.source.metadata.repoDigests = [`registry.acme.test/booking/other@${imageDigest}`]; }, /exact requested repository digest/],
    [(value) => { value.descriptor.version = '1.50.0'; }, /descriptor/],
    [(value) => { value.schema.version = '15.2.0'; }, /schema major/],
    [(value) => { value.artifacts[0].purl = ''; }, /purl/],
    [(value) => { value.files[0].digests = []; }, /exactly one lowercase SHA-256/],
    [(value) => { value.files[1].location.path = value.files[0].location.path; }, /duplicated/],
  ];
  for (const [mutate, expected] of cases) {
    const value = nativeDocument();
    mutate(value);
    assert.throws(() => normalizeSyftImageSbom(value, { component: 'backend', gitSha, image, digest: imageDigest, nativeDigest }), expected);
  }
});

test('executes exact Docker digest scan, strips ambient Syft overrides, double-inspects identity, and publishes immutable files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'booking-syft-image-'));
  const nativeOutput = join(root, 'native.syft.json');
  const output = join(root, 'normalized.json');
  const calls = [];
  const runner = async (executable, args, options) => {
    calls.push({ executable, args, env: options.env });
    if (executable === '/trusted/syft' && args[0] === 'version') return { exitCode: 0, stdout: JSON.stringify({ version: SYFT_VERSION }), stderr: '' };
    if (executable === '/trusted/syft' && args[0] === 'scan') return { exitCode: 0, stdout: JSON.stringify(nativeDocument()), stderr: '' };
    if (executable === '/trusted/docker' && args[0] === 'image') return { exitCode: 0, stdout: dockerInspect(), stderr: '' };
    throw new Error(`unexpected call ${executable} ${args.join(' ')}`);
  };
  try {
    const result = await generateImageSbom({ execute: 'true', component: 'backend', 'git-sha': gitSha, image,
      'image-digest': imageDigest, 'native-output': nativeOutput, output }, {
      dockerExecutable: '/trusted/docker', syftExecutable: '/trusted/syft', commandRunner: runner,
      allowInsecureTestPaths: true,
      env: { PATH: '/trusted', SYFT_FILE_METADATA_SELECTION: 'none', SYFT_EXCLUDE: '/app' },
    });
    assert.equal(result.nativeDigest, await digestFile(nativeOutput));
    assert.equal(result.normalizedDigest, await digestFile(output));
    assert.equal(calls.filter((call) => call.executable === '/trusted/docker').length, 2);
    const scan = calls.find((call) => call.executable === '/trusted/syft' && call.args[0] === 'scan');
    assert.deepEqual(scan.args, ['scan', imageRef, '--output', 'syft-json']);
    assert.equal(scan.env.SYFT_FILE_METADATA_SELECTION, 'all');
    assert.equal(scan.env.SYFT_FILE_METADATA_DIGESTS, 'sha256');
    assert.equal(scan.env.SYFT_EXCLUDE, undefined);
    assert.equal(JSON.parse(await readFile(output, 'utf8')).scanner.nativeDigest, result.nativeDigest);
    await assert.rejects(generateImageSbom({ execute: 'true', component: 'backend', 'git-sha': gitSha, image,
      'image-digest': imageDigest, 'native-output': nativeOutput, output }, {
      dockerExecutable: '/trusted/docker', syftExecutable: '/trusted/syft', commandRunner: runner,
      allowInsecureTestPaths: true,
    }), /already exists/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('fails closed and publishes no evidence on Docker label or post-scan identity drift', async () => {
  for (const scenario of ['wrong-label', 'drift']) {
    const root = await mkdtemp(join(tmpdir(), 'booking-syft-reject-'));
    const nativeOutput = join(root, 'native.syft.json');
    const output = join(root, 'normalized.json');
    let inspections = 0;
    const runner = async (executable, args) => {
      if (executable === '/trusted/syft' && args[0] === 'version') return { exitCode: 0, stdout: JSON.stringify({ version: SYFT_VERSION }), stderr: '' };
      if (executable === '/trusted/syft' && args[0] === 'scan') return { exitCode: 0, stdout: JSON.stringify(nativeDocument()), stderr: '' };
      if (executable === '/trusted/docker') {
        inspections += 1;
        const value = scenario === 'wrong-label' ? dockerInspect({ revision: '0'.repeat(40) }) :
          dockerInspect({ id: inspections === 1 ? digest('9') : digest('8') });
        return { exitCode: 0, stdout: value, stderr: '' };
      }
      throw new Error('unexpected call');
    };
    try {
      await assert.rejects(generateImageSbom({ execute: 'true', component: 'backend', 'git-sha': gitSha, image,
        'image-digest': imageDigest, 'native-output': nativeOutput, output }, {
        dockerExecutable: '/trusted/docker', syftExecutable: '/trusted/syft', commandRunner: runner,
        allowInsecureTestPaths: true,
      }), scenario === 'wrong-label' ? /labels/ : /changed during/);
      assert.deepEqual(await readdir(root), []);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('CLI contract rejects unknown and duplicate arguments before external execution', async () => {
  assert.throws(() => parseImageSbomArgs(['--component', 'backend', '--component', 'gateway']), /duplicate/);
  assert.throws(() => parseImageSbomArgs(['--syft-executable', '/tmp/fake']), /unsupported/);
  await assert.rejects(generateImageSbom({ execute: 'true', component: 'backend', 'git-sha': gitSha, image,
    'image-digest': imageDigest, 'native-output': '/tmp/native', output: '/tmp/normalized', token: 'secret' }, {
    allowInsecureTestPaths: true,
  }), /unsupported/);
});
