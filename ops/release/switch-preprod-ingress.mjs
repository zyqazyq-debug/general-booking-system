#!/usr/bin/env node
import { mkdir, open, lstat, readdir, realpath, rename, unlink } from 'node:fs/promises';
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
export const PROOF_ARCHIVE_DIRECTORY = '/var/lib/happybooking/ingress/booking-preprod-proofs';
export const LOCK_FILE = '/var/lib/happybooking/ingress/booking-preprod.lock';

const API_URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${CLOUDFLARE_TUNNEL_ID}/configurations`;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RELEASE_ID = /^booking-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/;
const UPSTREAM = /^gateway-(green|blue):8080$/;
const TOKEN = /^[A-Za-z0-9_-]{20,256}$/;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_PROOF_BYTES = 64 * 1024;
const ACTION_KIND = new Set(['preprod-switch-ingress', 'preprod-rollback-ingress']);
const PROOF_KEYS = [
  'schema', 'accountId', 'tunnelId', 'project', 'hostname', 'upstream', 'remoteService',
  'releaseId', 'manifestDigest', 'operationId', 'approvalId', 'leaseId', 'holderId',
  'actionKind', 'actionId', 'sequence', 'fencingEpoch', 'rollbackUpstream',
  'rollbackReleaseId', 'rollbackManifestDigest', 'remoteVersion',
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
    : ['execute', 'environment', 'project', 'hostname', 'upstream', 'release', 'manifest-digest', 'operation-id', 'approval-id', 'lease-id', 'holder-id',
      'action-kind', 'action-id', 'sequence', 'fencing-epoch', 'rollback-upstream', 'rollback-release', 'rollback-manifest-digest',
      ...(Object.hasOwn(args, 'recover-pending') ? ['recover-pending'] : [])];
  exactKeys(args, allowed, 'ingress helper arguments');
  if (!readback && (args.execute !== 'true' || args.environment !== 'preprod')) {
    throw new ContractError('ingress helper execution is pinned to explicit preproduction mutation mode', EXIT.INGRESS);
  }
  if (!readback && args['recover-pending'] !== undefined && args['recover-pending'] !== 'true') {
    throw new ContractError('ingress pending recovery flag is invalid', EXIT.INGRESS);
  }
  if (args.project !== PREPROD_PROJECT || args.hostname !== PREPROD_HOSTNAME) {
    throw new ContractError('ingress helper is pinned to the booking-preprod hostname', EXIT.INGRESS);
  }
  if (readback) return { readback: true };
  if (!UPSTREAM.test(args.upstream || '')) throw new ContractError('ingress upstream is outside the preproduction slot allowlist', EXIT.INGRESS);
  if (!RELEASE_ID.test(args.release || '')) throw new ContractError('ingress release identity is invalid', EXIT.INGRESS);
  if (!DIGEST.test(args['manifest-digest'] || '')) throw new ContractError('ingress manifest digest is invalid', EXIT.INGRESS);
  if (!UPSTREAM.test(args['rollback-upstream'] || '')) throw new ContractError('ingress rollback upstream is outside the preproduction slot allowlist', EXIT.INGRESS);
  if (!RELEASE_ID.test(args['rollback-release'] || '')) throw new ContractError('ingress rollback release identity is invalid', EXIT.INGRESS);
  if (!DIGEST.test(args['rollback-manifest-digest'] || '')) throw new ContractError('ingress rollback manifest digest is invalid', EXIT.INGRESS);
  for (const key of ['operation-id', 'approval-id', 'lease-id', 'holder-id', 'action-id']) {
    if (!IDENTIFIER.test(args[key] || '')) throw new ContractError(`ingress ${key} is invalid`, EXIT.INGRESS);
  }
  if (!ACTION_KIND.has(args['action-kind'])) throw new ContractError('ingress action kind is invalid', EXIT.INGRESS);
  const sequence = Number(args.sequence);
  const expectedAction = sequence === 2 ? 'preprod-rollback-ingress' : 'preprod-switch-ingress';
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 3 || args['action-kind'] !== expectedAction) {
    throw new ContractError('ingress action kind and sequence are inconsistent', EXIT.INGRESS);
  }
  const fencingEpoch = Number(args['fencing-epoch']);
  if (!Number.isSafeInteger(fencingEpoch) || fencingEpoch < 1) throw new ContractError('ingress fencing epoch is invalid', EXIT.INGRESS);
  return { readback: false, fencingEpoch, sequence, recoverPending: args['recover-pending'] === 'true' };
}

async function assertTrustedPath(path, kind, runtime) {
  const metadata = await lstat(path).catch(() => { throw new ContractError(`${kind} is unavailable`, EXIT.INGRESS); });
  const canonical = await realpath(path).catch(() => { throw new ContractError(`${kind} cannot be resolved`, EXIT.INGRESS); });
  if (canonical !== resolve(path)) throw new ContractError(`${kind} must not be a symlink`, EXIT.INGRESS);
  if (kind.endsWith('directory') ? !metadata.isDirectory() : !metadata.isFile()) throw new ContractError(`${kind} has the wrong file type`, EXIT.INGRESS);
  if (!runtime.allowInsecureTestPaths && process.platform !== 'win32') {
    if (metadata.uid !== 0) throw new ContractError(`${kind} must be root-owned`, EXIT.INGRESS);
    const forbidden = ['token file', 'ingress proof file', 'archived ingress proof file', 'ingress state directory', 'ingress proof archive directory'].includes(kind) ? 0o077 : 0o022;
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
  if (result.config.ingress.length !== 2) {
    throw new ContractError('pinned preproduction tunnel must contain exactly the hostname rule and final 404 fallback', EXIT.INGRESS);
  }
  if (targetIndexes.length !== 1) throw new ContractError('pinned preproduction hostname must have exactly one ingress rule', EXIT.INGRESS);
  const targetIndex = targetIndexes[0];
  const targetRule = result.config.ingress[targetIndex];
  const fallbackIndex = result.config.ingress.length - 1;
  const fallbackRule = result.config.ingress[fallbackIndex];
  if (targetIndex !== 0 || Object.hasOwn(targetRule, 'path')) {
    throw new ContractError('pinned preproduction hostname must be the first pathless catch-all hostname rule', EXIT.INGRESS);
  }
  if (fallbackIndex <= targetIndex || Object.hasOwn(fallbackRule, 'hostname') || Object.hasOwn(fallbackRule, 'path') || fallbackRule.service !== 'http_status:404') {
    throw new ContractError('preproduction tunnel must end with the exact pathless 404 fallback', EXIT.INGRESS);
  }
  if (!/^http:\/\/gateway-(green|blue):8080$/.test(targetRule.service)) {
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
  exactKeys(value.guard, ['mode', 'atomicRemoteCas', 'opportunisticIfMatch', 'exclusiveWriteRequired'], 'local ingress proof guard');
  const expectedAction = value.sequence === 2 ? 'preprod-rollback-ingress' : 'preprod-switch-ingress';
  if (value.schema !== 'booking.cloudflare-ingress-proof/v2' || value.accountId !== CLOUDFLARE_ACCOUNT_ID ||
      value.tunnelId !== CLOUDFLARE_TUNNEL_ID || value.project !== PREPROD_PROJECT || value.hostname !== PREPROD_HOSTNAME ||
      !UPSTREAM.test(value.upstream) || value.remoteService !== `http://${value.upstream}` || !RELEASE_ID.test(value.releaseId) ||
      !DIGEST.test(value.manifestDigest) || !IDENTIFIER.test(value.operationId) ||
      ['approvalId', 'leaseId', 'holderId', 'actionId'].some((key) => !IDENTIFIER.test(value[key] || '')) ||
      !ACTION_KIND.has(value.actionKind) || value.actionKind !== expectedAction || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.sequence > 3 ||
      !Number.isSafeInteger(value.fencingEpoch) || value.fencingEpoch < 1 ||
      !UPSTREAM.test(value.rollbackUpstream) || !RELEASE_ID.test(value.rollbackReleaseId) || !DIGEST.test(value.rollbackManifestDigest) ||
      !Number.isSafeInteger(value.remoteVersion) || value.remoteVersion < 0 || !DIGEST.test(value.remoteConfigDigest) ||
      value.guard.mode !== 'double-read-version-and-digest' || value.guard.atomicRemoteCas !== false ||
      typeof value.guard.opportunisticIfMatch !== 'boolean' || value.guard.exclusiveWriteRequired !== true ||
      !Number.isFinite(Date.parse(value.writtenAt)) || (value.previousProofDigest !== null && !DIGEST.test(value.previousProofDigest)) ||
      !DIGEST.test(proofDigest) || sha256(body) !== proofDigest) {
    throw new ContractError('local ingress proof failed validation', EXIT.INGRESS);
  }
  return value;
}

function sameReleaseTarget(left, right) {
  return left.releaseId === right.releaseId && left.manifestDigest === right.manifestDigest && left.upstream === right.upstream;
}

function sameRollbackBinding(left, right) {
  return left.rollbackReleaseId === right.rollbackReleaseId && left.rollbackManifestDigest === right.rollbackManifestDigest &&
    left.rollbackUpstream === right.rollbackUpstream;
}

function findFirstPromotion(proofs, value) {
  return [...proofs.values()].find((item) => item.sequence === 1 && item.operationId === value.operationId &&
    sameRollbackBinding(item, value) && item.releaseId === value.releaseId && item.manifestDigest === value.manifestDigest &&
    item.upstream === value.upstream) || null;
}

function assertProofTransition(previous, current, proofs) {
  if (current.previousProofDigest !== previous.proofDigest || current.fencingEpoch < previous.fencingEpoch) {
    throw new ContractError('archived ingress proof chain is not monotonic', EXIT.INGRESS);
  }
  if (current.fencingEpoch > previous.fencingEpoch) {
    const sameOperation = current.operationId === previous.operationId;
    if (sameOperation) {
      const adopted = current.sequence === previous.sequence && sameReleaseTarget(current, previous);
      const continued = current.sequence === previous.sequence + 1;
      if (!sameRollbackBinding(current, previous) || current.approvalId === previous.approvalId || current.leaseId === previous.leaseId ||
          current.holderId === previous.holderId || current.actionId === previous.actionId || (!adopted && !continued) ||
          (adopted && (current.actionKind !== previous.actionKind || current.remoteVersion !== previous.remoteVersion ||
            current.remoteConfigDigest !== previous.remoteConfigDigest)) ||
          (continued && (current.remoteVersion <= previous.remoteVersion || current.remoteConfigDigest === previous.remoteConfigDigest))) {
        throw new ContractError('takeover ingress proof does not preserve the canonical operation sequence', EXIT.INGRESS);
      }
      if (current.sequence === 2 && (current.releaseId !== current.rollbackReleaseId || current.manifestDigest !== current.rollbackManifestDigest ||
          current.upstream !== current.rollbackUpstream)) throw new ContractError('takeover rollback target is invalid', EXIT.INGRESS);
      if (current.sequence === 3 && !findFirstPromotion(proofs, current)) {
        throw new ContractError('takeover re-promotion does not restore the first candidate', EXIT.INGRESS);
      }
      return;
    }
    if (current.remoteVersion <= previous.remoteVersion || current.remoteConfigDigest === previous.remoteConfigDigest ||
        previous.sequence !== 3 || current.sequence !== 1 || current.actionKind !== 'preprod-switch-ingress' ||
        current.rollbackReleaseId !== previous.releaseId || current.rollbackManifestDigest !== previous.manifestDigest || current.rollbackUpstream !== previous.upstream) {
      throw new ContractError('a new fencing epoch must follow a completed cycle and begin from the previously proven active release', EXIT.INGRESS);
    }
    return;
  }
  if (current.remoteVersion <= previous.remoteVersion || current.remoteConfigDigest === previous.remoteConfigDigest) {
    throw new ContractError('archived ingress proof chain is not monotonic', EXIT.INGRESS);
  }
  if (current.operationId !== previous.operationId || current.approvalId !== previous.approvalId || current.leaseId !== previous.leaseId ||
      current.holderId !== previous.holderId || current.actionId === previous.actionId || !sameRollbackBinding(current, previous) ||
      current.sequence !== previous.sequence + 1) {
    throw new ContractError('same-epoch ingress proof sequence binding is invalid', EXIT.INGRESS);
  }
  if (current.sequence === 2) {
    if (previous.sequence !== 1 || current.actionKind !== 'preprod-rollback-ingress' ||
        current.releaseId !== current.rollbackReleaseId || current.manifestDigest !== current.rollbackManifestDigest ||
        current.upstream !== current.rollbackUpstream || sameReleaseTarget(current, previous)) {
      throw new ContractError('rollback must follow and reverse a distinct first promotion', EXIT.INGRESS);
    }
    return;
  }
  if (current.sequence === 3) {
    const firstPromotion = findFirstPromotion(proofs, current);
    if (!firstPromotion || previous.sequence !== 2 ||
        current.actionKind !== 'preprod-switch-ingress' || current.actionId === firstPromotion.actionId ||
        !sameReleaseTarget(current, firstPromotion)) {
      throw new ContractError('re-promotion must exactly restore the first promotion target', EXIT.INGRESS);
    }
    return;
  }
  throw new ContractError('same-epoch ingress proof sequence cannot restart', EXIT.INGRESS);
}

async function readProofDocument(path, kind, runtime) {
  const before = await assertTrustedPath(path, kind, runtime);
  let handle;
  try {
    handle = await open(path, 'r');
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || !after.isFile() || after.size > MAX_PROOF_BYTES) {
      throw new ContractError(`${kind} identity or size is invalid`, EXIT.INGRESS);
    }
    return validateProof(JSON.parse(await handle.readFile('utf8')));
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError(`${kind} cannot be read`, EXIT.INGRESS);
  } finally { await handle?.close().catch(() => {}); }
}

async function loadProofChain(runtime, optional = false) {
  const proofFile = runtime.proofFile || PROOF_FILE;
  let head;
  try { head = await readProofDocument(proofFile, 'ingress proof file', runtime); }
  catch (error) {
    if (optional && error instanceof ContractError && error.message === 'ingress proof file is unavailable') head = null;
    else throw error;
  }
  const archiveDirectory = runtime.proofArchiveDirectory || PROOF_ARCHIVE_DIRECTORY;
  let names;
  try {
    await assertTrustedPath(archiveDirectory, 'ingress proof archive directory', runtime);
    names = await readdir(archiveDirectory);
  } catch (error) {
    if (optional && head === null && error instanceof ContractError && error.message === 'ingress proof archive directory is unavailable') {
      return { head: null, proofs: new Map() };
    }
    throw error;
  }
  const proofs = new Map();
  for (const name of names) {
    if (!/^[0-9]{12}-[1-3]-[0-9a-f]{12}\.json$/.test(name)) throw new ContractError('ingress proof archive contains an unexpected entry', EXIT.INGRESS);
    const proof = await readProofDocument(resolve(archiveDirectory, name), 'archived ingress proof file', runtime);
    const expectedName = `${String(proof.fencingEpoch).padStart(12, '0')}-${proof.sequence}-${proof.proofDigest.slice(7, 19)}.json`;
    if (name !== expectedName || proofs.has(proof.proofDigest)) throw new ContractError('ingress proof archive identity is ambiguous', EXIT.INGRESS);
    proofs.set(proof.proofDigest, proof);
  }
  if (head === null) {
    if (proofs.size !== 0) throw new ContractError('ingress proof head is missing while archive evidence remains', EXIT.INGRESS);
    return { head: null, proofs };
  }
  const archivedHead = proofs.get(head.proofDigest);
  if (!archivedHead || canonicalJson(archivedHead) !== canonicalJson(head)) throw new ContractError('ingress proof head is not present in its immutable archive', EXIT.INGRESS);
  const visited = new Set();
  let current = head;
  while (current) {
    if (visited.has(current.proofDigest)) throw new ContractError('ingress proof archive contains a cycle', EXIT.INGRESS);
    visited.add(current.proofDigest);
    if (current.previousProofDigest === null) {
      if (current.sequence !== 1 || current.actionKind !== 'preprod-switch-ingress') {
        throw new ContractError('ingress proof archive root must be a first promotion', EXIT.INGRESS);
      }
      break;
    }
    const previous = proofs.get(current.previousProofDigest);
    if (!previous) throw new ContractError('ingress proof archive predecessor is missing', EXIT.INGRESS);
    assertProofTransition(previous, current, proofs);
    current = previous;
  }
  if (visited.size !== proofs.size) throw new ContractError('ingress proof archive contains evidence outside the canonical chain', EXIT.INGRESS);
  return { head, proofs };
}

async function writeProof(runtime, body) {
  const proofFile = runtime.proofFile || PROOF_FILE;
  const directory = dirname(proofFile);
  await assertTrustedPath(directory, 'ingress state directory', runtime);
  const proof = validateProof({ ...body, proofDigest: sha256(body) });
  const archiveDirectory = runtime.proofArchiveDirectory || PROOF_ARCHIVE_DIRECTORY;
  await mkdir(archiveDirectory, { mode: 0o700 }).catch((error) => { if (error?.code !== 'EEXIST') throw error; });
  await assertTrustedPath(archiveDirectory, 'ingress proof archive directory', runtime);
  const archivePath = resolve(archiveDirectory, `${String(proof.fencingEpoch).padStart(12, '0')}-${proof.sequence}-${proof.proofDigest.slice(7, 19)}.json`);
  let archiveHandle;
  try {
    archiveHandle = await open(archivePath, 'wx', 0o600);
    await archiveHandle.writeFile(`${JSON.stringify(proof)}\n`, 'utf8');
    await archiveHandle.sync();
    await archiveHandle.close();
    archiveHandle = null;
    if (process.platform !== 'win32') {
      const archiveDirectoryHandle = await open(archiveDirectory, 'r');
      try { await archiveDirectoryHandle.sync(); } finally { await archiveDirectoryHandle.close(); }
    }
  } catch (error) {
    await archiveHandle?.close().catch(() => {});
    if (error?.code !== 'EEXIST') throw new ContractError('immutable ingress proof archive cannot be stored', EXIT.INGRESS);
    const existing = await readProofDocument(archivePath, 'archived ingress proof file', runtime);
    if (canonicalJson(existing) !== canonicalJson(proof)) throw new ContractError('immutable ingress proof archive collision', EXIT.INGRESS);
  }
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
    schema: 'booking.ingress-readback/v2',
    project: proof.project,
    hostname: proof.hostname,
    upstream: proof.upstream,
    releaseId: proof.releaseId,
    manifestDigest: proof.manifestDigest,
    operationId: proof.operationId,
    approvalId: proof.approvalId,
    leaseId: proof.leaseId,
    holderId: proof.holderId,
    actionKind: proof.actionKind,
    actionId: proof.actionId,
    sequence: proof.sequence,
    fencingEpoch: proof.fencingEpoch,
    rollbackUpstream: proof.rollbackUpstream,
    rollbackReleaseId: proof.rollbackReleaseId,
    rollbackManifestDigest: proof.rollbackManifestDigest,
    proofDigest: proof.proofDigest,
    remoteVersion: proof.remoteVersion,
    remoteConfigDigest: proof.remoteConfigDigest,
    guard: structuredClone(proof.guard),
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
    const { head: proof } = await loadProofChain(runtime);
    const token = await loadToken(runtime);
    return verifyRemoteAgainstProof(proof, token, runtime);
  });
}

function proofMatchesRequest(proof, args, fencingEpoch, sequence) {
  return proof.fencingEpoch === fencingEpoch && proof.sequence === sequence && proof.operationId === args['operation-id'] &&
    proof.approvalId === args['approval-id'] && proof.leaseId === args['lease-id'] && proof.holderId === args['holder-id'] &&
    proof.actionKind === args['action-kind'] && proof.actionId === args['action-id'] &&
    proof.releaseId === args.release && proof.manifestDigest === args['manifest-digest'] && proof.upstream === args.upstream &&
    proof.rollbackReleaseId === args['rollback-release'] && proof.rollbackManifestDigest === args['rollback-manifest-digest'] &&
    proof.rollbackUpstream === args['rollback-upstream'];
}

function assertRequestedCycleTarget(args, sequence) {
  const targetIsRollback = args.release === args['rollback-release'] && args['manifest-digest'] === args['rollback-manifest-digest'] &&
    args.upstream === args['rollback-upstream'];
  if ((sequence === 2) !== targetIsRollback) {
    throw new ContractError(sequence === 2 ? 'rollback target does not match the cycle baseline' : 'candidate target must differ from the cycle baseline', EXIT.INGRESS);
  }
}

function assertNextRequest(chain, args, fencingEpoch, sequence) {
  const prior = chain.head;
  assertRequestedCycleTarget(args, sequence);
  if (!prior) {
    if (sequence !== 1) throw new ContractError('the first ingress proof must begin at sequence one', EXIT.INGRESS);
    return args['rollback-upstream'];
  }
  if (prior.fencingEpoch > fencingEpoch) throw new ContractError('ingress fencing epoch is stale', EXIT.INGRESS);
  if (prior.fencingEpoch < fencingEpoch) {
    if (prior.operationId === args['operation-id']) {
      const adopted = sequence === prior.sequence && prior.releaseId === args.release && prior.manifestDigest === args['manifest-digest'] && prior.upstream === args.upstream &&
        prior.actionKind === args['action-kind'];
      const continued = sequence === prior.sequence + 1;
      if (prior.approvalId === args['approval-id'] || prior.leaseId === args['lease-id'] || prior.holderId === args['holder-id'] ||
          prior.actionId === args['action-id'] || prior.rollbackReleaseId !== args['rollback-release'] ||
          prior.rollbackManifestDigest !== args['rollback-manifest-digest'] || prior.rollbackUpstream !== args['rollback-upstream'] || (!adopted && !continued)) {
        throw new ContractError('takeover ingress action is outside the canonical operation sequence', EXIT.INGRESS);
      }
      if (sequence === 3) {
        const firstPromotion = findFirstPromotion(chain.proofs, { operationId: args['operation-id'], rollbackReleaseId: args['rollback-release'],
          rollbackManifestDigest: args['rollback-manifest-digest'], rollbackUpstream: args['rollback-upstream'], releaseId: args.release,
          manifestDigest: args['manifest-digest'], upstream: args.upstream });
        if (!firstPromotion) throw new ContractError('takeover second promotion does not restore the first candidate', EXIT.INGRESS);
      }
      return prior.upstream;
    }
    if (prior.sequence !== 3 || sequence !== 1 || prior.releaseId !== args['rollback-release'] || prior.manifestDigest !== args['rollback-manifest-digest'] || prior.upstream !== args['rollback-upstream']) {
      throw new ContractError('a new ingress fencing epoch must follow a completed cycle and start from the previously proven active release', EXIT.INGRESS);
    }
    return prior.upstream;
  }
  if (sequence !== prior.sequence + 1 || prior.operationId !== args['operation-id'] || prior.approvalId !== args['approval-id'] ||
      prior.leaseId !== args['lease-id'] || prior.holderId !== args['holder-id'] || prior.actionId === args['action-id'] ||
      prior.rollbackReleaseId !== args['rollback-release'] || prior.rollbackManifestDigest !== args['rollback-manifest-digest'] ||
      prior.rollbackUpstream !== args['rollback-upstream']) {
    throw new ContractError('same-epoch ingress action is outside the canonical operation sequence', EXIT.INGRESS);
  }
  if (sequence === 3) {
    const firstPromotion = findFirstPromotion(chain.proofs, { operationId: args['operation-id'], rollbackReleaseId: args['rollback-release'],
      rollbackManifestDigest: args['rollback-manifest-digest'], rollbackUpstream: args['rollback-upstream'], releaseId: args.release,
      manifestDigest: args['manifest-digest'], upstream: args.upstream });
    if (!firstPromotion || firstPromotion.sequence !== 1 || firstPromotion.releaseId !== args.release ||
        firstPromotion.manifestDigest !== args['manifest-digest'] || firstPromotion.upstream !== args.upstream ||
        firstPromotion.actionId === args['action-id']) {
      throw new ContractError('second promotion does not exactly restore the first candidate', EXIT.INGRESS);
    }
  }
  return prior.upstream;
}

async function executeMutation(args, fencingEpoch, sequence, runtime, recoverPending = false) {
  return withLocalLock(runtime, async () => {
    const chain = await loadProofChain(runtime, true);
    const priorProof = chain.head;
    if (priorProof?.fencingEpoch > fencingEpoch) throw new ContractError('ingress fencing epoch is stale', EXIT.INGRESS);
    if (priorProof && proofMatchesRequest(priorProof, args, fencingEpoch, sequence)) {
      const token = await loadToken(runtime);
      return verifyRemoteAgainstProof(priorProof, token, runtime);
    }
    const expectedCurrentUpstream = assertNextRequest(chain, args, fencingEpoch, sequence);
    const token = await loadToken(runtime);

    const first = await cloudflareRequest('GET', token, runtime);
    const second = await cloudflareRequest('GET', token, runtime);
    assertSameSnapshot(first, second);
    const currentService = second.snapshot.config.ingress[second.snapshot.targetIndex].service;
    const desired = desiredConfiguration(second.snapshot, args.upstream);
    if (recoverPending && currentService === `http://${args.upstream}` && second.snapshot.configDigest === sha256(desired)) {
      if (priorProof && (second.snapshot.version <= priorProof.remoteVersion || second.snapshot.configDigest === priorProof.remoteConfigDigest)) {
        throw new ContractError('recovered Cloudflare state is not newer than the proven predecessor', EXIT.INGRESS);
      }
      const writtenAt = trustedNow(runtime);
      const body = {
        schema: 'booking.cloudflare-ingress-proof/v2', accountId: CLOUDFLARE_ACCOUNT_ID, tunnelId: CLOUDFLARE_TUNNEL_ID,
        project: PREPROD_PROJECT, hostname: PREPROD_HOSTNAME, upstream: args.upstream, remoteService: `http://${args.upstream}`,
        releaseId: args.release, manifestDigest: args['manifest-digest'], operationId: args['operation-id'], approvalId: args['approval-id'],
        leaseId: args['lease-id'], holderId: args['holder-id'], actionKind: args['action-kind'], actionId: args['action-id'], sequence, fencingEpoch,
        rollbackUpstream: args['rollback-upstream'], rollbackReleaseId: args['rollback-release'],
        rollbackManifestDigest: args['rollback-manifest-digest'], remoteVersion: second.snapshot.version,
        remoteConfigDigest: second.snapshot.configDigest,
        guard: { mode: 'double-read-version-and-digest', atomicRemoteCas: false, opportunisticIfMatch: Boolean(second.etag), exclusiveWriteRequired: true },
        writtenAt: writtenAt.toISOString(), previousProofDigest: priorProof?.proofDigest || null,
      };
      const prospectiveProof = validateProof({ ...body, proofDigest: sha256(body) });
      if (priorProof) assertProofTransition(priorProof, prospectiveProof, chain.proofs);
      const proof = await writeProof(runtime, body);
      return readbackObject(proof, writtenAt.toISOString());
    }
    if (recoverPending && currentService === `http://${expectedCurrentUpstream}`) {
      return {
        schema: 'booking.ingress-pending-recovery/v1', outcome: 'not-applied', project: PREPROD_PROJECT,
        hostname: PREPROD_HOSTNAME, operationId: args['operation-id'], actionKind: args['action-kind'],
        actionId: args['action-id'], sequence, fencingEpoch, expectedPreviousUpstream: expectedCurrentUpstream,
        remoteVersion: second.snapshot.version, remoteConfigDigest: second.snapshot.configDigest,
        previousProofDigest: priorProof?.proofDigest || null,
        guard: { mode: 'double-read-version-and-digest', atomicRemoteCas: false,
          opportunisticIfMatch: Boolean(second.etag), exclusiveWriteRequired: true },
        observedAt: trustedNow(runtime).toISOString(),
      };
    }
    if (currentService !== `http://${expectedCurrentUpstream}`) {
      throw new ContractError('remote Cloudflare ingress does not match the proven previous cycle target', EXIT.INGRESS);
    }
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
    const body = {
      schema: 'booking.cloudflare-ingress-proof/v2', accountId: CLOUDFLARE_ACCOUNT_ID, tunnelId: CLOUDFLARE_TUNNEL_ID,
      project: PREPROD_PROJECT, hostname: PREPROD_HOSTNAME, upstream: args.upstream, remoteService: `http://${args.upstream}`,
      releaseId: args.release, manifestDigest: args['manifest-digest'], operationId: args['operation-id'], approvalId: args['approval-id'],
      leaseId: args['lease-id'], holderId: args['holder-id'], actionKind: args['action-kind'], actionId: args['action-id'], sequence, fencingEpoch,
      rollbackUpstream: args['rollback-upstream'], rollbackReleaseId: args['rollback-release'],
      rollbackManifestDigest: args['rollback-manifest-digest'],
      remoteVersion: post.snapshot.version, remoteConfigDigest: post.snapshot.configDigest,
      guard: { mode: 'double-read-version-and-digest', atomicRemoteCas: false, opportunisticIfMatch: Boolean(second.etag), exclusiveWriteRequired: true },
      writtenAt: writtenAt.toISOString(), previousProofDigest: priorProof?.proofDigest || null,
    };
    const prospectiveProof = validateProof({ ...body, proofDigest: sha256(body) });
    if (priorProof) assertProofTransition(priorProof, prospectiveProof, chain.proofs);
    const proof = await writeProof(runtime, body);
    return readbackObject(proof, writtenAt.toISOString());
  });
}

export async function runIngressHelper(argv, runtime = {}) {
  const args = parseCliArgs(argv);
  const scope = validateScope(args);
  return scope.readback ? executeReadback(runtime) : executeMutation(args, scope.fencingEpoch, scope.sequence, runtime, scope.recoverPending);
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
