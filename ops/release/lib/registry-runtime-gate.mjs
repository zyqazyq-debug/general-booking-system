import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { canonicalDocument, digestFile } from './artifacts.mjs';
import { canonicalJson, ContractError, EXIT, readJsonFile, sha256 } from './contracts.mjs';
import {
  ATTESTATION_TYPES,
  COSIGN_BINARY_DIGESTS,
  COSIGN_SIGNING_MODE,
  COSIGN_VERSION,
  LOOPBACK_HTTP_REGISTRY,
  evidencePredicate,
  validateRegistryAttestationReceipt,
  verifyAttestationOutput,
  verifyImageSignatureOutput,
} from './registry-attestation.mjs';

const COMPONENTS = Object.freeze(['backend', 'gateway', 'telegram-egress']);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

async function trustedFile(path, label, runtime, { rootOnly = false } = {}) {
  if (!isAbsolute(path) || resolve(path) !== path) throw new ContractError(`${label} path must be absolute`, EXIT.IDENTITY);
  const caller = await lstat(path).catch(() => { throw new ContractError(`${label} is unavailable`, EXIT.IDENTITY); });
  if (caller.isSymbolicLink() || !caller.isFile()) throw new ContractError(`${label} must be a regular non-symbolic file`, EXIT.IDENTITY);
  const canonical = await realpath(path);
  const metadata = await stat(canonical);
  if (canonical !== path || (!runtime.allowInsecureTestPaths && process.platform !== 'win32' &&
      (metadata.uid !== 0 || (metadata.mode & (rootOnly ? 0o077 : 0o022)) !== 0))) {
    throw new ContractError(`${label} ownership or permissions are unsafe`, EXIT.IDENTITY);
  }
  return canonical;
}

async function trustedDirectory(path, label, runtime, { rootOnly = false } = {}) {
  if (!isAbsolute(path) || resolve(path) !== path) throw new ContractError(`${label} path must be absolute`, EXIT.IDENTITY);
  const caller = await lstat(path).catch(() => { throw new ContractError(`${label} is unavailable`, EXIT.IDENTITY); });
  if (caller.isSymbolicLink() || !caller.isDirectory()) throw new ContractError(`${label} must be a non-symbolic directory`, EXIT.IDENTITY);
  const canonical = await realpath(path);
  const metadata = await stat(canonical);
  if (canonical !== path || (!runtime.allowInsecureTestPaths && process.platform !== 'win32' &&
      (metadata.uid !== 0 || (metadata.mode & (rootOnly ? 0o077 : 0o022)) !== 0))) {
    throw new ContractError(`${label} ownership or permissions are unsafe`, EXIT.IDENTITY);
  }
  return canonical;
}

function cleanCosignEnvironment(input = process.env) {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key.toUpperCase().startsWith('COSIGN_') && value !== undefined) output[key] = value;
  }
  return { ...output, COSIGN_YES: 'true' };
}

function assertResult(result, label) {
  if (!result || result.exitCode !== 0 || result.signal || result.overflow) throw new ContractError(`${label} failed`, EXIT.IDENTITY);
  return result;
}

function parseCosignVersion(stdout) {
  let value;
  try { value = JSON.parse(stdout); } catch { throw new ContractError('Cosign version output is not JSON', EXIT.IDENTITY); }
  const version = value.gitVersion ?? value.version;
  if (version !== COSIGN_VERSION && version !== `v${COSIGN_VERSION}`) {
    throw new ContractError(`Cosign executable must be pinned to ${COSIGN_VERSION}`, EXIT.IDENTITY);
  }
  return COSIGN_VERSION;
}

function annotationArgs(annotations) {
  return Object.entries(annotations).sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, value]) => ['-a', `${key}=${value}`]);
}

function annotationsFor(binding) {
  return {
    'booking.component': binding.component,
    'booking.release-id': binding.releaseId,
    'booking.git-sha': binding.gitSha,
    'booking.manifest-digest': binding.manifestDigest,
    'booking.sbom-digest': binding.sbomDigest,
    'booking.provenance-digest': binding.provenanceDigest,
  };
}

async function canonicalEvidence(path, label, expectedDigest, runtime) {
  const canonical = await trustedFile(path, label, runtime, { rootOnly: true });
  const [document, bytes, observedDigest] = await Promise.all([readJsonFile(canonical), readFile(canonical, 'utf8'), digestFile(canonical)]);
  if (bytes !== canonicalDocument(document)) throw new ContractError(`${label} must use canonical JSON bytes`, EXIT.IDENTITY);
  if (observedDigest !== expectedDigest) throw new ContractError(`${label} digest differs from the immutable manifest`, EXIT.IDENTITY);
  return document;
}

async function approvedTrust(runtime) {
  const publicKeyPath = runtime.publicKeyPath || '/etc/happybooking/trust/cosign-preprod.pub';
  const anchorPath = runtime.publicKeyDigestAnchorPath || '/etc/happybooking/trust/cosign-preprod.pub.sha256';
  if (dirname(publicKeyPath) !== dirname(anchorPath)) {
    throw new ContractError('approved Cosign key and digest anchor must share one trusted directory', EXIT.IDENTITY);
  }
  await trustedDirectory(dirname(publicKeyPath), 'approved Cosign trust directory', runtime);
  const publicKey = await trustedFile(publicKeyPath, 'approved Cosign public key', runtime);
  const anchor = await trustedFile(anchorPath, 'approved Cosign public-key digest anchor', runtime);
  const text = await readFile(anchor, 'utf8');
  if (!/^sha256:[0-9a-f]{64}\n$/.test(text)) {
    throw new ContractError('approved Cosign public-key digest anchor must be one canonical digest line', EXIT.IDENTITY);
  }
  const publicKeyDigest = text.trim();
  if (await digestFile(publicKey) !== publicKeyDigest) {
    throw new ContractError('approved Cosign public key differs from its root-owned digest anchor', EXIT.IDENTITY);
  }
  return { publicKey, publicKeyDigest, anchorDigest: await digestFile(anchor) };
}

async function trustedCosign(runtime) {
  const expected = COSIGN_BINARY_DIGESTS[process.arch];
  if (!expected) throw new ContractError(`Cosign ${COSIGN_VERSION} has no approved digest for ${process.arch}`, EXIT.IDENTITY);
  const candidate = runtime.cosignExecutable || '/usr/local/bin/cosign';
  await trustedDirectory(dirname(candidate), 'approved Cosign executable directory', runtime);
  const executable = await trustedFile(candidate, 'approved Cosign executable', runtime);
  if (!runtime.allowUnpinnedTestCosign && await digestFile(executable) !== expected) {
    throw new ContractError(`Cosign ${COSIGN_VERSION} binary digest is not approved for this architecture`, EXIT.IDENTITY);
  }
  return executable;
}

function artifactFor(manifest, component) {
  return manifest.artifacts[component === 'telegram-egress' ? 'telegramEgress' : component];
}

async function verifyComponent({ component, releaseIdentity, manifest, receiptRoot, publicKey, publicKeyDigest, cosign, runner, runtime }) {
  const directory = await trustedDirectory(join(receiptRoot, component), `${component} registry evidence directory`, runtime, { rootOnly: true });
  const receiptPath = join(directory, `${component}.registry-attestation-receipt.json`);
  const sbomPath = join(directory, `${component}.image-sbom.json`);
  const provenancePath = join(directory, `${component}.provenance.json`);
  const artifact = artifactFor(manifest, component);
  const [sbom, provenance] = await Promise.all([
    canonicalEvidence(sbomPath, `${component} normalized SBOM`, artifact.sbomDigest, runtime),
    canonicalEvidence(provenancePath, `${component} local provenance`, artifact.provenanceDigest, runtime),
  ]);
  const receiptFile = await trustedFile(receiptPath, `${component} registry attestation receipt`, runtime, { rootOnly: true });
  const receipt = validateRegistryAttestationReceipt(await readJsonFile(receiptFile), {
    component, releaseId: releaseIdentity.releaseId, gitSha: releaseIdentity.gitSha,
    manifestDigest: releaseIdentity.manifestDigest, image: artifact.image, imageDigest: artifact.digest,
    sbomDigest: artifact.sbomDigest, provenanceDigest: artifact.provenanceDigest,
    publicKeyDigest, signingMode: COSIGN_SIGNING_MODE,
  });
  const common = { component, releaseId: releaseIdentity.releaseId, gitSha: releaseIdentity.gitSha,
    manifestDigest: releaseIdentity.manifestDigest, image: artifact.image, imageDigest: artifact.digest };
  const predicates = [
    { kind: 'image-sbom', evidenceDigest: artifact.sbomDigest, document: sbom },
    { kind: 'local-provenance', evidenceDigest: artifact.provenanceDigest, document: provenance },
  ].map((item) => ({ ...item, predicateType: ATTESTATION_TYPES[item.kind],
    predicate: evidencePredicate({ ...common, ...item }) }));
  const transportArgs = receipt.registryTransport === 'loopback-http' ? ['--allow-insecure-registry'] : [];
  if (receipt.registryTransport === 'loopback-http' && artifact.image.split('/')[0] !== LOOPBACK_HTTP_REGISTRY) {
    throw new ContractError('loopback HTTP receipt escaped the approved registry authority', EXIT.IDENTITY);
  }
  const imageRef = `${artifact.image}@${artifact.digest}`;
  const annotations = annotationsFor({ ...common, sbomDigest: artifact.sbomDigest, provenanceDigest: artifact.provenanceDigest });
  const options = { env: cleanCosignEnvironment(runtime.env), timeoutMs: runtime.timeoutMs || 300_000 };
  const signature = assertResult(await runner(cosign, [
    'verify', ...transportArgs, '--insecure-ignore-tlog', '--key', publicKey, ...annotationArgs(annotations), imageRef,
  ], options), `${component} Cosign signature pull-back`);
  const verification = {
    imageSignaturePayloadDigests: verifyImageSignatureOutput(signature.stdout, {
      image: artifact.image, imageDigest: artifact.digest, annotations,
    }),
    attestations: [],
    pullBackVerified: true,
  };
  for (const predicate of predicates) {
    const result = assertResult(await runner(cosign, [
      'verify-attestation', ...transportArgs, '--insecure-ignore-tlog', '--key', publicKey,
      '--type', predicate.predicateType, imageRef,
    ], options), `${component} ${predicate.kind} attestation pull-back`);
    verification.attestations.push({ kind: predicate.kind, predicateType: predicate.predicateType,
      evidenceDigest: predicate.evidenceDigest, statementDigests: verifyAttestationOutput(result.stdout, {
        kind: predicate.kind, image: artifact.image, imageDigest: artifact.digest, predicate: predicate.predicate,
      }) });
  }
  if (canonicalJson(verification) !== canonicalJson(receipt.verification)) {
    throw new ContractError(`${component} live registry pull-back differs from its immutable receipt`, EXIT.IDENTITY);
  }
  return { receiptDigest: await digestFile(receiptFile), publicKeyDigest, signingMode: receipt.signer.signingMode,
    registryTransport: receipt.registryTransport, verificationDigest: sha256(verification) };
}

export async function verifyRegistrySupplyChainRuntime({ state, releaseIdentity, manifest }, runtime = {}) {
  if (!state || !releaseIdentity || !manifest || state.environment !== 'preprod' || state.project !== 'booking-preprod' ||
      !IDENTIFIER.test(state.operationId || '') || !Number.isInteger(state.fencingEpoch) || state.fencingEpoch < 1) {
    throw new ContractError('registry runtime gate requires a current fenced operation identity', EXIT.IDENTITY);
  }
  if (releaseIdentity.releaseId !== manifest.releaseId || releaseIdentity.gitSha !== manifest.source.gitSha ||
      releaseIdentity.manifestDigest !== sha256(manifest)) {
    throw new ContractError('registry runtime gate manifest identity drifted', EXIT.IDENTITY);
  }
  const receiptRootPath = runtime.registryEvidenceRoot ||
    `/volume1/homes/realzyq/${state.project}/.g4/supply-chain/${releaseIdentity.releaseId}`;
  const receiptRoot = await trustedDirectory(receiptRootPath, 'registry supply-chain evidence root', runtime, { rootOnly: true });
  const [{ publicKey, publicKeyDigest, anchorDigest }, cosign] = await Promise.all([approvedTrust(runtime), trustedCosign(runtime)]);
  const runner = runtime.cosignCommandRunner || runtime.commandRunner;
  if (typeof runner !== 'function') throw new ContractError('registry runtime gate command runner is unavailable', EXIT.IDENTITY);
  const version = assertResult(await runner(cosign, ['version', '--json'], {
    env: cleanCosignEnvironment(runtime.env), timeoutMs: 30_000,
  }), 'Cosign version check');
  parseCosignVersion(version.stdout);
  const components = {};
  for (const component of COMPONENTS) components[component] = await verifyComponent({
    component, releaseIdentity, manifest, receiptRoot, publicKey, publicKeyDigest, cosign, runner, runtime,
  });
  return {
    schema: 'booking.registry-runtime-gate/v1', environment: state.environment, project: state.project,
    operationId: state.operationId, fencingEpoch: state.fencingEpoch, releaseId: releaseIdentity.releaseId,
    gitSha: releaseIdentity.gitSha, manifestDigest: releaseIdentity.manifestDigest,
    trust: { publicKeyDigest, anchorDigest, cosignVersion: COSIGN_VERSION, signingMode: COSIGN_SIGNING_MODE },
    components,
  };
}
