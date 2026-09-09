#!/usr/bin/env node
import { constants } from 'node:fs';
import { access, link, lstat, mkdir, open, readFile, realpath, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { canonicalDocument, digestFile, readArtifact } from './lib/artifacts.mjs';
import { ContractError, gateResult, parseArgs, readJsonFile, sha256, validateReleaseManifest } from './lib/contracts.mjs';
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
} from './lib/registry-attestation.mjs';

const ALLOWED_ARGS = new Set([
  'execute', 'component', 'manifest', 'manifest-digest', 'native-sbom', 'sbom', 'provenance',
  'private-key', 'public-key', 'public-key-digest', 'signing-mode', 'registry-transport', 'receipt',
]);
const REQUIRED_ARGS = [...ALLOWED_ARGS].filter((key) => key !== 'registry-transport');
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;

export function parseRegistryAttestationArgs(argv) {
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 2) {
    const item = argv[index];
    const key = typeof item === 'string' && item.startsWith('--') ? item.slice(2) : '';
    if (!ALLOWED_ARGS.has(key)) throw new ContractError(`unsupported registry attestation argument: ${item}`);
    if (seen.has(key)) throw new ContractError(`duplicate registry attestation argument: --${key}`);
    seen.add(key);
  }
  return parseArgs(argv);
}

function cleanCosignEnvironment(input = process.env, { signing = false } = {}) {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if ((!key.toUpperCase().startsWith('COSIGN_') || (signing && key === 'COSIGN_PASSWORD')) && value !== undefined) output[key] = value;
  }
  return { ...output, COSIGN_YES: 'true' };
}

function runCapture(executable, args, { env = process.env, timeoutMs = 300_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 64 * 1024 * 1024) child.kill('SIGKILL');
      else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 64 * 1024) stderr.push(chunk);
    });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolvePromise({ exitCode, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
  });
}

async function trustedRegularFile(path, label, { privateFile = false, allowInsecureTestPaths = false } = {}) {
  if (!path || resolve(path) !== path) throw new ContractError(`${label} path must be absolute`);
  const callerMetadata = await lstat(path).catch(() => { throw new ContractError(`${label} is unavailable`); });
  if (callerMetadata.isSymbolicLink() || !callerMetadata.isFile()) throw new ContractError(`${label} must be a regular non-symbolic file`);
  const canonical = await realpath(path);
  const metadata = await stat(canonical);
  if (!allowInsecureTestPaths && (process.platform === 'win32' || metadata.uid !== 0 ||
      (privateFile ? (metadata.mode & 0o077) !== 0 : (metadata.mode & 0o022) !== 0))) {
    throw new ContractError(`${label} ownership or permissions are unsafe`);
  }
  return canonical;
}

async function trustedReceiptParent(path, runtime) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const canonical = await realpath(path);
  const metadata = await stat(canonical);
  if (!metadata.isDirectory() || (!runtime.allowInsecureTestPaths &&
      (process.platform === 'win32' || metadata.uid !== 0 || (metadata.mode & 0o077) !== 0))) {
    throw new ContractError('registry receipt parent must be a root-only directory');
  }
  return canonical;
}

async function trustedCosign(runtime) {
  if (runtime.cosignExecutable) return runtime.cosignExecutable;
  const candidate = '/usr/local/bin/cosign';
  await access(candidate, constants.X_OK).catch(() => { throw new ContractError('trusted Cosign executable is unavailable'); });
  const canonical = await trustedRegularFile(await realpath(candidate), 'Cosign executable');
  const expectedDigest = COSIGN_BINARY_DIGESTS[process.arch];
  if (!expectedDigest || await digestFile(canonical) !== expectedDigest) throw new ContractError(`Cosign ${COSIGN_VERSION} binary digest is not approved for this architecture`);
  return canonical;
}

async function canonicalEvidence(path, label) {
  const document = await readJsonFile(path);
  const bytes = await readFile(path, 'utf8');
  if (bytes !== canonicalDocument(document)) throw new ContractError(`${label} must use canonical JSON bytes`);
  return document;
}

function assertSuccess(result, label) {
  if (result?.exitCode !== 0) throw new ContractError(`${label} failed`);
  return result;
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

function annotationArgs(annotations) {
  return Object.entries(annotations).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .flatMap(([key, value]) => ['-a', `${key}=${value}`]);
}

function validateArguments(args) {
  for (const key of Object.keys(args)) if (!ALLOWED_ARGS.has(key)) throw new ContractError(`unsupported registry attestation argument: --${key}`);
  for (const key of REQUIRED_ARGS) if (!args[key]) throw new ContractError(`--${key} is required`);
  if (args.execute !== 'true' || !['backend', 'gateway', 'telegram-egress'].includes(args.component)) throw new ContractError('--execute true and a valid --component are required');
  if (!SHA256_DIGEST.test(args['public-key-digest'])) throw new ContractError('--public-key-digest must be a SHA-256 digest');
  if (args['signing-mode'] !== COSIGN_SIGNING_MODE) throw new ContractError(`--signing-mode must be ${COSIGN_SIGNING_MODE}`);
  if (args['registry-transport'] && !['https', 'loopback-http'].includes(args['registry-transport'])) {
    throw new ContractError('--registry-transport must be https or loopback-http');
  }
  for (const key of ['manifest', 'native-sbom', 'sbom', 'provenance', 'private-key', 'public-key', 'receipt']) {
    if (resolve(args[key]) !== args[key]) throw new ContractError(`--${key} must be an absolute path`);
  }
  return args;
}

function registryTransport(image, requested) {
  const transport = requested || 'https';
  if (transport === 'loopback-http' && !image.startsWith(`${LOOPBACK_HTTP_REGISTRY}/`)) {
    throw new ContractError(`loopback HTTP registry transport is restricted to ${LOOPBACK_HTTP_REGISTRY}`);
  }
  return transport;
}

function registryTransportArgs(binding) {
  return binding.registryTransport === 'loopback-http' ? ['--allow-insecure-registry'] : [];
}

async function verifyRegistry(binding, runtime) {
  const runner = runtime.commandRunner || runCapture;
  const options = { timeoutMs: 300_000, env: cleanCosignEnvironment(runtime.env) };
  const imageRef = `${binding.image}@${binding.imageDigest}`;
  const annotations = annotationsFor(binding);
  const signature = assertSuccess(await runner(binding.cosign, [
    'verify', ...registryTransportArgs(binding), '--insecure-ignore-tlog', '--key', binding.publicKey, ...annotationArgs(annotations), imageRef,
  ], options), 'Cosign image signature pull-back verification');
  const imageSignaturePayloadDigests = verifyImageSignatureOutput(signature.stdout, {
    image: binding.image, imageDigest: binding.imageDigest, annotations,
  });
  const attestations = [];
  for (const item of binding.predicates) {
    const verified = assertSuccess(await runner(binding.cosign, [
      'verify-attestation', ...registryTransportArgs(binding), '--insecure-ignore-tlog', '--key', binding.publicKey, '--type', item.predicateType, imageRef,
    ], options), `Cosign ${item.kind} pull-back verification`);
    attestations.push({
      kind: item.kind,
      predicateType: item.predicateType,
      evidenceDigest: item.evidenceDigest,
      statementDigests: verifyAttestationOutput(verified.stdout, {
        kind: item.kind, image: binding.image, imageDigest: binding.imageDigest, predicate: item.predicate,
      }),
    });
  }
  return { imageSignaturePayloadDigests, attestations, pullBackVerified: true };
}

async function attachRegistry(binding, runtime) {
  const environment = runtime.env || process.env;
  if (typeof environment.COSIGN_PASSWORD !== 'string' || environment.COSIGN_PASSWORD.length === 0) {
    throw new ContractError('COSIGN_PASSWORD must be supplied through the process environment for registry attachment');
  }
  const runner = runtime.commandRunner || runCapture;
  const options = { timeoutMs: 300_000, env: cleanCosignEnvironment(environment, { signing: true }) };
  const imageRef = `${binding.image}@${binding.imageDigest}`;
  assertSuccess(await runner(binding.cosign, [
    'sign', ...registryTransportArgs(binding), '--yes', '--use-signing-config=false', '--tlog-upload=false', '--key', binding.privateKey,
    ...annotationArgs(annotationsFor(binding)), imageRef,
  ], options), 'Cosign immutable image signing');
  for (const item of binding.predicates) {
    assertSuccess(await runner(binding.cosign, [
      'attest', ...registryTransportArgs(binding), '--yes', '--use-signing-config=false', '--tlog-upload=false', '--key', binding.privateKey,
      '--type', item.predicateType, '--predicate', item.path, imageRef,
    ], options), `Cosign ${item.kind} registry attachment`);
  }
}

async function loadBinding(args, runtime) {
  const pathOptions = { allowInsecureTestPaths: runtime.allowInsecureTestPaths };
  const [manifestPath, nativeSbomPath, sbomPath, provenancePath, publicKey] = await Promise.all([
    trustedRegularFile(resolve(args.manifest), 'release manifest', pathOptions),
    trustedRegularFile(resolve(args['native-sbom']), 'native Syft SBOM', pathOptions),
    trustedRegularFile(resolve(args.sbom), 'normalized image SBOM', pathOptions),
    trustedRegularFile(resolve(args.provenance), 'local provenance', pathOptions),
    trustedRegularFile(resolve(args['public-key']), 'Cosign public key', pathOptions),
  ]);
  const manifest = validateReleaseManifest(await readJsonFile(manifestPath));
  const manifestDigest = sha256(manifest);
  if (manifestDigest !== args['manifest-digest']) throw new ContractError('release manifest digest does not match the canonical manifest');
  const artifact = manifest.artifacts[args.component === 'telegram-egress' ? 'telegramEgress' : args.component];
  const sbomDigest = await readArtifact(sbomPath, args.component, manifest.source.gitSha, artifact.image, artifact.digest, 'SBOM', { nativePath: nativeSbomPath });
  if (sbomDigest !== artifact.sbomDigest) throw new ContractError('normalized image SBOM digest differs from the release manifest');
  const provenanceDigest = await readArtifact(provenancePath, args.component, manifest.source.gitSha, artifact.image, artifact.digest, 'provenance', {
    sbomDigest, ...(args.component === 'telegram-egress' ? { baseImage: `${artifact.baseImage}@${artifact.baseImageDigest}` } : {}),
  });
  if (provenanceDigest !== artifact.provenanceDigest) throw new ContractError('local provenance digest differs from the release manifest');
  const [sbomDocument, provenanceDocument] = await Promise.all([
    canonicalEvidence(sbomPath, 'normalized image SBOM'), canonicalEvidence(provenancePath, 'local provenance'),
  ]);
  if (provenanceDocument.predicateType !== 'urn:booking:attestation:local-provenance:v1') {
    throw new ContractError('registry evidence must remain explicitly local non-SLSA provenance');
  }
  const common = {
    component: args.component, releaseId: manifest.releaseId, gitSha: manifest.source.gitSha,
    manifestDigest, image: artifact.image, imageDigest: artifact.digest,
  };
  const transport = registryTransport(artifact.image, args['registry-transport']);
  const publicKeyDigest = await digestFile(publicKey);
  if (publicKeyDigest !== args['public-key-digest']) throw new ContractError('Cosign public key digest differs from the approved trust root');
  return {
    ...common, sbomDigest, provenanceDigest, publicKey, registryTransport: transport,
    publicKeyDigest, signingMode: COSIGN_SIGNING_MODE, cosign: await trustedCosign(runtime),
    predicates: [
      { kind: 'image-sbom', predicateType: ATTESTATION_TYPES['image-sbom'], evidenceDigest: sbomDigest,
        document: sbomDocument, predicate: evidencePredicate({ ...common, kind: 'image-sbom', evidenceDigest: sbomDigest, document: sbomDocument }) },
      { kind: 'local-provenance', predicateType: ATTESTATION_TYPES['local-provenance'], evidenceDigest: provenanceDigest,
        document: provenanceDocument, predicate: evidencePredicate({ ...common, kind: 'local-provenance', evidenceDigest: provenanceDigest, document: provenanceDocument }) },
    ],
  };
}

async function writePrivateFile(path, document) {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(canonicalDocument(document), 'utf8');
    if (process.platform !== 'win32') await handle.sync();
  } finally { await handle.close(); }
}

async function writeReceipt(path, document) {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writePrivateFile(temp, document);
    await link(temp, path).catch((error) => {
      if (error?.code === 'EEXIST') throw new ContractError('immutable registry attestation receipt already exists');
      throw error;
    });
  } finally { await unlink(temp).catch(() => {}); }
}

export async function attestRegistryEvidence(args, runtime = {}) {
  validateArguments(args);
  const receiptPath = args.receipt;
  const binding = await loadBinding(args, runtime);
  await trustedReceiptParent(dirname(receiptPath), runtime);
  const versionResult = assertSuccess(await (runtime.commandRunner || runCapture)(binding.cosign, ['version', '--json'], {
    timeoutMs: 30_000, env: cleanCosignEnvironment(runtime.env),
  }), 'Cosign version check');
  let version;
  try { const value = JSON.parse(versionResult.stdout); version = value.gitVersion ?? value.version; } catch { throw new ContractError('Cosign version output is not JSON'); }
  if (version !== `v${COSIGN_VERSION}` && version !== COSIGN_VERSION) throw new ContractError(`Cosign executable must be pinned to ${COSIGN_VERSION}`);
  const expected = { ...binding };
  const existing = await lstat(receiptPath).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (existing) {
    const trustedReceipt = await trustedRegularFile(receiptPath, 'registry attestation receipt', {
      privateFile: true, allowInsecureTestPaths: runtime.allowInsecureTestPaths,
    });
    const receipt = validateRegistryAttestationReceipt(await readJsonFile(trustedReceipt), expected);
    const verification = await verifyRegistry(binding, runtime);
    if (sha256(verification) !== sha256(receipt.verification)) throw new ContractError('registry pull-back verification no longer matches the immutable receipt');
    return { receipt, replayed: true, receiptDigest: await digestFile(receiptPath) };
  }
  const privateKey = await trustedRegularFile(resolve(args['private-key']), 'Cosign private key', {
    privateFile: true, allowInsecureTestPaths: runtime.allowInsecureTestPaths,
  });
  binding.privateKey = privateKey;
  const predicateRoot = dirname(receiptPath);
  for (const item of binding.predicates) {
    item.path = resolve(predicateRoot, `.${args.component}.${item.kind}.${process.pid}.${randomUUID()}.predicate.json`);
    await writePrivateFile(item.path, item.predicate);
  }
  try {
    await attachRegistry(binding, runtime);
    const verification = await verifyRegistry(binding, runtime);
    const receipt = validateRegistryAttestationReceipt({
      schema: 'booking.registry-attestation-receipt/v1', component: binding.component, registryTransport: binding.registryTransport,
      releaseId: binding.releaseId, gitSha: binding.gitSha, manifestDigest: binding.manifestDigest,
      image: { name: binding.image, digest: binding.imageDigest },
      evidence: { sbomDigest: binding.sbomDigest, provenanceDigest: binding.provenanceDigest },
      signer: { mode: 'self-managed-key', cosignVersion: COSIGN_VERSION, publicKeyDigest: binding.publicKeyDigest,
        signingMode: binding.signingMode },
      verification, verifiedAt: (runtime.now ? runtime.now() : new Date()).toISOString(),
    }, expected);
    await writeReceipt(receiptPath, receipt);
    return { receipt, replayed: false, receiptDigest: await digestFile(receiptPath) };
  } finally {
    await Promise.all(binding.predicates.map((item) => rm(item.path, { force: true })));
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const result = await attestRegistryEvidence(parseRegistryAttestationArgs(process.argv.slice(2)), { env: process.env });
    process.stdout.write(`${JSON.stringify(gateResult({ gate: 'registry-attestation-pull-back', releaseId: result.receipt.releaseId,
      checks: [{ name: result.receipt.component, status: 'pass', code: result.replayed ? 'REGISTRY_ATTESTATION_REPLAY_VERIFIED' : 'REGISTRY_ATTESTATION_ATTACHED_AND_VERIFIED' }] }))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 20;
  }
}
