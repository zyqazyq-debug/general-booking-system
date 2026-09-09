import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { attestRegistryEvidence, parseRegistryAttestationArgs } from '../release/attest-registry-evidence.mjs';
import { canonicalDocument, createLocalProvenance, digestFile } from '../release/lib/artifacts.mjs';
import { canonicalJson, sha256 } from '../release/lib/contracts.mjs';
import { ATTESTATION_TYPES, COSIGN_SIGNING_MODE, COSIGN_VERSION, evidencePredicate, validateRegistryAttestationReceipt,
  verifyAttestationOutput, verifyImageSignatureOutput } from '../release/lib/registry-attestation.mjs';

const digest = (character) => `sha256:${character.repeat(64)}`;
const gitSha = 'b'.repeat(40);
const image = 'registry.acme.test/booking-preprod/backend';
const imageDigest = digest('a');
const releaseId = 'booking-20260910T010203Z-abcdef123456';

function sbom(nativeDigest, repository = image) {
  return {
    schema: 'booking.image-sbom/v2', component: 'backend',
    image: { name: repository, digest: imageDigest }, source: { gitSha },
    scanner: { name: 'syft', version: '1.51.1', schemaVersion: '16.1.10', nativeDigest,
      fileSelection: 'all', fileDigestAlgorithm: 'sha256' },
    packages: [{ name: 'booking-runtime', version: '1.0.0', purl: 'pkg:npm/booking-runtime@1.0.0' }],
    files: [{ path: '/app/package.json', digest: digest('8') }],
  };
}

function manifest(sbomDigest, provenanceDigest, repository = image) {
  return {
    schema: 'booking.release/v2', releaseId, source: { gitSha, treeState: 'clean' },
    artifacts: {
      backend: { image: repository, digest: imageDigest, sbomDigest, provenanceDigest },
      gateway: { image: 'registry.acme.test/booking-preprod/gateway', digest: digest('2'), sbomDigest: digest('3'), provenanceDigest: digest('4'),
        frontendAssetDigest: digest('5'), routeContractDigest: digest('6'), telegramBotUsername: 'happybooking_preprod_bot', telegramBotDisplayName: 'HappyBooking Preprod' },
      deployment: { composeDigest: digest('7') },
    },
    contracts: { configSchema: 'booking.config/v1', apiVersion: 'v1', frontendCompatibleApi: 'v1', migration: {
      expandFloor: '1788760000000-AddOrderCreatedConsumerIdempotency', catalogDigest: digest('d'), compatibility: 'expand-contract',
    }, rollbackCompatibleRelease: null },
    runtime: { nodeMajor: 20, targetPlatform: 'linux/amd64' }, probes: { live: '/livez', ready: '/readyz', version: '/__ops/version' },
  };
}

async function fixture({ repository = image, registryTransport } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'booking-registry-attestation-'));
  const evidenceRoot = join(root, 'evidence');
  await mkdir(evidenceRoot);
  const nativePath = join(evidenceRoot, 'backend.syft.json');
  const sbomPath = join(evidenceRoot, 'backend.image-sbom.json');
  const provenancePath = join(evidenceRoot, 'backend.provenance.json');
  const manifestPath = join(evidenceRoot, 'release-manifest.json');
  const privateKey = join(evidenceRoot, 'cosign.key');
  const publicKey = join(evidenceRoot, 'cosign.pub');
  const receipt = join(evidenceRoot, 'registry-receipt.json');
  await writeFile(nativePath, '{"native":"syft"}\n');
  const nativeDigest = await digestFile(nativePath);
  const sbomDocument = sbom(nativeDigest, repository);
  await writeFile(sbomPath, canonicalDocument(sbomDocument));
  const sbomDigest = await digestFile(sbomPath);
  const provenanceDocument = createLocalProvenance({ component: 'backend', gitSha, image: repository, digest: imageDigest, sbomDigest });
  await writeFile(provenancePath, canonicalDocument(provenanceDocument));
  const provenanceDigest = await digestFile(provenancePath);
  const manifestDocument = manifest(sbomDigest, provenanceDigest, repository);
  await writeFile(manifestPath, canonicalDocument(manifestDocument));
  await writeFile(privateKey, 'encrypted-private-key\n');
  await writeFile(publicKey, 'public-key\n');
  await chmod(privateKey, 0o600);
  const publicKeyDigest = await digestFile(publicKey);
  return {
    root, evidenceRoot, nativePath, sbomPath, provenancePath, manifestPath, privateKey, publicKey, receipt, repository,
    manifestDocument, manifestDigest: sha256(manifestDocument), sbomDocument, provenanceDocument, sbomDigest, provenanceDigest,
    args: { execute: 'true', component: 'backend', manifest: manifestPath, 'manifest-digest': sha256(manifestDocument),
      'native-sbom': nativePath, sbom: sbomPath, provenance: provenancePath, 'private-key': privateKey, 'public-key': publicKey,
      'public-key-digest': publicKeyDigest, 'signing-mode': COSIGN_SIGNING_MODE,
      ...(registryTransport ? { 'registry-transport': registryTransport } : {}), receipt },
  };
}

function signaturePayload(annotations, override = {}) {
  return { critical: { identity: { 'docker-reference': override.image || image }, image: { 'docker-manifest-digest': override.imageDigest || imageDigest },
    type: 'cosign container image signature' }, optional: { ...annotations, ...(override.annotations || {}) } };
}

function envelope(predicateType, predicate, override = {}) {
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: override.image || image, digest: { sha256: (override.imageDigest || imageDigest).slice(7) } }],
    predicateType: override.predicateType || predicateType,
    predicate: override.predicate || predicate,
  };
  return { payload: Buffer.from(canonicalJson(statement)).toString('base64') };
}

function mockCosign({ tamperKind = null, signatureOverride = null } = {}) {
  const predicates = new Map();
  const calls = [];
  const runner = async (executable, args, options) => {
    calls.push({ executable, args: [...args], env: { ...options.env } });
    if (args[0] === 'version') return { exitCode: 0, stdout: JSON.stringify({ gitVersion: `v${COSIGN_VERSION}` }), stderr: '' };
    if (args[0] === 'sign') return { exitCode: 0, stdout: '', stderr: '' };
    if (args[0] === 'attest') {
      const type = args[args.indexOf('--type') + 1];
      const path = args[args.indexOf('--predicate') + 1];
      predicates.set(type, JSON.parse(await readFile(path, 'utf8')));
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'verify') {
      const imageRef = args.at(-1);
      const separator = imageRef.lastIndexOf('@sha256:');
      const repository = imageRef.slice(0, separator);
      const manifestDigest = imageRef.slice(separator + 1);
      const annotations = {};
      for (let index = 0; index < args.length; index += 1) if (args[index] === '-a') {
        const [key, ...rest] = args[index + 1].split('='); annotations[key] = rest.join('=');
      }
      return { exitCode: 0, stdout: JSON.stringify([signaturePayload(annotations,
        { image: repository, imageDigest: manifestDigest, ...(signatureOverride || {}) })]), stderr: '' };
    }
    if (args[0] === 'verify-attestation') {
      const type = args[args.indexOf('--type') + 1];
      const predicate = structuredClone(predicates.get(type));
      if (!predicate) return { exitCode: 1, stdout: '', stderr: 'not found' };
      const kind = type === ATTESTATION_TYPES['image-sbom'] ? 'image-sbom' : 'local-provenance';
      if (tamperKind === kind) predicate.releaseId = 'booking-20260910T010204Z-deadbee';
      return { exitCode: 0, stdout: `${JSON.stringify(envelope(type, predicate,
        { image: predicate.image.name, imageDigest: predicate.image.digest }))}\n`, stderr: '' };
    }
    throw new Error(`unexpected Cosign command: ${args.join(' ')}`);
  };
  return { runner, calls, predicates };
}

test('attaches signature and two typed predicates, then independently pulls back and records exact verified bindings', async () => {
  const f = await fixture();
  const cosign = mockCosign();
  try {
    const result = await attestRegistryEvidence(f.args, { cosignExecutable: '/trusted/cosign', commandRunner: cosign.runner,
      allowInsecureTestPaths: true, env: { PATH: '/trusted', COSIGN_PASSWORD: 'not-logged', COSIGN_REPOSITORY: 'attacker/redirect' },
      now: () => new Date('2026-09-10T02:03:04.000Z') });
    assert.equal(result.replayed, false);
    assert.equal(validateRegistryAttestationReceipt(result.receipt), result.receipt);
    assert.equal(result.receipt.manifestDigest, f.manifestDigest);
    assert.equal(result.receipt.registryTransport, 'https');
    assert.equal(result.receipt.evidence.sbomDigest, f.sbomDigest);
    assert.equal(result.receipt.evidence.provenanceDigest, f.provenanceDigest);
    assert.equal(result.receipt.verification.attestations[1].kind, 'local-provenance');
    assert.equal(result.receipt.verifiedAt, '2026-09-10T02:03:04.000Z');
    assert.deepEqual(cosign.calls.map((call) => call.args[0]), ['version', 'sign', 'attest', 'attest', 'verify', 'verify-attestation', 'verify-attestation']);
    assert.ok(cosign.calls.every((call) => call.env.COSIGN_REPOSITORY === undefined));
    assert.ok(cosign.calls.filter((call) => ['sign', 'attest'].includes(call.args[0]))
      .every((call) => call.env.COSIGN_PASSWORD === 'not-logged'));
    assert.ok(cosign.calls.filter((call) => !['sign', 'attest'].includes(call.args[0]))
      .every((call) => call.env.COSIGN_PASSWORD === undefined));
    assert.ok(cosign.calls.find((call) => call.args[0] === 'sign').args.includes(`${image}@${imageDigest}`));
    assert.ok(cosign.calls.filter((call) => ['sign', 'attest'].includes(call.args[0]))
      .every((call) => call.args.includes('--use-signing-config=false') && call.args.includes('--tlog-upload=false') &&
        !call.args.includes('--signing-config')));
    assert.ok(cosign.calls.filter((call) => ['verify', 'verify-attestation'].includes(call.args[0]))
      .every((call) => call.args.includes('--insecure-ignore-tlog')));
    assert.ok(cosign.calls.every((call) => !call.args.includes('--allow-insecure-registry')));
    assert.equal(cosign.predicates.get(ATTESTATION_TYPES['local-provenance']).evidence.document.predicateType,
      'urn:booking:attestation:local-provenance:v1');
    assert.deepEqual((await readdir(f.evidenceRoot)).filter((name) => name.includes('.predicate.json')), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('receipt replay is read-only and repeats all registry signature and attestation verification', async () => {
  const f = await fixture();
  const cosign = mockCosign();
  try {
    const runtime = { cosignExecutable: '/trusted/cosign', commandRunner: cosign.runner, allowInsecureTestPaths: true,
      env: { COSIGN_PASSWORD: 'not-logged' }, now: () => new Date('2026-09-10T02:03:04.000Z') };
    const first = await attestRegistryEvidence(f.args, runtime);
    cosign.calls.length = 0;
    const replay = await attestRegistryEvidence(f.args, { ...runtime, env: {} });
    assert.equal(replay.replayed, true);
    assert.equal(replay.receiptDigest, first.receiptDigest);
    assert.deepEqual(cosign.calls.map((call) => call.args[0]), ['version', 'verify', 'verify-attestation', 'verify-attestation']);
    assert.ok(cosign.calls.every((call) => call.env.COSIGN_PASSWORD === undefined));
    cosign.predicates.get(ATTESTATION_TYPES['image-sbom']).releaseId = 'booking-20260910T010204Z-deadbee';
    cosign.calls.length = 0;
    await assert.rejects(attestRegistryEvidence(f.args, { ...runtime, env: {} }), /predicate differs/);
    assert.ok(cosign.calls.every((call) => !['sign', 'attest'].includes(call.args[0])));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('pulled-back predicate, image subject, annotation, missing password, and manifest evidence drift all fail closed', async () => {
  for (const scenario of ['predicate', 'signature', 'password', 'manifest']) {
    const f = await fixture();
    const cosign = mockCosign(scenario === 'predicate' ? { tamperKind: 'image-sbom' } :
      scenario === 'signature' ? { signatureOverride: { annotations: { 'booking.git-sha': '0'.repeat(40) } } } : {});
    try {
      if (scenario === 'manifest') {
        f.manifestDocument.artifacts.backend.sbomDigest = digest('0');
        await writeFile(f.manifestPath, canonicalDocument(f.manifestDocument));
        f.args['manifest-digest'] = sha256(f.manifestDocument);
      }
      const env = scenario === 'password' ? {} : { COSIGN_PASSWORD: 'not-logged' };
      await assert.rejects(attestRegistryEvidence(f.args, { cosignExecutable: '/trusted/cosign', commandRunner: cosign.runner,
        allowInsecureTestPaths: true, env }), scenario === 'predicate' ? /predicate differs/ :
        scenario === 'signature' ? /annotation drifted/ : scenario === 'password' ? /COSIGN_PASSWORD/ : /SBOM digest differs/);
      await assert.rejects(readFile(f.receipt), /ENOENT/);
      assert.deepEqual((await readdir(f.evidenceRoot)).filter((name) => name.includes('.predicate.json')), []);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test('pure validators reject wrong subjects, malformed base64, predicate type confusion, and receipt signer drift', async () => {
  const f = await fixture();
  try {
    const common = { kind: 'image-sbom', component: 'backend', releaseId, gitSha, manifestDigest: f.manifestDigest,
      image, imageDigest, evidenceDigest: f.sbomDigest, document: f.sbomDocument };
    const predicate = evidencePredicate(common);
    assert.throws(() => verifyAttestationOutput(JSON.stringify({ payload: '$not-base64' }), {
      kind: 'image-sbom', image, imageDigest, predicate,
    }), /base64/);
    assert.throws(() => verifyAttestationOutput(JSON.stringify(envelope(ATTESTATION_TYPES['image-sbom'], predicate, { image: 'registry.acme.test/other' })), {
      kind: 'image-sbom', image, imageDigest, predicate,
    }), /immutable image/);
    assert.throws(() => verifyAttestationOutput(JSON.stringify(envelope(ATTESTATION_TYPES['image-sbom'], predicate, { predicateType: ATTESTATION_TYPES['local-provenance'] })), {
      kind: 'image-sbom', image, imageDigest, predicate,
    }), /statement type/);
    assert.throws(() => verifyImageSignatureOutput(JSON.stringify([signaturePayload({}, { imageDigest: digest('0') })]), {
      image, imageDigest, annotations: {},
    }), /immutable image digest/);
    const invalidReceipt = {
      schema: 'booking.registry-attestation-receipt/v1', component: 'backend', registryTransport: 'https', releaseId, gitSha,
      manifestDigest: f.manifestDigest, image: { name: image, digest: imageDigest },
      evidence: { sbomDigest: f.sbomDigest, provenanceDigest: f.provenanceDigest },
      signer: { mode: 'self-managed-key', cosignVersion: COSIGN_VERSION, publicKeyDigest: digest('9'), signingMode: COSIGN_SIGNING_MODE },
      verification: { imageSignaturePayloadDigests: [digest('7')], attestations: [
        { kind: 'image-sbom', predicateType: ATTESTATION_TYPES['image-sbom'], evidenceDigest: f.sbomDigest, statementDigests: [digest('5')] },
        { kind: 'local-provenance', predicateType: ATTESTATION_TYPES['local-provenance'], evidenceDigest: f.provenanceDigest, statementDigests: [digest('6')] },
      ], pullBackVerified: true }, verifiedAt: '1',
    };
    assert.throws(() => validateRegistryAttestationReceipt(invalidReceipt), /verifiedAt/);
    assert.throws(() => validateRegistryAttestationReceipt({ ...invalidReceipt, registryTransport: 'loopback-http',
      verifiedAt: '2026-09-10T02:03:04.000Z' }), /approved registry/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('CLI rejects unknown or duplicate inputs before it can select a signing target', () => {
  assert.throws(() => parseRegistryAttestationArgs(['--component', 'backend', '--component', 'gateway']), /duplicate/);
  assert.throws(() => parseRegistryAttestationArgs(['--image', 'production/image']), /unsupported/);
});

test('library entry rejects relative evidence and receipt paths before registry I/O', async () => {
  const f = await fixture();
  const cosign = mockCosign();
  try {
    await assert.rejects(attestRegistryEvidence({ ...f.args, receipt: 'relative-receipt.json' }, {
      cosignExecutable: '/trusted/cosign', commandRunner: cosign.runner, allowInsecureTestPaths: true,
      env: { COSIGN_PASSWORD: 'not-logged' },
    }), /--receipt must be an absolute path/);
    assert.equal(cosign.calls.length, 0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('library entry rejects an unapproved public key before registry I/O', async () => {
  const f = await fixture();
  const cosign = mockCosign();
  try {
    await assert.rejects(attestRegistryEvidence({ ...f.args, 'public-key-digest': digest('0') }, {
      cosignExecutable: '/trusted/cosign', commandRunner: cosign.runner, allowInsecureTestPaths: true,
      env: { COSIGN_PASSWORD: 'not-logged' },
    }), /approved trust root/);
    assert.equal(cosign.calls.length, 0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('explicit loopback HTTP mode is restricted, recorded, replay-bound, and passed to every registry command', async () => {
  const f = await fixture({ repository: '127.0.0.1:15001/booking-preprod/backend', registryTransport: 'loopback-http' });
  const cosign = mockCosign();
  const runtime = { cosignExecutable: '/trusted/cosign', commandRunner: cosign.runner, allowInsecureTestPaths: true,
    env: { COSIGN_PASSWORD: 'not-logged' }, now: () => new Date('2026-09-10T02:03:04.000Z') };
  try {
    const result = await attestRegistryEvidence(f.args, runtime);
    assert.equal(result.receipt.registryTransport, 'loopback-http');
    const registryCalls = cosign.calls.filter((call) => call.args[0] !== 'version');
    assert.equal(registryCalls.length, 6);
    assert.ok(registryCalls.every((call) => call.args.includes('--allow-insecure-registry')));
    cosign.calls.length = 0;
    await assert.rejects(attestRegistryEvidence({ ...f.args, 'registry-transport': 'https' }, {
      ...runtime, env: {},
    }), /registryTransport/);
    assert.deepEqual(cosign.calls.map((call) => call.args[0]), ['version']);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('loopback HTTP mode rejects external hosts, localhost aliases, and every unapproved port before registry I/O', async () => {
  for (const repository of [
    'registry.acme.test/booking-preprod/backend',
    'localhost:15001/booking-preprod/backend',
    '127.0.0.1:15000/booking-preprod/backend',
    '127.0.0.1:15001.evil.test/booking-preprod/backend',
  ]) {
    const f = await fixture({ repository, registryTransport: 'loopback-http' });
    const cosign = mockCosign();
    try {
      await assert.rejects(attestRegistryEvidence(f.args, { cosignExecutable: '/trusted/cosign', commandRunner: cosign.runner,
        allowInsecureTestPaths: true, env: { COSIGN_PASSWORD: 'not-logged' } }), /restricted to 127\.0\.0\.1:15001/);
      assert.equal(cosign.calls.length, 0);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test('loopback registry without explicit transport remains HTTPS and never receives the insecure registry flag', async () => {
  const f = await fixture({ repository: '127.0.0.1:15001/booking-preprod/backend' });
  const cosign = mockCosign();
  try {
    const result = await attestRegistryEvidence(f.args, { cosignExecutable: '/trusted/cosign', commandRunner: cosign.runner,
      allowInsecureTestPaths: true, env: { COSIGN_PASSWORD: 'not-logged' } });
    assert.equal(result.receipt.registryTransport, 'https');
    assert.ok(cosign.calls.every((call) => !call.args.includes('--allow-insecure-registry')));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('missing, unknown, or replay-drifted signing mode is rejected before any new Cosign or registry I/O', async () => {
  const f = await fixture();
  const cosign = mockCosign();
  const runtime = { cosignExecutable: '/trusted/cosign', commandRunner: cosign.runner, allowInsecureTestPaths: true,
    env: { COSIGN_PASSWORD: 'not-logged' } };
  try {
    const missingMode = { ...f.args };
    delete missingMode['signing-mode'];
    await assert.rejects(attestRegistryEvidence(missingMode, runtime), /--signing-mode is required/);
    await assert.rejects(attestRegistryEvidence({ ...f.args, 'signing-mode': 'default' }, runtime), /--signing-mode must be/);
    assert.equal(cosign.calls.length, 0);
    await attestRegistryEvidence(f.args, runtime);
    cosign.calls.length = 0;
    await assert.rejects(attestRegistryEvidence({ ...f.args, 'signing-mode': 'default' }, { ...runtime, env: {} }),
      /--signing-mode must be/);
    assert.equal(cosign.calls.length, 0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
