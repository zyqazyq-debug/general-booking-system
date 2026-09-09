import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalDocument, digestFile } from '../release/lib/artifacts.mjs';
import { sha256 } from '../release/lib/contracts.mjs';
import { ATTESTATION_TYPES, COSIGN_SIGNING_MODE, COSIGN_VERSION, evidencePredicate,
  verifyAttestationOutput, verifyImageSignatureOutput } from '../release/lib/registry-attestation.mjs';
import { verifyRegistrySupplyChainRuntime } from '../release/lib/registry-runtime-gate.mjs';

const releaseId = 'booking-20260910T010203Z-0123456';
const gitSha = '1'.repeat(40);
const digest = (value) => `sha256:${value.repeat(64)}`;
const keyFor = (component) => component === 'telegram-egress' ? 'telegramEgress' : component;

function manifestFixture() {
  return {
    schema: 'booking.release/v2', releaseId, source: { gitSha, treeState: 'clean' },
    artifacts: {
      backend: { image: '127.0.0.1:15001/booking-preprod/backend', digest: digest('1') },
      gateway: { image: '127.0.0.1:15001/booking-preprod/gateway', digest: digest('2') },
      telegramEgress: { image: '127.0.0.1:15001/booking-preprod/telegram-egress', digest: digest('3') },
    }, contracts: {}, runtime: {}, probes: {},
  };
}

function signaturePayload(binding) {
  return { critical: { identity: { 'docker-reference': binding.image }, image: { 'docker-manifest-digest': binding.imageDigest },
    type: 'cosign container image signature' }, optional: binding.annotations };
}

function envelope(statement) {
  return JSON.stringify([{ payload: Buffer.from(JSON.stringify(statement)).toString('base64') }]);
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'booking-registry-runtime-'));
  const evidenceRoot = join(root, 'supply-chain', releaseId);
  const trustRoot = join(root, 'trust');
  await Promise.all([mkdir(evidenceRoot, { recursive: true }), mkdir(trustRoot, { recursive: true })]);
  const publicKeyPath = join(trustRoot, 'cosign-preprod.pub');
  const anchorPath = join(trustRoot, 'cosign-preprod.pub.sha256');
  const cosignExecutable = join(root, 'cosign');
  await writeFile(publicKeyPath, 'fixture public key\n');
  await writeFile(anchorPath, `${await digestFile(publicKeyPath)}\n`);
  await writeFile(cosignExecutable, 'fixture cosign\n');
  const manifest = manifestFixture();
  const releaseIdentity = { releaseId, gitSha, manifestDigest: sha256(manifest), slot: 'blue' };
  const state = { environment: 'preprod', project: 'booking-preprod', operationId: 'op-current', fencingEpoch: 7 };
  const outputs = new Map();
  for (const component of ['backend', 'gateway', 'telegram-egress']) {
    const directory = join(evidenceRoot, component);
    await mkdir(directory);
    const artifact = manifest.artifacts[keyFor(component)];
    const sbom = { schema: 'fixture.sbom/v1', component, packages: [{ name: component }] };
    const provenance = { predicateType: 'urn:booking:attestation:local-provenance:v1', component, materials: [] };
    const sbomPath = join(directory, `${component}.image-sbom.json`);
    const provenancePath = join(directory, `${component}.provenance.json`);
    await writeFile(sbomPath, canonicalDocument(sbom));
    await writeFile(provenancePath, canonicalDocument(provenance));
    artifact.sbomDigest = await digestFile(sbomPath);
    artifact.provenanceDigest = await digestFile(provenancePath);
  }
  releaseIdentity.manifestDigest = sha256(manifest);
  for (const component of ['backend', 'gateway', 'telegram-egress']) {
    const directory = join(evidenceRoot, component);
    const artifact = manifest.artifacts[keyFor(component)];
    const sbom = JSON.parse(await readFile(join(directory, `${component}.image-sbom.json`), 'utf8'));
    const provenance = JSON.parse(await readFile(join(directory, `${component}.provenance.json`), 'utf8'));
    const common = { component, releaseId, gitSha, manifestDigest: releaseIdentity.manifestDigest,
      image: artifact.image, imageDigest: artifact.digest };
    const annotations = { 'booking.component': component, 'booking.release-id': releaseId, 'booking.git-sha': gitSha,
      'booking.manifest-digest': releaseIdentity.manifestDigest, 'booking.sbom-digest': artifact.sbomDigest,
      'booking.provenance-digest': artifact.provenanceDigest };
    const signature = JSON.stringify([signaturePayload({ ...common, annotations })]);
    outputs.set(`${component}:verify`, signature);
    const attestations = [];
    for (const [kind, document, evidenceDigest] of [
      ['image-sbom', sbom, artifact.sbomDigest], ['local-provenance', provenance, artifact.provenanceDigest],
    ]) {
      const predicate = evidencePredicate({ ...common, kind, document, evidenceDigest });
      const statement = { _type: 'https://in-toto.io/Statement/v1', subject: [{ name: artifact.image,
        digest: { sha256: artifact.digest.slice(7) } }], predicateType: ATTESTATION_TYPES[kind], predicate };
      const output = envelope(statement);
      outputs.set(`${component}:${kind}`, output);
      attestations.push({ kind, predicateType: ATTESTATION_TYPES[kind], evidenceDigest,
        statementDigests: verifyAttestationOutput(output, { kind, image: artifact.image, imageDigest: artifact.digest, predicate }) });
    }
    const verification = { imageSignaturePayloadDigests: verifyImageSignatureOutput(signature, {
      image: artifact.image, imageDigest: artifact.digest, annotations,
    }), attestations, pullBackVerified: true };
    const receipt = { schema: 'booking.registry-attestation-receipt/v1', component, registryTransport: 'loopback-http',
      releaseId, gitSha, manifestDigest: releaseIdentity.manifestDigest, image: { name: artifact.image, digest: artifact.digest },
      evidence: { sbomDigest: artifact.sbomDigest, provenanceDigest: artifact.provenanceDigest },
      signer: { mode: 'self-managed-key', cosignVersion: COSIGN_VERSION, publicKeyDigest: (await readFile(anchorPath, 'utf8')).trim(),
        signingMode: COSIGN_SIGNING_MODE }, verification, verifiedAt: '2026-09-10T01:04:00.000Z' };
    await writeFile(join(directory, `${component}.registry-attestation-receipt.json`), canonicalDocument(receipt));
  }
  const calls = [];
  const runner = async (_executable, argv, options) => {
    calls.push({ argv, env: options.env });
    if (argv[0] === 'version') return { exitCode: 0, stdout: JSON.stringify({ gitVersion: `v${COSIGN_VERSION}` }), stderr: '' };
    const imageRef = argv.at(-1);
    const component = imageRef.includes('telegram-egress') ? 'telegram-egress' : imageRef.includes('/gateway@') ? 'gateway' : 'backend';
    if (argv[0] === 'verify') return { exitCode: 0, stdout: outputs.get(`${component}:verify`), stderr: '' };
    const type = argv[argv.indexOf('--type') + 1];
    const kind = type === ATTESTATION_TYPES['image-sbom'] ? 'image-sbom' : 'local-provenance';
    return { exitCode: 0, stdout: outputs.get(`${component}:${kind}`), stderr: '' };
  };
  const runtime = { registryEvidenceRoot: evidenceRoot, publicKeyPath, publicKeyDigestAnchorPath: anchorPath,
    cosignExecutable, cosignCommandRunner: runner, allowInsecureTestPaths: true, allowUnpinnedTestCosign: true,
    env: { COSIGN_REPOSITORY: 'attacker.invalid/redirect', COSIGN_PASSWORD: 'must-not-leak', SAFE: 'yes' } };
  return { root, evidenceRoot, trustRoot, publicKeyPath, anchorPath, cosignExecutable, manifest, releaseIdentity, state, outputs, calls, runner, runtime };
}

test('runtime gate uses the independent digest anchor and freshly verifies all three registry subjects', async () => {
  const f = await fixture();
  try {
    const result = await verifyRegistrySupplyChainRuntime(f, f.runtime);
    assert.equal(result.operationId, 'op-current');
    assert.equal(result.fencingEpoch, 7);
    assert.deepEqual(Object.keys(result.components), ['backend', 'gateway', 'telegram-egress']);
    assert.deepEqual(f.calls.map((call) => call.argv[0]), ['version', 'verify', 'verify-attestation', 'verify-attestation',
      'verify', 'verify-attestation', 'verify-attestation', 'verify', 'verify-attestation', 'verify-attestation']);
    assert.ok(f.calls.slice(1).every((call) => call.argv.includes('--allow-insecure-registry')));
    assert.ok(f.calls.every((call) => call.env.COSIGN_REPOSITORY === undefined && call.env.COSIGN_PASSWORD === undefined && call.env.SAFE === 'yes'));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('three mutually agreeing receipts cannot substitute an independently approved public-key digest', async () => {
  const f = await fixture();
  try {
    for (const component of ['backend', 'gateway', 'telegram-egress']) {
      const path = join(f.evidenceRoot, component, `${component}.registry-attestation-receipt.json`);
      const receipt = JSON.parse(await readFile(path, 'utf8'));
      receipt.signer.publicKeyDigest = digest('f');
      await writeFile(path, canonicalDocument(receipt));
    }
    await assert.rejects(verifyRegistrySupplyChainRuntime(f, f.runtime), /binding drifted: publicKeyDigest/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('trust-anchor drift, evidence deletion, registry deletion, and pulled-back predicate drift all fail closed', async () => {
  for (const scenario of ['anchor', 'receipt-delete', 'registry-delete', 'predicate']) {
    const f = await fixture();
    try {
      if (scenario === 'anchor') await writeFile(f.anchorPath, `${digest('e')}\n`);
      if (scenario === 'receipt-delete') await unlink(join(f.evidenceRoot, 'gateway', 'gateway.registry-attestation-receipt.json'));
      if (scenario === 'registry-delete') f.runtime.cosignCommandRunner = async (executable, argv, options) =>
        argv[0] === 'verify' && argv.at(-1).includes('/gateway@') ? { exitCode: 1, stdout: '', stderr: 'not found' } : f.runner(executable, argv, options);
      if (scenario === 'predicate') f.outputs.set('telegram-egress:image-sbom', envelope({ _type: 'https://in-toto.io/Statement/v1',
        subject: [{ name: '127.0.0.1:15001/booking-preprod/telegram-egress', digest: { sha256: '3'.repeat(64) } }],
        predicateType: ATTESTATION_TYPES['image-sbom'], predicate: { drifted: true } }));
      await assert.rejects(verifyRegistrySupplyChainRuntime(f, f.runtime));
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test('the live gate result is bound to the current operation and fencing epoch without entering the manifest', async () => {
  const f = await fixture();
  try {
    const current = await verifyRegistrySupplyChainRuntime(f, f.runtime);
    const next = await verifyRegistrySupplyChainRuntime({ ...f, state: { ...f.state, operationId: 'op-next', fencingEpoch: 8 } }, f.runtime);
    assert.notEqual(sha256(current), sha256(next));
    assert.equal(Object.hasOwn(f.manifest, 'registryReceipts'), false);
    assert.equal(Object.hasOwn(f.manifest.artifacts, 'registryReceipts'), false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
