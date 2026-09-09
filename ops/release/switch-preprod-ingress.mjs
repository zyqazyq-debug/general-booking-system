#!/usr/bin/env node
import { open, lstat, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXIT = Object.freeze({ INGRESS: 60 });

export class ContractError extends Error {
  constructor(message, exitCode = EXIT.INGRESS) {
    super(message);
    this.name = 'ContractError';
    this.exitCode = exitCode;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  const bytes = typeof value === 'string' ? value : canonicalJson(value);
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export const CLOUDFLARE_ACCOUNT_ID = 'a29dfe7707f6e6cec070a6fafd7c90d3';
export const CLOUDFLARE_TUNNEL_ID = '008210c0-6e25-4726-8976-03b6d77d39e2';
export const PREPROD_PROJECT = 'booking-preprod';
export const PREPROD_HOSTNAME = 'booking-preprod.happybooking.uk';
export const TOKEN_FILE = '/etc/happybooking/secrets/cloudflare-preprod-api-token';
export const PROOF_FILE = '/var/lib/happybooking/ingress/booking-preprod-proof.json';
export const LOCK_FILE = '/var/lib/happybooking/ingress/booking-preprod.lock';

const API_URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${CLOUDFLARE_TUNNEL_ID}/configurations`;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RELEASE_ID = /^booking-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/;
const UPSTREAM = /^gateway-(green|blue):8080$/;
const TOKEN = /^[A-Za-z0-9_-]{20,256}$/;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const PROOF_KEYS = [
  'schema', 'accountId', 'tunnelId', 'project', 'hostname', 'upstream', 'remoteService',
  'releaseId', 'manifestDigest', 'operationId', 'fencingEpoch', 'remoteVersion',
  'remoteConfigDigest', 'guard', 'writtenAt', 'previousProofDigest', 'proofDigest',
];

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) {
    throw new ContractError(`${label} has an invalid shape`, EXIT.INGRESS);
  }
}

function parseCliArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) throw new ContractError('unexpected ingress helper argument', EXIT.INGRESS);
    const key = item.slice(2);
    if (Object.hasOwn(args, key)) throw new ContractError(`duplicate ingress helper argument: --${key}`, EXIT.INGRESS);
    if (key === 'readback') {
      args.readback = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new ContractError(`missing value for --${key}`, EXIT.INGRESS);
    args[key] = value;
    index += 1;
  }
  return args;
}

function validateScope(args) {
  const readback = args.readback === true;
  const allowed = readback
    ? ['readback', 'project', 'hostname']
    : ['project', 'hostname', 'upstream', 'release', 'manifest-digest', 'operation-id', 'fencing-epoch'];
  exactKeys(args, allowed, 'ingress helper arguments');
  if (args.project !== PREPROD_PROJECT || args.hostname !== PREPROD_HOSTNAME) {
    throw new ContractError('ingress helper is pinned to the booking-preprod hostname', EXIT.INGRESS);
  }
  if (readback) return { readback: true };
  if (!UPSTREAM.test(args.upstream || '')) throw new ContractError('ingress upstream is outside the preproduction slot allowlist', EXIT.INGRESS);
  if (!RELEASE_ID.test(args.release || '')) throw new ContractError('ingress release identity is invalid', EXIT.INGRESS);
  if (!DIGEST.test(args['manifest-digest'] || '')) throw new ContractError('ingress manifest digest is invalid', EXIT.INGRESS);
  if (!IDENTIFIER.test(args['operation-id'] || '')) throw new ContractError('ingress operation identity is invalid', EXIT.INGRESS);
  const fencingEpoch = Number(args['fencing-epoch']);
  if (!Number.isSafeInteger(fencingEpoch) || fencingEpoch < 1) throw new ContractError('ingress fencing epoch is invalid', EXIT.INGRESS);
  return { readback: false, fencingEpoch };
}

async function assertTrustedPath(path, kind, runtime) {
  const metadata = await lstat(path).catch(() => { throw new ContractError(`${kind} is unavailable`, EXIT.INGRESS); });
  const canonical = await realpath(path).catch(() => { throw new ContractError(`${kind} cannot be resolved`, EXIT.INGRESS); });
  if (canonical !== resolve(path)) throw new ContractError(`${kind} must not be a symlink`, EXIT.INGRESS);
  if (kind.endsWith('directory') ? !metadata.isDirectory() : !metadata.isFile()) throw new ContractError(`${kind} has the wrong file type`, EXIT.INGRESS);
  if (!runtime.allowInsecureTestPaths && process.platform !== 'win32') {
    if (metadata.uid !== 0) throw new ContractError(`${kind} must be root-owned`, EXIT.INGRESS);
    const forbidden = ['token file', 'ingress proof file', 'ingress state directory'].includes(kind) ? 0o077 : 0o022;
    if ((metadata.mode & forbidden) !== 0) throw new ContractError(`${kind} permissions are too broad`, EXIT.INGRESS);
  }
  return metadata;
}

async function loadToken(runtime) {
  const tokenFile = runtime.tokenFile || TOKEN_FILE;
  await assertTrustedPath(dirname(tokenFile), 'token directory', runtime);
  const before = await assertTrustedPath(tokenFile, 'token file', runtime);
  let handle;
  let raw;
  try {
    handle = await open(tokenFile, 'r');
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || !after.isFile()) throw new Error('token identity changed');
    raw = await handle.readFile('utf8');
  } catch {
    throw new ContractError('token file cannot be read safely', EXIT.INGRESS);
  } finally { await handle?.close().catch(() => {}); }
  if (raw.includes('\0')) throw new ContractError('token file is invalid', EXIT.INGRESS);
  const token = raw.trim();
  if (!TOKEN.test(token)) throw new ContractError('token file is invalid', EXIT.INGRESS);
  return token;
}

function validateSnapshotEnvelope(envelope) {
  if (!envelope || envelope.success !== true || !envelope.result) throw new ContractError('Cloudflare configuration request was rejected', EXIT.INGRESS);
  const result = envelope.result;
  if (result.account_id !== CLOUDFLARE_ACCOUNT_ID || result.tunnel_id !== CLOUDFLARE_TUNNEL_ID || result.source !== 'cloudflare') {
    throw new ContractError('Cloudflare configuration identity is outside the pinned preproduction tunnel', EXIT.INGRESS);
  }
  if (!Number.isSafeInteger(result.version) || result.version < 0 || !result.config || typeof result.config !== 'object' || Array.isArray(result.config) || !Array.isArray(result.config.ingress)) {
    throw new ContractError('Cloudflare configuration response is incomplete', EXIT.INGRESS);
  }
  const targetIndexes = [];
  for (let index = 0; index < result.config.ingress.length; index += 1) {
    const rule = result.config.ingress[index];
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) || typeof rule.service !== 'string') {
      throw new ContractError('Cloudflare ingress rule is malformed', EXIT.INGRESS);
    }
    if (rule.hostname === 'app.happybooking.uk') throw new ContractError('production hostname is forbidden in the preproduction tunnel', EXIT.INGRESS);
    if (rule.hostname === PREPROD_HOSTNAME) targetIndexes.push(index);
  }
  if (targetIndexes.length !== 1) throw new ContractError('pinned preproduction hostname must have exactly one ingress rule', EXIT.INGRESS);
  const targetIndex = targetIndexes[0];
  if (!/^http:\/\/gateway-(green|blue):8080$/.test(result.config.ingress[targetIndex].service)) {
    throw new ContractError('existing preproduction ingress service is outside the slot allowlist', EXIT.INGRESS);
  }
  return {
    version: result.version,
    config: structuredClone(result.config),
    configDigest: sha256(result.config),
    targetIndex,
  };
}

async function cloudflareRequest(method, token, runtime, config, ifMatch) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  if (config) headers['Content-Type'] = 'application/json';
  if (ifMatch) headers['If-Match'] = ifMatch;
  let response;
  try {
    response = await (runtime.fetchImpl || fetch)(API_URL, {
      method,
      headers,
      redirect: 'error',
      signal: runtime.signal || AbortSignal.timeout(15_000),
      ...(config ? { body: JSON.stringify({ config }) } : {}),
    });
  } catch {
    throw new ContractError('Cloudflare configuration request failed', EXIT.INGRESS);
  }
  if (!response?.ok) throw new ContractError(`Cloudflare configuration request failed with HTTP ${Number(response?.status) || 0}`, EXIT.INGRESS);
  const text = await response.text().catch(() => { throw new ContractError('Cloudflare configuration response cannot be read', EXIT.INGRESS); });
  if (text.length > MAX_RESPONSE_BYTES) throw new ContractError('Cloudflare configuration response is too large', EXIT.INGRESS);
  let envelope;
  try { envelope = JSON.parse(text); } catch { throw new ContractError('Cloudflare configuration response is not JSON', EXIT.INGRESS); }
  return { snapshot: validateSnapshotEnvelope(envelope), etag: response.headers?.get?.('etag') || null };
}

function assertSameSnapshot(first, second) {
  if (first.snapshot.version !== second.snapshot.version || first.snapshot.configDigest !== second.snapshot.configDigest ||
      (first.etag && second.etag && first.etag !== second.etag)) {
    throw new ContractError('Cloudflare configuration changed during guarded preflight', EXIT.INGRESS);
  }
}

function desiredConfiguration(snapshot, upstream) {
  const config = structuredClone(snapshot.config);
  config.ingress[snapshot.targetIndex] = { ...config.ingress[snapshot.targetIndex], service: `http://${upstream}` };
  return config;
}

function assertOnlyTargetServiceChanged(before, after, targetIndex, expectedService) {
  if (after.ingress[targetIndex]?.service !== expectedService) throw new ContractError('target ingress service did not converge', EXIT.INGRESS);
  if (before.ingress.length !== after.ingress.length) throw new ContractError('Cloudflare update changed ingress rule count', EXIT.INGRESS);
  for (let index = 0; index < before.ingress.length; index += 1) {
    if (index === targetIndex) {
      const { service: _beforeService, ...beforeRest } = before.ingress[index];
      const { service: _afterService, ...afterRest } = after.ingress[index];
      if (canonicalJson(beforeRest) !== canonicalJson(afterRest)) throw new ContractError('Cloudflare update changed target rule metadata', EXIT.INGRESS);
    } else if (canonicalJson(before.ingress[index]) !== canonicalJson(after.ingress[index])) {
      throw new ContractError('Cloudflare update changed an unrelated ingress rule', EXIT.INGRESS);
    }
  }
  const { ingress: _beforeIngress, ...beforeRest } = before;
  const { ingress: _afterIngress, ...afterRest } = after;
  if (canonicalJson(beforeRest) !== canonicalJson(afterRest)) throw new ContractError('Cloudflare update changed unrelated tunnel configuration', EXIT.INGRESS);
}

function validateProof(value) {
  exactKeys(value, PROOF_KEYS, 'local ingress proof');
  const { proofDigest, ...body } = value;
  if (value.schema !== 'booking.cloudflare-ingress-proof/v1' || value.accountId !== CLOUDFLARE_ACCOUNT_ID ||
      value.tunnelId !== CLOUDFLARE_TUNNEL_ID || value.project !== PREPROD_PROJECT || value.hostname !== PREPROD_HOSTNAME ||
      !UPSTREAM.test(value.upstream) || value.remoteService !== `http://${value.upstream}` || !RELEASE_ID.test(value.releaseId) ||
      !DIGEST.test(value.manifestDigest) || !IDENTIFIER.test(value.operationId) || !Number.isSafeInteger(value.fencingEpoch) || value.fencingEpoch < 1 ||
      !Number.isSafeInteger(value.remoteVersion) || value.remoteVersion < 0 || !DIGEST.test(value.remoteConfigDigest) ||
      !value.guard || value.guard.mode !== 'double-read-version-and-digest' || value.guard.atomicRemoteCas !== false ||
      !Number.isFinite(Date.parse(value.writtenAt)) || (value.previousProofDigest !== null && !DIGEST.test(value.previousProofDigest)) ||
      !DIGEST.test(proofDigest) || sha256(body) !== proofDigest) {
    throw new ContractError('local ingress proof failed validation', EXIT.INGRESS);
  }
  return value;
}

async function loadProof(runtime, optional = false) {
  const proofFile = runtime.proofFile || PROOF_FILE;
  try { await assertTrustedPath(proofFile, 'ingress proof file', runtime); }
  catch (error) {
    if (optional && error instanceof ContractError && error.message === 'ingress proof file is unavailable') return null;
    throw error;
  }
  let value;
  try { value = JSON.parse(await readFile(proofFile, 'utf8')); }
  catch { throw new ContractError('local ingress proof cannot be read', EXIT.INGRESS); }
  return validateProof(value);
}

async function writeProof(runtime, body) {
  const proofFile = runtime.proofFile || PROOF_FILE;
  const directory = dirname(proofFile);
  await assertTrustedPath(directory, 'ingress state directory', runtime);
  const proof = { ...body, proofDigest: sha256(body) };
  const temporary = `${proofFile}.new-${process.pid}`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(proof)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, proofFile);
    if (process.platform !== 'win32') {
      const directoryHandle = await open(directory, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    }
  } catch {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw new ContractError('local ingress proof cannot be stored atomically', EXIT.INGRESS);
  }
  return proof;
}

async function withLocalLock(runtime, callback) {
  const lockFile = runtime.lockFile || LOCK_FILE;
  await assertTrustedPath(dirname(lockFile), 'ingress state directory', runtime);
  let handle;
  try {
    handle = await open(lockFile, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ schema: 'booking.cloudflare-ingress-lock/v1', pid: process.pid })}\n`, 'utf8');
    await handle.sync();
  } catch {
    await handle?.close().catch(() => {});
    throw new ContractError('ingress helper lock exists; explicit forensic recovery is required', EXIT.INGRESS);
  }
  try { return await callback(); }
  finally {
    await handle.close().catch(() => {});
    await unlink(lockFile).catch(() => {});
  }
}

function readbackObject(proof, observedAt) {
  return {
    schema: 'booking.ingress-readback/v1',
    project: proof.project,
    hostname: proof.hostname,
    upstream: proof.upstream,
    releaseId: proof.releaseId,
    manifestDigest: proof.manifestDigest,
    operationId: proof.operationId,
    fencingEpoch: proof.fencingEpoch,
    observedAt,
  };
}

function trustedNow(runtime) {
  const value = (runtime.now || (() => new Date()))();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new ContractError('trusted ingress helper clock is invalid', EXIT.INGRESS);
  return value;
}

async function verifyRemoteAgainstProof(proof, token, runtime) {
  const remote = await cloudflareRequest('GET', token, runtime);
  const target = remote.snapshot.config.ingress[remote.snapshot.targetIndex];
  if (remote.snapshot.version !== proof.remoteVersion || remote.snapshot.configDigest !== proof.remoteConfigDigest || target.service !== proof.remoteService) {
    throw new ContractError('remote Cloudflare ingress drifted from the local fenced proof', EXIT.INGRESS);
  }
  return readbackObject(proof, trustedNow(runtime).toISOString());
}

async function executeReadback(runtime) {
  return withLocalLock(runtime, async () => {
    const proof = await loadProof(runtime);
    const token = await loadToken(runtime);
    return verifyRemoteAgainstProof(proof, token, runtime);
  });
}

async function executeMutation(args, fencingEpoch, runtime) {
  return withLocalLock(runtime, async () => {
    const priorProof = await loadProof(runtime, true);
    if (priorProof && priorProof.fencingEpoch > fencingEpoch) throw new ContractError('ingress fencing epoch is stale', EXIT.INGRESS);
    const sameIdentity = priorProof && priorProof.fencingEpoch === fencingEpoch && priorProof.releaseId === args.release &&
      priorProof.manifestDigest === args['manifest-digest'] && priorProof.operationId === args['operation-id'] && priorProof.upstream === args.upstream;
    if (priorProof && priorProof.fencingEpoch === fencingEpoch && !sameIdentity) throw new ContractError('ingress fencing epoch is already bound to another operation', EXIT.INGRESS);

    const token = await loadToken(runtime);
    if (sameIdentity) return verifyRemoteAgainstProof(priorProof, token, runtime);

    const first = await cloudflareRequest('GET', token, runtime);
    const second = await cloudflareRequest('GET', token, runtime);
    assertSameSnapshot(first, second);
    const desired = desiredConfiguration(second.snapshot, args.upstream);
    assertOnlyTargetServiceChanged(second.snapshot.config, desired, second.snapshot.targetIndex, `http://${args.upstream}`);

    let post = second;
    if (second.snapshot.configDigest !== sha256(desired)) {
      const updated = await cloudflareRequest('PUT', token, runtime, desired, second.etag);
      if (updated.snapshot.version <= second.snapshot.version) throw new ContractError('Cloudflare update did not advance the configuration version', EXIT.INGRESS);
      if (updated.snapshot.configDigest !== sha256(desired)) throw new ContractError('Cloudflare update response does not match the requested configuration', EXIT.INGRESS);
      post = await cloudflareRequest('GET', token, runtime);
      if (post.snapshot.version !== updated.snapshot.version || post.snapshot.configDigest !== updated.snapshot.configDigest) {
        throw new ContractError('Cloudflare configuration changed before post-update readback', EXIT.INGRESS);
      }
    }
    assertOnlyTargetServiceChanged(second.snapshot.config, post.snapshot.config, second.snapshot.targetIndex, `http://${args.upstream}`);

    const writtenAt = trustedNow(runtime);
    const proof = await writeProof(runtime, {
      schema: 'booking.cloudflare-ingress-proof/v1', accountId: CLOUDFLARE_ACCOUNT_ID, tunnelId: CLOUDFLARE_TUNNEL_ID,
      project: PREPROD_PROJECT, hostname: PREPROD_HOSTNAME, upstream: args.upstream, remoteService: `http://${args.upstream}`,
      releaseId: args.release, manifestDigest: args['manifest-digest'], operationId: args['operation-id'], fencingEpoch,
      remoteVersion: post.snapshot.version, remoteConfigDigest: post.snapshot.configDigest,
      guard: { mode: 'double-read-version-and-digest', atomicRemoteCas: false, opportunisticIfMatch: Boolean(second.etag) },
      writtenAt: writtenAt.toISOString(), previousProofDigest: priorProof?.proofDigest || null,
    });
    return readbackObject(proof, writtenAt.toISOString());
  });
}

export async function runIngressHelper(argv, runtime = {}) {
  const args = parseCliArgs(argv);
  const scope = validateScope(args);
  return scope.readback ? executeReadback(runtime) : executeMutation(args, scope.fencingEpoch, runtime);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await assertTrustedPath(fileURLToPath(import.meta.url), 'ingress implementation file', {});
    process.stdout.write(`${JSON.stringify(await runIngressHelper(process.argv.slice(2)))}\n`);
  } catch (error) {
    const failure = error instanceof ContractError ? error : new ContractError('unexpected ingress helper failure', EXIT.INGRESS);
    process.stderr.write(`${JSON.stringify({ schema: 'booking.ingress-error/v1', status: 'fail', message: failure.message })}\n`);
    process.exitCode = failure.exitCode;
  }
}
