#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chmod, mkdir, open, lstat, readFile, readdir, realpath, rename, rm, unlink } from 'node:fs/promises';

const EXIT = Object.freeze({ INGRESS: 60 });
export class ContractError extends Error {
  constructor(message, exitCode = EXIT.INGRESS) { super(message); this.name = 'ContractError'; this.exitCode = exitCode; }
}

export const CLOUDFLARE_ACCOUNT_ID = 'a29dfe7707f6e6cec070a6fafd7c90d3';
export const CLOUDFLARE_TUNNEL_ID = '008210c0-6e25-4726-8976-03b6d77d39e2';
export const PREPROD_PROJECT = 'booking-preprod';
export const PREPROD_HOSTNAME = 'booking-preprod.happybooking.uk';
export const EDGE_NETWORK = 'booking-preprod-edge';
export const LOGICAL_ALIAS = 'gateway-green';
export const FIXED_REMOTE_SERVICE = 'http://gateway-green:8080';
export const PROOF_FILE = '/var/lib/happybooking/ingress/booking-preprod-proof.json';
export const PROOF_ARCHIVE_DIRECTORY = '/var/lib/happybooking/ingress/booking-preprod-proofs';
export const PENDING_FILE = '/var/lib/happybooking/ingress/booking-preprod-pending.json';
export const LOCK_FILE = '/var/lib/happybooking/ingress/booking-preprod.lock';
const LOCK_OWNER_CONTAINER = 'booking-preprod-control-plane';

const DOCKER = '/var/packages/ContainerManager/target/usr/bin/docker';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CONTAINER_ID = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RELEASE_ID = /^booking-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/;
const UPSTREAM = /^gateway-(green|blue):8080$/;
const ACTIONS = new Set(['preprod-switch-ingress', 'preprod-rollback-ingress']);
const LEGACY = Object.freeze({ releaseId: 'booking-20260908T202714Z-317be4dec675',
  backendContainerId: '50dbe86316e2bdfe2b84727fe7407ef435eec3c91f3c764d605c7fc8a552d4fb',
  containerId: 'eb38bbd0b092d1cdc8c30e62faa400421d0764f5fc5f3997e3986f3a7b10800d',
  imageId: 'sha256:0a26e5415496cd1227d80833fa2a4bae5fdb41d558119ed2ec5d6df0b0fd5593',
  image: 'booking-preprod-gateway:booking-20260908T202714Z-317be4dec675',
  configHash: '67ca960d4f4dc4266ea8b003e22e26545a8f0418d3bad6e83a76be6bece8791e' });
const CLOUDFLARED = Object.freeze({ name: 'booking-preprod-cloudflared',
  imageId: 'sha256:c1d35f78a5f68601e349d12fed690bc5cb3a0d64d0d25dd7297d415aa399c179',
  image: 'cloudflare/cloudflared@sha256:6b599ca3e974349ead3286d178da61d291961182ec3fe9c505e1dd02c8ac31b0', user: '65532:65532',
  entrypoint: ['cloudflared', '--no-autoupdate'], cmd: ['tunnel', '--no-autoupdate', 'run', '--token-file', '/run/secrets/tunnel-token'],
  mount: { type: 'bind', source: '/etc/happybooking/secrets/cloudflare-preprod-tunnel-token', destination: '/run/secrets/tunnel-token', rw: false, propagation: 'rprivate' } });

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return `sha256:${createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex')}`; }
function exactSet(actual, expected) { return Array.isArray(actual) && canonicalJson([...actual].sort()) === canonicalJson([...expected].sort()); }
function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exactSet(Object.keys(value), expected)) throw new ContractError(`${label} has an invalid shape`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) throw new ContractError('unexpected ingress helper argument');
    const key = argv[i].slice(2);
    if (Object.hasOwn(args, key)) throw new ContractError(`duplicate ingress helper argument: --${key}`);
    if (key === 'readback' || key === 'recover-stale-lock') { args[key] = true; continue; }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new ContractError(`missing value for --${key}`);
    args[key] = value;
  }
  return args;
}

function validateArgs(args) {
  const readback = args.readback === true;
  const staleLockRecovery = args['recover-stale-lock'] === true;
  const allowed = staleLockRecovery ? ['recover-stale-lock', 'lock-digest', 'project', 'hostname'] : readback ? ['readback', 'project', 'hostname'] : ['execute', 'environment', 'project', 'hostname', 'upstream', 'release', 'manifest-digest',
    'operation-id', 'approval-id', 'lease-id', 'holder-id', 'action-kind', 'action-id', 'sequence', 'fencing-epoch', 'rollback-upstream', 'rollback-release',
    'rollback-manifest-digest', 'source-container-id', 'source-backend-container-id', 'source-image-id', 'source-config-image', 'source-config-hash',
    'target-container-id', 'target-backend-container-id', 'target-image-id', 'target-config-image', 'target-config-hash',
    ...(Object.hasOwn(args, 'recover-pending') ? ['recover-pending'] : [])];
  exactKeys(args, allowed, 'ingress helper arguments');
  if (args.project !== PREPROD_PROJECT || args.hostname !== PREPROD_HOSTNAME) throw new ContractError('ingress helper is pinned to booking-preprod');
  if (staleLockRecovery) {
    if (!DIGEST.test(args['lock-digest'] || '')) throw new ContractError('stale ingress lock digest is invalid');
    return { staleLockRecovery, lockDigest: args['lock-digest'] };
  }
  if (readback) return { readback };
  if (args.execute !== 'true' || args.environment !== 'preprod') throw new ContractError('ingress helper requires explicit preproduction mutation mode');
  if (args['recover-pending'] !== undefined && args['recover-pending'] !== 'true') throw new ContractError('invalid pending recovery flag');
  if (!UPSTREAM.test(args.upstream || '') || !UPSTREAM.test(args['rollback-upstream'] || '')) throw new ContractError('ingress slot is invalid');
  if (!RELEASE_ID.test(args.release || '') || !RELEASE_ID.test(args['rollback-release'] || '') || !DIGEST.test(args['manifest-digest'] || '') || !DIGEST.test(args['rollback-manifest-digest'] || '')) throw new ContractError('ingress release identity is invalid');
  for (const key of ['source-container-id', 'source-backend-container-id', 'target-container-id', 'target-backend-container-id']) {
    if (!CONTAINER_ID.test(args[key] || '')) throw new ContractError(`ingress ${key} is invalid`);
  }
  for (const key of ['source-image-id', 'target-image-id']) if (!DIGEST.test(args[key] || '')) throw new ContractError(`ingress ${key} is invalid`);
  for (const key of ['source-config-hash', 'target-config-hash']) if (!/^[0-9a-f]{64}$/.test(args[key] || '')) throw new ContractError(`ingress ${key} is invalid`);
  for (const key of ['source-config-image', 'target-config-image']) if (typeof args[key] !== 'string' || !args[key].includes(':') || /[\s\0]/.test(args[key])) throw new ContractError(`ingress ${key} is invalid`);
  for (const key of ['operation-id', 'approval-id', 'lease-id', 'holder-id', 'action-id']) if (!ID.test(args[key] || '')) throw new ContractError(`ingress ${key} is invalid`);
  const sequence = Number(args.sequence); const fencingEpoch = Number(args['fencing-epoch']);
  const expectedAction = sequence === 2 ? 'preprod-rollback-ingress' : 'preprod-switch-ingress';
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 3 || !ACTIONS.has(args['action-kind']) || args['action-kind'] !== expectedAction) throw new ContractError('ingress action and sequence are inconsistent');
  if (!Number.isSafeInteger(fencingEpoch) || fencingEpoch < 1) throw new ContractError('ingress fencing epoch is invalid');
  return { readback, sequence, fencingEpoch, recoverPending: args['recover-pending'] === 'true' };
}

async function trustedPath(path, kind, runtime, optional = false) {
  const metadata = await lstat(path).catch((error) => { if (optional && error?.code === 'ENOENT') return null; throw new ContractError(`${kind} is unavailable`); });
  if (!metadata) return null;
  const canonical = await realpath(path).catch(() => { throw new ContractError(`${kind} cannot be resolved`); });
  if (canonical !== resolve(path) || (kind.endsWith('directory') ? !metadata.isDirectory() : !metadata.isFile())) throw new ContractError(`${kind} identity is invalid`);
  if (!runtime.allowInsecureTestPaths && process.platform !== 'win32' && (metadata.uid !== 0 || (metadata.mode & (kind.includes('directory') ? 0o022 : 0o077)) !== 0)) throw new ContractError(`${kind} permissions are unsafe`);
  return metadata;
}
async function readJson(path, kind, runtime, optional = false) {
  const before = await trustedPath(path, kind, runtime, optional); if (!before) return null;
  let handle;
  try { handle = await open(path, 'r'); const after = await handle.stat(); if (before.dev !== after.dev || before.ino !== after.ino || after.size > 65536) throw new Error(); return JSON.parse(await handle.readFile('utf8')); }
  catch { throw new ContractError(`${kind} cannot be read safely`); } finally { await handle?.close().catch(() => {}); }
}
async function atomicWrite(path, value, runtime) {
  await trustedPath(dirname(path), 'ingress state directory', runtime); const temp = `${path}.new-${process.pid}`; let handle;
  try { handle = await open(temp, 'wx', 0o600); await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); await handle.close(); handle = null; await rename(temp, path); }
  catch { await handle?.close().catch(() => {}); await unlink(temp).catch(() => {}); throw new ContractError('local ingress state cannot be stored atomically'); }
}
async function syncDirectory(path, runtime) {
  if (runtime.syncDirectory) return runtime.syncDirectory(path);
  if (process.platform === 'win32' && runtime.allowInsecureTestPaths) return;
  const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); }
}
async function lockCheckpoint(runtime, name) { if (runtime.lockCheckpoint) await runtime.lockCheckpoint(name); }

async function docker(argv, runtime) {
  if (runtime.runDocker) return runtime.runDocker(argv);
  return new Promise((fulfill, reject) => {
    const child = spawn(DOCKER, argv, { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin' } }); let out = ''; let err = '';
    child.stdout.on('data', (b) => { out += b; if (out.length > 1048576) child.kill(); }); child.stderr.on('data', (b) => { err += b; if (err.length > 65536) child.kill(); });
    child.on('error', reject); child.on('close', (code) => code === 0 ? fulfill(out) : reject(new ContractError(`Docker ingress operation failed (${code}): ${err.trim().slice(0, 240)}`)));
  });
}
const INSPECT = '{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},"ConfigImage":{{json .Config.Image}},"User":{{json .Config.User}},"Entrypoint":{{json .Config.Entrypoint}},"Cmd":{{json .Config.Cmd}},"Labels":{{json .Config.Labels}},"Running":{{json .State.Running}},"Health":{{json .State.Health}},"StartedAt":{{json .State.StartedAt}},"ReadonlyRootfs":{{json .HostConfig.ReadonlyRootfs}},"Privileged":{{json .HostConfig.Privileged}},"CapAdd":{{json .HostConfig.CapAdd}},"CapDrop":{{json .HostConfig.CapDrop}},"SecurityOpt":{{json .HostConfig.SecurityOpt}},"PortBindings":{{json .HostConfig.PortBindings}},"Mounts":{{json .Mounts}},"Networks":{{json .NetworkSettings.Networks}}}';
async function inspect(name, runtime) {
  try { return JSON.parse((await docker(['container', 'inspect', '--format', INSPECT, name], runtime)).trim()); }
  catch (error) { if (error instanceof ContractError) throw error; throw new ContractError('container inspect readback is malformed'); }
}
function slot(upstream) { return /^gateway-(green|blue):8080$/.exec(upstream)?.[1]; }
function name(s) { return `${PREPROD_PROJECT}-gateway-${s}-1`; }
function service(s) { return `gateway-${s}`; }
function baseAliases(s) { return s === 'blue' ? ['gateway-blue'] : []; }
function aliases(container) { return [...(container.Networks?.[EDGE_NETWORK]?.Aliases || [])]; }
function occurrences(values, item) { return values.filter((value) => value === item).length; }
function assertEngineAliases(value, kind, s = null) {
  const values = aliases(value); const shortId = value.Id.slice(0, 12); const serviceAlias = s ? `${kind}-${s}` : null;
  const containerNameAlias = value.Name.slice(1);
  const allowed = new Set([shortId, containerNameAlias, ...(serviceAlias ? [serviceAlias] : []), ...(kind === 'gateway' ? [LOGICAL_ALIAS] : [])]);
  if (values.some((item) => typeof item !== 'string' || !allowed.has(item)) || occurrences(values, shortId) > 1 ||
      occurrences(values, containerNameAlias) > 1 ||
      (serviceAlias && occurrences(values, serviceAlias) > 2) || (kind !== 'gateway' && occurrences(values, LOGICAL_ALIAS) !== 0) ||
      (kind === 'gateway' && s === 'blue' && occurrences(values, LOGICAL_ALIAS) > 1)) {
    throw new ContractError(`${serviceAlias || kind} has foreign or impossible engine aliases`);
  }
  return { values, logicalCount: occurrences(values, LOGICAL_ALIAS) };
}
function expectedBinding(args, prefix, s, release) {
  return { slot: s, release, containerId: args[`${prefix}-container-id`], backendContainerId: args[`${prefix}-backend-container-id`],
    imageId: args[`${prefix}-image-id`], configImage: args[`${prefix}-config-image`], configHash: args[`${prefix}-config-hash`] };
}
function verifyGateway(value, binding, allowDetached = false) {
  const s = binding.slot; const release = binding.release; const labels = value?.Labels;
  const networks = value?.Networks && typeof value.Networks === 'object' ? Object.keys(value.Networks) : [];
  if (!value || value.Id !== binding.containerId || value.Name !== `/${name(s)}` || value.Image !== binding.imageId || value.ConfigImage !== binding.configImage ||
      value.Running !== true || value.Health?.Status !== 'healthy' || value.User !== '101' || value.ReadonlyRootfs !== true || value.Privileged !== false || !exactSet(value.CapDrop, ['ALL']) ||
      !exactSet(value.CapAdd, ['NET_BIND_SERVICE']) || !exactSet(value.SecurityOpt, ['no-new-privileges:true']) || Object.keys(value.PortBindings || {}).length !== 1 ||
      labels?.['com.docker.compose.project'] !== PREPROD_PROJECT || labels?.['com.docker.compose.service'] !== service(s) || labels?.['com.docker.compose.config-hash'] !== binding.configHash ||
      (release !== LEGACY.releaseId && labels?.['uk.happybooking.release-id'] !== release) ||
      (!allowDetached && !exactSet(networks, [EDGE_NETWORK])) || (allowDetached && (networks.length > 1 || (networks.length === 1 && networks[0] !== EDGE_NETWORK)))) throw new ContractError(`gateway-${s} exact identity, image, labels, health, or isolation drifted`);
  if (networks.length === 1) assertEngineAliases(value, 'gateway', s);
  return value;
}
function verifyBackend(value, binding) {
  const s = binding.slot; const expectedId = binding.backendContainerId;
  const labels = value?.Labels; const networks = value?.Networks && typeof value.Networks === 'object' ? Object.keys(value.Networks) : [];
  const expectedNetworks = binding.release === LEGACY.releaseId ? [EDGE_NETWORK, 'booking-preprod-data'] : [EDGE_NETWORK, 'booking-preprod-data', 'booking-preprod-telegram'];
  if (!value || value.Id !== expectedId || value.Name !== `/${PREPROD_PROJECT}-backend-${s}-1` || value.Running !== true ||
      labels?.['com.docker.compose.project'] !== PREPROD_PROJECT || labels?.['com.docker.compose.service'] !== `backend-${s}` ||
      !exactSet(networks, expectedNetworks)) throw new ContractError(`backend-${s} exact endpoint identity drifted`);
  assertEngineAliases(value, 'backend', s);
  return value;
}
function verifyCloudflared(value, { startedAfter = null, allowStopped = false } = {}) {
  const mounts = (value?.Mounts || []).map((m) => ({ type: m.Type, source: m.Source || '', destination: m.Destination, rw: m.RW, propagation: m.Propagation || '' }));
  const networks = value?.Networks && typeof value.Networks === 'object' ? Object.keys(value.Networks) : [];
  if (!value || !CONTAINER_ID.test(value.Id || '') || value.Name !== `/${CLOUDFLARED.name}` || value.Image !== CLOUDFLARED.imageId || value.ConfigImage !== CLOUDFLARED.image || value.User !== CLOUDFLARED.user ||
      (value.Labels !== null && (!value.Labels || typeof value.Labels !== 'object' || Object.keys(value.Labels).length !== 0)) ||
      canonicalJson(value.Entrypoint) !== canonicalJson(CLOUDFLARED.entrypoint) || canonicalJson(value.Cmd) !== canonicalJson(CLOUDFLARED.cmd) || (!allowStopped && value.Running !== true) || typeof value.Running !== 'boolean' || value.ReadonlyRootfs !== true || value.Privileged !== false ||
      !exactSet(value.CapDrop, ['ALL']) || !exactSet(value.SecurityOpt, ['no-new-privileges:true']) || Object.keys(value.PortBindings || {}).length !== 0 || canonicalJson(mounts) !== canonicalJson([CLOUDFLARED.mount]) ||
      !exactSet(networks, [EDGE_NETWORK]) || !Number.isFinite(Date.parse(value.StartedAt)) || (startedAfter && Date.parse(value.StartedAt) <= Date.parse(startedAfter))) throw new ContractError('exact cloudflared token-file, hardening, edge-only, no-ports, or restart readback drifted');
  assertEngineAliases(value, 'cloudflared');
  return value;
}
async function topology(sourceBinding, targetBinding, runtime, pending = null) {
  const expected = [sourceBinding, targetBinding];
  const inspected = await Promise.all([
    inspect(sourceBinding.containerId, runtime), inspect(targetBinding.containerId, runtime),
    inspect(sourceBinding.backendContainerId, runtime), inspect(targetBinding.backendContainerId, runtime), inspect(CLOUDFLARED.name, runtime),
  ]);
  const [source, target, sourceBackend, targetBackend, cloudflared] = inspected;
  verifyGateway(source, sourceBinding, Boolean(pending)); verifyGateway(target, targetBinding, Boolean(pending));
  verifyBackend(sourceBackend, sourceBinding); verifyBackend(targetBackend, targetBinding);
  if (new Set(inspected.map((item) => item.Id)).size !== inspected.length) throw new ContractError('ingress container identities collide');
  let members;
  try { members = JSON.parse((await docker(['network', 'inspect', '--format', '{{json .Containers}}', EDGE_NETWORK], runtime)).trim()); }
  catch { throw new ContractError('edge network membership readback is malformed'); }
  if (!members || typeof members !== 'object' || Array.isArray(members)) throw new ContractError('edge network membership readback is invalid');
  const allowed = new Map(inspected.map((item) => [item.Id, item.Name.slice(1)]));
  for (const [containerId, endpoint] of Object.entries(members)) {
    if (!CONTAINER_ID.test(containerId) || !allowed.has(containerId) || endpoint?.Name !== allowed.get(containerId)) throw new ContractError('foreign edge network member requires freeze');
  }
  const gatewayAliasOwners = [];
  for (const container of inspected) {
    const attached = Boolean(container.Networks?.[EDGE_NETWORK]);
    const listed = Object.hasOwn(members, container.Id);
    const stoppedCloudflaredGap = container.Id === cloudflared.Id && container.Running === false && pending && attached && !listed;
    if ((!stoppedCloudflaredGap && attached !== listed) || (listed && members[container.Id]?.Name !== container.Name.slice(1))) {
      throw new ContractError('edge network endpoint identity drifted');
    }
    if (attached && occurrences(aliases(container), LOGICAL_ALIAS) > 0) gatewayAliasOwners.push(container.Id);
  }
  if (gatewayAliasOwners.some((id) => id !== source.Id && id !== target.Id) || gatewayAliasOwners.length > 1) throw new ContractError('logical alias has multiple or foreign holders');
  const state = gatewayAliasOwners.length === 0 ? 'in-flight' : gatewayAliasOwners[0] === target.Id ? 'desired' : 'previous';
  verifyCloudflared(cloudflared, { allowStopped: Boolean(pending && state === 'desired') });
  if (cloudflared.Running === false && !(pending && state === 'desired')) throw new ContractError('stopped cloudflared is allowed only for exact pending desired recovery');
  return { source, target, sourceBackend, targetBackend, cloudflared, state, expected };
}

function proofBodyValid(value) {
  const keys = ['schema', 'project', 'hostname', 'edgeNetwork', 'logicalAlias', 'fixedRemoteService', 'aliasState', 'releaseId', 'manifestDigest', 'upstream', 'operationId', 'approvalId', 'leaseId', 'holderId', 'actionKind', 'actionId', 'sequence', 'fencingEpoch', 'rollbackUpstream', 'rollbackReleaseId', 'rollbackManifestDigest', 'sourceReleaseId', 'sourceManifestDigest', 'sourceUpstream', 'sourceContainerId', 'sourceBackendContainerId', 'sourceImageId', 'sourceConfigImage', 'sourceConfigHash', 'targetContainerId', 'targetBackendContainerId', 'targetImageId', 'targetConfigImage', 'targetConfigHash', 'cloudflaredContainerId', 'cloudflaredImageId', 'cloudflaredStartedAt', 'guard', 'writtenAt', 'previousProofDigest', 'proofDigest'];
  exactKeys(value, keys, 'local ingress proof'); const { proofDigest, ...body } = value;
  if (value.schema !== 'booking.local-ingress-proof/v3' || value.project !== PREPROD_PROJECT || value.hostname !== PREPROD_HOSTNAME || value.edgeNetwork !== EDGE_NETWORK || value.logicalAlias !== LOGICAL_ALIAS || value.fixedRemoteService !== FIXED_REMOTE_SERVICE || value.aliasState !== 'desired' ||
      !UPSTREAM.test(value.upstream) || !UPSTREAM.test(value.sourceUpstream) || !RELEASE_ID.test(value.releaseId) || !RELEASE_ID.test(value.sourceReleaseId) || !DIGEST.test(value.manifestDigest) || !DIGEST.test(value.sourceManifestDigest) || !CONTAINER_ID.test(value.sourceContainerId) || !CONTAINER_ID.test(value.sourceBackendContainerId) || !CONTAINER_ID.test(value.targetContainerId) || !CONTAINER_ID.test(value.targetBackendContainerId) || !DIGEST.test(value.sourceImageId) || !DIGEST.test(value.targetImageId) || !/^[0-9a-f]{64}$/.test(value.sourceConfigHash || '') || !/^[0-9a-f]{64}$/.test(value.targetConfigHash || '') || typeof value.sourceConfigImage !== 'string' || typeof value.targetConfigImage !== 'string' || !CONTAINER_ID.test(value.cloudflaredContainerId) || !DIGEST.test(value.cloudflaredImageId) ||
      value.guard?.mode !== 'local-docker-network-alias' || value.guard?.convergence !== 'previous-desired-in-flight-readback' || !exactSet(value.guard?.fencedResources, ['ingress:booking-preprod', EDGE_NETWORK]) || value.guard?.exactIdMutation !== true || value.guard?.cloudflareMutationAllowed !== false || value.guard?.publicProbeRequired !== true ||
      !Number.isFinite(Date.parse(value.cloudflaredStartedAt)) || !Number.isFinite(Date.parse(value.writtenAt)) || (value.previousProofDigest !== null && !DIGEST.test(value.previousProofDigest)) || !DIGEST.test(proofDigest) || sha256(body) !== proofDigest) throw new ContractError('local ingress proof failed validation');
  return value;
}
async function loadProof(runtime) { const value = await readJson(runtime.proofFile || PROOF_FILE, 'ingress proof file', runtime, true); return value ? proofBodyValid(value) : null; }
async function storeProof(runtime, body) {
  const proof = proofBodyValid({ ...body, proofDigest: sha256(body) }); const directory = runtime.proofArchiveDirectory || PROOF_ARCHIVE_DIRECTORY;
  await mkdir(directory, { mode: 0o700 }).catch((e) => { if (e?.code !== 'EEXIST') throw e; }); await trustedPath(directory, 'ingress proof archive directory', runtime);
  const path = resolve(directory, `${String(proof.fencingEpoch).padStart(12, '0')}-${proof.sequence}-${proof.proofDigest.slice(7, 19)}.json`);
  const existing = await readJson(path, 'archived ingress proof file', runtime, true); if (existing && canonicalJson(existing) !== canonicalJson(proof)) throw new ContractError('ingress archive collision');
  if (!existing) { const h = await open(path, 'wx', 0o600); try { await h.writeFile(`${JSON.stringify(proof)}\n`); await h.sync(); } finally { await h.close(); } }
  await atomicWrite(runtime.proofFile || PROOF_FILE, proof, runtime); return proof;
}
function readback(proof, observedAt) { const { writtenAt: _w, previousProofDigest: _p, ...rest } = proof; return { ...rest, schema: 'booking.ingress-readback/v3', observedAt }; }
function now(runtime) { const value = (runtime.now || (() => new Date()))(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new ContractError('trusted ingress clock is invalid'); return value; }
function ingressGuard() { return { mode: 'local-docker-network-alias', convergence: 'previous-desired-in-flight-readback',
  fencedResources: ['ingress:booking-preprod', EDGE_NETWORK], exactIdMutation: true, cloudflareMutationAllowed: false, publicProbeRequired: true }; }

async function currentProcessIdentity(runtime) {
  if (runtime.processIdentity) return runtime.processIdentity;
  if (runtime.allowInsecureTestPaths) return { pid: process.pid, bootId: 'fixture-boot', startTicks: 'fixture-start',
    ownerContainerName: LOCK_OWNER_CONTAINER, ownerContainerId: 'e'.repeat(64) };
  try {
    const statValue = await readFile(`/proc/${process.pid}/stat`, 'utf8');
    const close = statValue.lastIndexOf(')'); const fields = statValue.slice(close + 2).trim().split(/\s+/);
    const owner = await inspectLockOwner({ ownerContainerName: LOCK_OWNER_CONTAINER }, runtime);
    const hostname = process.env.HOSTNAME || '';
    if (!owner.Running || (hostname !== owner.Id && hostname !== owner.Id.slice(0, 12))) throw new Error('owner mismatch');
    return { pid: process.pid, bootId: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(), startTicks: fields[19],
      ownerContainerName: owner.Name, ownerContainerId: owner.Id };
  } catch { throw new ContractError('cannot bind ingress lock to the kernel process identity'); }
}
async function inspectLockOwner(lock, runtime) {
  if (runtime.inspectLockOwner) return runtime.inspectLockOwner(lock);
  let value;
  try { value = JSON.parse((await docker(['container', 'inspect', '--format',
    '{"Id":{{json .Id}},"Name":{{json .Name}},"Running":{{json .State.Running}}}', lock.ownerContainerName], runtime)).trim()); }
  catch { throw new ContractError('Docker owner inspection is unavailable during ingress lock recovery'); }
  if (!value || !CONTAINER_ID.test(value.Id || '') || value.Name !== `/${lock.ownerContainerName}` || typeof value.Running !== 'boolean' ||
      (lock.ownerContainerId && value.Id !== lock.ownerContainerId)) throw new ContractError('ingress lock Docker owner identity mismatched');
  return { Id: value.Id, Name: value.Name.slice(1), Running: value.Running };
}
async function dockerOwnerStatus(lock, runtime) {
  if (runtime.inspectDockerOwnerStatus) return runtime.inspectDockerOwnerStatus(lock);
  if (runtime.inspectLockOwner) {
    const value = await runtime.inspectLockOwner(lock);
    return { daemonAvailable: true, byName: value, byId: value };
  }
  try { await docker(['info', '--format', '{{json .ServerVersion}}'], runtime); }
  catch { throw new ContractError('Docker daemon is unavailable during ingress lock recovery'); }
  const inspectMaybe = async (identity) => {
    try {
      const value = JSON.parse((await docker(['container', 'inspect', '--format',
        '{"Id":{{json .Id}},"Name":{{json .Name}},"Running":{{json .State.Running}}}', identity], runtime)).trim());
      if (!value || !CONTAINER_ID.test(value.Id || '') || typeof value.Name !== 'string' || typeof value.Running !== 'boolean') {
        throw new ContractError('ingress lock Docker owner inspection is malformed');
      }
      return { Id: value.Id, Name: value.Name.slice(1), Running: value.Running };
    } catch (error) {
      if (/no such (object|container)/i.test(error?.message || '')) return null;
      throw error;
    }
  };
  return { daemonAvailable: true, byName: await inspectMaybe(lock.ownerContainerName), byId: await inspectMaybe(lock.ownerContainerId) };
}
function assertDeadDockerOwner(status, lock) {
  if (!status?.daemonAvailable) throw new ContractError('Docker daemon is unavailable during ingress lock recovery');
  const { byName, byId } = status;
  if (byName && (byName.Id !== lock.ownerContainerId || byName.Name !== lock.ownerContainerName)) {
    throw new ContractError('fixed ingress lock owner name points to a replacement container');
  }
  if (byId && (byId.Id !== lock.ownerContainerId || byId.Name !== lock.ownerContainerName)) {
    throw new ContractError('recorded ingress lock owner ID drifted');
  }
  if (byName?.Running || byId?.Running) throw new ContractError('ingress lock Docker owner is still running');
  if (Boolean(byName) !== Boolean(byId)) throw new ContractError('ingress lock Docker owner lookup is inconsistent');
}
function lockBodyValid(value) {
  exactKeys(value, ['schema', 'pid', 'bootId', 'startTicks', 'ownerContainerName', 'ownerContainerId', 'createdAt', 'lockDigest'], 'ingress lock'); const { lockDigest, ...body } = value;
  if (value.schema !== 'booking.local-ingress-lock/v2' || !Number.isSafeInteger(value.pid) || value.pid < 1 || !ID.test(value.bootId || '') ||
      value.ownerContainerName !== LOCK_OWNER_CONTAINER || !CONTAINER_ID.test(value.ownerContainerId || '') ||
      !ID.test(value.startTicks || '') || !Number.isFinite(Date.parse(value.createdAt)) || !DIGEST.test(lockDigest || '') || sha256(body) !== lockDigest) throw new ContractError('ingress lock identity is invalid');
  return value;
}
async function ownerAlive(lock, runtime) {
  if (runtime.ownerAlive) return runtime.ownerAlive(lock);
  try {
    const bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(); if (bootId !== lock.bootId) return false;
    const statValue = await readFile(`/proc/${lock.pid}/stat`, 'utf8'); const close = statValue.lastIndexOf(')');
    return statValue.slice(close + 2).trim().split(/\s+/)[19] === lock.startTicks;
  } catch { return false; }
}
async function lockArtifactDigest(path) {
  const metadata = await lstat(path);
  if (metadata.isFile()) {
    const value = await readFile(path, 'utf8'); if (value.length > 65536) throw new ContractError('ingress lock forensic artifact is oversized');
    return sha256({ kind: 'file', value });
  }
  if (!metadata.isDirectory()) throw new ContractError('ingress lock forensic artifact type is invalid');
  const names = (await readdir(path)).sort();
  if (names.some((name) => !['.owner.json.tmp', 'owner.json'].includes(name))) throw new ContractError('ingress lock forensic artifact has foreign entries');
  const entries = [];
  for (const name of names) {
    const entryPath = join(path, name); const entry = await lstat(entryPath);
    if (!entry.isFile() || entry.size > 65536) throw new ContractError('ingress lock forensic entry is invalid');
    entries.push({ name, value: await readFile(entryPath, 'utf8') });
  }
  return sha256({ kind: 'directory', entries });
}
async function forensicOwnerNameAbsent(runtime) {
  if (runtime.inspectForensicOwnerName) return runtime.inspectForensicOwnerName();
  try { await docker(['info', '--format', '{{json .ServerVersion}}'], runtime); }
  catch { throw new ContractError('Docker daemon is unavailable during ingress lock forensic recovery'); }
  try {
    await docker(['container', 'inspect', '--format', '{{json .Id}}', LOCK_OWNER_CONTAINER], runtime);
    return false;
  } catch (error) {
    if (/no such (object|container)/i.test(error?.message || '')) return true;
    throw new ContractError('Docker owner lookup is unavailable during ingress lock forensic recovery');
  }
}
export async function recoverStaleIngressLock(expectedDigest, runtime = {}) {
  const path = runtime.lockFile || LOCK_FILE; const parent = dirname(path); const fixed = await lstat(path).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
  const prefix = `${basename(path)}.`; const tempNames = (await readdir(parent)).filter((name) => name.startsWith(prefix) && name.endsWith('.tmp'));
  if (tempNames.some((name) => !UUID.test(name.slice(prefix.length, -4)))) throw new ContractError('malformed ingress lock transaction artifact exists');
  const temporary = tempNames.map((name) => join(parent, name));
  if (!fixed) {
    if (temporary.length !== 1) throw new ContractError('ingress lock artifact is unavailable or ambiguous');
    const candidate = temporary[0]; const before = await lstat(candidate); const artifactDigest = await lockArtifactDigest(candidate);
    if (artifactDigest !== expectedDigest) throw new ContractError('ingress lock forensic digest mismatch');
    if (!(await forensicOwnerNameAbsent(runtime))) throw new ContractError('fixed ingress lock owner exists during forensic recovery');
    const after = await lstat(candidate); if (before.dev !== after.dev || before.ino !== after.ino || await lockArtifactDigest(candidate) !== artifactDigest) {
      throw new ContractError('ingress lock forensic artifact changed during recovery');
    }
    if (!(await forensicOwnerNameAbsent(runtime))) throw new ContractError('fixed ingress lock owner appeared during forensic recovery');
    await rm(candidate, { recursive: true }); await syncDirectory(parent, runtime);
    return { schema: 'booking.local-ingress-lock-recovery/v1', recoveredLockDigest: expectedDigest, recoveredAt: now(runtime).toISOString() };
  }
  if (!fixed.isDirectory()) {
    const artifactDigest = await lockArtifactDigest(path); if (artifactDigest !== expectedDigest) throw new ContractError('ingress lock forensic digest mismatch');
    if (!(await forensicOwnerNameAbsent(runtime))) throw new ContractError('fixed ingress lock owner exists during forensic recovery');
    if (await lockArtifactDigest(path) !== artifactDigest || !(await forensicOwnerNameAbsent(runtime))) throw new ContractError('ingress lock forensic state changed during recovery');
    await unlink(path); await syncDirectory(parent, runtime);
    return { schema: 'booking.local-ingress-lock-recovery/v1', recoveredLockDigest: expectedDigest, recoveredAt: now(runtime).toISOString() };
  }
  const before = await trustedPath(path, 'ingress lock directory', runtime);
  const names = (await readdir(path)).sort();
  if (canonicalJson(names) !== canonicalJson(['owner.json'])) {
    const artifactDigest = await lockArtifactDigest(path); if (artifactDigest !== expectedDigest) throw new ContractError('ingress lock forensic digest mismatch');
    if (!(await forensicOwnerNameAbsent(runtime))) throw new ContractError('fixed ingress lock owner exists during forensic recovery');
    if (await lockArtifactDigest(path) !== artifactDigest || !(await forensicOwnerNameAbsent(runtime))) throw new ContractError('ingress lock forensic state changed during recovery');
    await rm(path, { recursive: true }); await syncDirectory(parent, runtime);
    return { schema: 'booking.local-ingress-lock-recovery/v1', recoveredLockDigest: expectedDigest, recoveredAt: now(runtime).toISOString() };
  }
  const ownerPath = join(path, 'owner.json'); const lock = lockBodyValid(await readJson(ownerPath, 'ingress lock owner file', runtime));
  if (lock.lockDigest !== expectedDigest) throw new ContractError('stale ingress lock digest mismatch');
  assertDeadDockerOwner(await dockerOwnerStatus(lock, runtime), lock);
  if (await ownerAlive(lock, runtime)) throw new ContractError('ingress lock owner is still alive');
  const after = await trustedPath(path, 'ingress lock directory', runtime);
  if (before.dev !== after.dev || before.ino !== after.ino) throw new ContractError('ingress lock changed during stale recovery');
  assertDeadDockerOwner(await dockerOwnerStatus(lock, runtime), lock);
  const ownerAfter = lockBodyValid(await readJson(ownerPath, 'ingress lock owner file', runtime));
  if (ownerAfter.lockDigest !== expectedDigest) throw new ContractError('ingress lock owner changed during stale recovery');
  await rm(path, { recursive: true }); await syncDirectory(dirname(path), runtime);
  return { schema: 'booking.local-ingress-lock-recovery/v1', recoveredLockDigest: expectedDigest, recoveredAt: now(runtime).toISOString() };
}
export async function withIngressLock(runtime, callback) {
  const path = runtime.lockFile || LOCK_FILE; const parent = dirname(path); await trustedPath(parent, 'ingress state directory', runtime);
  const transactionId = randomUUID(); const temporary = `${path}.${transactionId}.tmp`; let h; let published = false; let publishedDigest = null;
  try {
    await mkdir(temporary, { mode: 0o700 }); await chmod(temporary, 0o700); await syncDirectory(parent, runtime); await lockCheckpoint(runtime, 'lock:temp-created');
    const owner = await currentProcessIdentity(runtime); const body = { schema: 'booking.local-ingress-lock/v2', ...owner, createdAt: now(runtime).toISOString() };
    publishedDigest = sha256(body);
    const ownerTemp = join(temporary, '.owner.json.tmp'); h = await open(ownerTemp, 'wx', 0o600);
    await h.writeFile(`${JSON.stringify({ ...body, lockDigest: publishedDigest })}\n`); await h.sync(); await h.close(); h = null; await chmod(ownerTemp, 0o600);
    await lockCheckpoint(runtime, 'lock:owner-written'); await rename(ownerTemp, join(temporary, 'owner.json'));
    await syncDirectory(temporary, runtime); await lockCheckpoint(runtime, 'lock:owner-linked');
    await rename(temporary, path); published = true; await syncDirectory(parent, runtime); await lockCheckpoint(runtime, 'lock:published');
  } catch (error) {
    await h?.close().catch(() => {}); if (!published) await rm(temporary, { recursive: true, force: true }).catch(() => {});
    throw new ContractError(error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY' ? 'ingress helper lock exists' : 'ingress helper lock could not be established');
  }
  try { return await callback(); } finally {
    const current = lockBodyValid(await readJson(join(path, 'owner.json'), 'ingress lock owner file', runtime));
    if (current.lockDigest !== publishedDigest) throw new ContractError('ingress helper lock ownership changed before cleanup');
    await rm(path, { recursive: true }); await syncDirectory(parent, runtime);
  }
}
function sameRequest(proof, args, sequence, epoch) { return proof && proof.operationId === args['operation-id'] && proof.approvalId === args['approval-id'] && proof.leaseId === args['lease-id'] && proof.holderId === args['holder-id'] && proof.actionKind === args['action-kind'] && proof.actionId === args['action-id'] && proof.sequence === sequence && proof.fencingEpoch === epoch && proof.releaseId === args.release && proof.manifestDigest === args['manifest-digest'] && proof.upstream === args.upstream && proof.sourceContainerId === args['source-container-id'] && proof.sourceBackendContainerId === args['source-backend-container-id'] && proof.sourceImageId === args['source-image-id'] && proof.sourceConfigImage === args['source-config-image'] && proof.sourceConfigHash === args['source-config-hash'] && proof.targetContainerId === args['target-container-id'] && proof.targetBackendContainerId === args['target-backend-container-id'] && proof.targetImageId === args['target-image-id'] && proof.targetConfigImage === args['target-config-image'] && proof.targetConfigHash === args['target-config-hash']; }
function sourceIdentity(prior, args, sequence, epoch) {
  const rollbackTarget = args.release === args['rollback-release'] && args['manifest-digest'] === args['rollback-manifest-digest'] && args.upstream === args['rollback-upstream'];
  if ((sequence === 2) !== rollbackTarget) throw new ContractError('ingress cycle target violates rollback binding');
  if (!prior) {
    if (sequence !== 1 || rollbackTarget) throw new ContractError('first ingress proof must start at sequence one with a distinct immutable rollback baseline');
    return { releaseId: args['rollback-release'], manifestDigest: args['rollback-manifest-digest'], upstream: args['rollback-upstream'] };
  }
  if (prior.fencingEpoch > epoch) throw new ContractError('ingress fencing epoch is stale');
  if (prior.fencingEpoch === epoch && (sequence !== prior.sequence + 1 || prior.operationId !== args['operation-id'] || prior.approvalId !== args['approval-id'] || prior.leaseId !== args['lease-id'] || prior.holderId !== args['holder-id'])) throw new ContractError('same-epoch ingress action is outside canonical sequence');
  if (prior.fencingEpoch < epoch && prior.operationId !== args['operation-id'] && (prior.sequence !== 3 || sequence !== 1)) throw new ContractError('new epoch requires a completed prior cycle');
  if (sequence !== 1 && (prior.rollbackUpstream !== args['rollback-upstream'] || prior.rollbackReleaseId !== args['rollback-release'] ||
      prior.rollbackManifestDigest !== args['rollback-manifest-digest'])) throw new ContractError('ingress rollback baseline drifted from predecessor proof');
  if (sequence === 2 && (args.release !== prior.rollbackReleaseId || args['manifest-digest'] !== prior.rollbackManifestDigest || args.upstream !== prior.rollbackUpstream)) {
    throw new ContractError('rollback target does not match predecessor proof');
  }
  if (sequence === 3 && (args.release !== prior.sourceReleaseId || args['manifest-digest'] !== prior.sourceManifestDigest || args.upstream !== prior.sourceUpstream)) {
    throw new ContractError('second promotion target does not match immutable cycle candidate');
  }
  return { releaseId: prior.releaseId, manifestDigest: prior.manifestDigest, upstream: prior.upstream };
}
function identity(args, sequence, epoch, source) { return { releaseId: args.release, manifestDigest: args['manifest-digest'], upstream: args.upstream, operationId: args['operation-id'], approvalId: args['approval-id'], leaseId: args['lease-id'], holderId: args['holder-id'], actionKind: args['action-kind'], actionId: args['action-id'], sequence, fencingEpoch: epoch, rollbackUpstream: args['rollback-upstream'], rollbackReleaseId: args['rollback-release'], rollbackManifestDigest: args['rollback-manifest-digest'], sourceReleaseId: source.releaseId, sourceManifestDigest: source.manifestDigest, sourceUpstream: source.upstream }; }
function pendingBodyValid(value) {
  exactKeys(value, ['schema', 'request', 'requestDigest', 'sourceContainerId', 'sourceBackendContainerId', 'sourceImageId', 'sourceConfigImage', 'sourceConfigHash',
    'targetContainerId', 'targetBackendContainerId', 'targetImageId', 'targetConfigImage', 'targetConfigHash', 'cloudflaredContainerId', 'cloudflaredImageId',
    'cloudflaredStartedAt', 'createdAt', 'pendingDigest'], 'ingress pending marker');
  const { pendingDigest, ...body } = value;
  if (value.schema !== 'booking.local-ingress-pending/v2' || value.requestDigest !== sha256(value.request) || !DIGEST.test(pendingDigest || '') ||
      pendingDigest !== sha256(body) || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.cloudflaredStartedAt))) {
    throw new ContractError('ingress pending marker digest is invalid');
  }
  return value;
}
function pendingMatches(p, request, t, sourceBinding, targetBinding, allowCompletedRestart = false) {
  return p && canonicalJson(p.request) === canonicalJson(request) && p.requestDigest === sha256(request) &&
    p.sourceContainerId === sourceBinding.containerId && p.sourceBackendContainerId === sourceBinding.backendContainerId && p.sourceImageId === sourceBinding.imageId &&
    p.sourceConfigImage === sourceBinding.configImage && p.sourceConfigHash === sourceBinding.configHash &&
    p.targetContainerId === targetBinding.containerId && p.targetBackendContainerId === targetBinding.backendContainerId && p.targetImageId === targetBinding.imageId &&
    p.targetConfigImage === targetBinding.configImage && p.targetConfigHash === targetBinding.configHash &&
    p.cloudflaredContainerId === t.cloudflared.Id && p.cloudflaredImageId === t.cloudflared.Image &&
    (allowCompletedRestart
      ? Date.parse(t.cloudflared.StartedAt) > Date.parse(p.cloudflaredStartedAt)
      : p.cloudflaredStartedAt === t.cloudflared.StartedAt ||
        (t.state === 'desired' && Date.parse(t.cloudflared.StartedAt) > Date.parse(p.cloudflaredStartedAt)));
}
async function reconnect(container, desiredAliases, runtime) {
  const current = aliases(container); const desired = [...desiredAliases];
  const semanticallyDesired = container.Networks?.[EDGE_NETWORK] && desired.every((item) => current.includes(item)) &&
    current.every((item) => desired.includes(item) || item === container.Id.slice(0, 12)) &&
    (desired.includes(LOGICAL_ALIAS) || !current.includes(LOGICAL_ALIAS));
  if (semanticallyDesired) return;
  if (container.Networks?.[EDGE_NETWORK]) await docker(['network', 'disconnect', EDGE_NETWORK, container.Id], runtime);
  if ((await inspect(container.Id, runtime)).Networks?.[EDGE_NETWORK]) throw new ContractError('exact endpoint disconnect did not converge');
  const argv = ['network', 'connect']; for (const alias of desiredAliases) argv.push('--alias', alias); argv.push(EDGE_NETWORK, container.Id); await docker(argv, runtime);
}
function proofBindings(proof) {
  return {
    source: { slot: slot(proof.sourceUpstream), release: proof.sourceReleaseId, containerId: proof.sourceContainerId,
      backendContainerId: proof.sourceBackendContainerId, imageId: proof.sourceImageId, configImage: proof.sourceConfigImage, configHash: proof.sourceConfigHash },
    target: { slot: slot(proof.upstream), release: proof.releaseId, containerId: proof.targetContainerId,
      backendContainerId: proof.targetBackendContainerId, imageId: proof.targetImageId, configImage: proof.targetConfigImage, configHash: proof.targetConfigHash },
  };
}
async function verifyRuntime(proof, runtime) {
  const bindings = proofBindings(proof); const t = await topology(bindings.source, bindings.target, runtime);
  if (t.state !== 'desired' || t.source.Id !== proof.sourceContainerId || t.source.Image !== proof.sourceImageId || t.target.Id !== proof.targetContainerId || t.target.Image !== proof.targetImageId || t.cloudflared.Id !== proof.cloudflaredContainerId || t.cloudflared.Image !== proof.cloudflaredImageId || t.cloudflared.StartedAt !== proof.cloudflaredStartedAt) throw new ContractError('local Docker ingress drifted from fenced proof');
  return readback(proof, now(runtime).toISOString());
}
async function executeReadback(runtime) { return withIngressLock(runtime, async () => { const proof = await loadProof(runtime); if (!proof) throw new ContractError('local ingress proof is unavailable'); return verifyRuntime(proof, runtime); }); }
async function executeMutation(args, sequence, epoch, runtime, recoverPending) {
  return withIngressLock(runtime, async () => {
    const pendingPath = runtime.pendingFile || PENDING_FILE; const rawPending = await readJson(pendingPath, 'ingress pending file', runtime, true);
    const pending = rawPending ? pendingBodyValid(rawPending) : null;
    const prior = await loadProof(runtime);
    if (sameRequest(prior, args, sequence, epoch)) {
      const verified = await verifyRuntime(prior, runtime);
      if (pending) {
        const bindings = proofBindings(prior); const t = await topology(bindings.source, bindings.target, runtime, pending);
        if (!pendingMatches(pending, identity(args, sequence, epoch, { releaseId: prior.sourceReleaseId, manifestDigest: prior.sourceManifestDigest, upstream: prior.sourceUpstream }), t, bindings.source, bindings.target, true) ||
            t.cloudflared.StartedAt !== prior.cloudflaredStartedAt) {
          throw new ContractError('completed proof conflicts with pending ingress identity');
        }
        await unlink(pendingPath);
      }
      return verified;
    }
    const source = sourceIdentity(prior, args, sequence, epoch); const sourceSlot = slot(source.upstream); const targetSlot = slot(args.upstream);
    if (!sourceSlot || !targetSlot || sourceSlot === targetSlot) throw new ContractError('source and target slots must differ');
    const sourceBinding = expectedBinding(args, 'source', sourceSlot, source.releaseId); const targetBinding = expectedBinding(args, 'target', targetSlot, args.release);
    let t = await topology(sourceBinding, targetBinding, runtime, pending); const request = identity(args, sequence, epoch, source);
    if (pending && !pendingMatches(pending, request, t, sourceBinding, targetBinding)) throw new ContractError('pending ingress identity does not match exact Docker resources');
    if (!pending && recoverPending && t.state === 'previous') return { schema: 'booking.ingress-pending-recovery/v2', outcome: 'not-applied', project: PREPROD_PROJECT, hostname: PREPROD_HOSTNAME, edgeNetwork: EDGE_NETWORK, logicalAlias: LOGICAL_ALIAS, fixedRemoteService: FIXED_REMOTE_SERVICE, aliasState: 'previous', operationId: args['operation-id'], actionKind: args['action-kind'], actionId: args['action-id'], sequence, fencingEpoch: epoch, previousProofDigest: prior?.proofDigest || null, guard: { mode: 'local-docker-network-alias', convergence: 'previous-desired-in-flight-readback', fencedResources: ['ingress:booking-preprod', EDGE_NETWORK], cloudflareMutationAllowed: false }, observedAt: now(runtime).toISOString() };
    if (!pending && t.state !== 'previous') throw new ContractError('unproven Docker alias state requires forensic freeze');
    if (!pending) {
      const pendingBody = { schema: 'booking.local-ingress-pending/v2', request, requestDigest: sha256(request),
        sourceContainerId: sourceBinding.containerId, sourceBackendContainerId: sourceBinding.backendContainerId, sourceImageId: sourceBinding.imageId,
        sourceConfigImage: sourceBinding.configImage, sourceConfigHash: sourceBinding.configHash,
        targetContainerId: targetBinding.containerId, targetBackendContainerId: targetBinding.backendContainerId, targetImageId: targetBinding.imageId,
        targetConfigImage: targetBinding.configImage, targetConfigHash: targetBinding.configHash,
        cloudflaredContainerId: t.cloudflared.Id, cloudflaredImageId: t.cloudflared.Image, cloudflaredStartedAt: t.cloudflared.StartedAt,
        createdAt: now(runtime).toISOString() };
      await atomicWrite(pendingPath, { ...pendingBody, pendingDigest: sha256(pendingBody) }, runtime);
    }
    const activePending = pending || pendingBodyValid(await readJson(pendingPath, 'ingress pending file', runtime));
    await reconnect(t.source, baseAliases(sourceSlot), runtime); t = await topology(sourceBinding, targetBinding, runtime, activePending);
    await reconnect(t.target, [...baseAliases(targetSlot), LOGICAL_ALIAS], runtime); t = await topology(sourceBinding, targetBinding, runtime, activePending);
    if (t.state !== 'desired') throw new ContractError('logical alias did not converge');
    const baseline = activePending.cloudflaredStartedAt;
    let restarted = false;
    if (t.cloudflared.Running === false) { await docker(['container', 'start', t.cloudflared.Id], runtime); restarted = true; }
    else if (Date.parse(t.cloudflared.StartedAt) <= Date.parse(baseline)) { await docker(['container', 'restart', '--time', '10', t.cloudflared.Id], runtime); restarted = true; }
    if (restarted && runtime.afterCloudflaredRestart) await runtime.afterCloudflaredRestart();
    t = await topology(sourceBinding, targetBinding, runtime, activePending);
    t.cloudflared = verifyCloudflared(t.cloudflared, { startedAfter: baseline });
    const writtenAt = now(runtime).toISOString(); const body = { schema: 'booking.local-ingress-proof/v3', project: PREPROD_PROJECT, hostname: PREPROD_HOSTNAME, edgeNetwork: EDGE_NETWORK, logicalAlias: LOGICAL_ALIAS, fixedRemoteService: FIXED_REMOTE_SERVICE, aliasState: 'desired', ...request,
      sourceContainerId: sourceBinding.containerId, sourceBackendContainerId: sourceBinding.backendContainerId, sourceImageId: sourceBinding.imageId,
      sourceConfigImage: sourceBinding.configImage, sourceConfigHash: sourceBinding.configHash,
      targetContainerId: targetBinding.containerId, targetBackendContainerId: targetBinding.backendContainerId, targetImageId: targetBinding.imageId,
      targetConfigImage: targetBinding.configImage, targetConfigHash: targetBinding.configHash,
      cloudflaredContainerId: t.cloudflared.Id, cloudflaredImageId: t.cloudflared.Image, cloudflaredStartedAt: t.cloudflared.StartedAt,
      guard: ingressGuard(), writtenAt, previousProofDigest: prior?.proofDigest || null };
    if (runtime.beforeProofWrite) await runtime.beforeProofWrite();
    const proof = await storeProof(runtime, body);
    if (runtime.beforePendingCleanup) await runtime.beforePendingCleanup();
    await unlink(pendingPath).catch((e) => { if (e?.code !== 'ENOENT') throw new ContractError('completed pending marker cannot be removed'); }); return verifyRuntime(proof, runtime);
  });
}

export async function runIngressHelper(argv, runtime = {}) { const args = parseArgs(argv); const scope = validateArgs(args); return scope.staleLockRecovery ? recoverStaleIngressLock(scope.lockDigest, runtime) : scope.readback ? executeReadback(runtime) : executeMutation(args, scope.sequence, scope.fencingEpoch, runtime, scope.recoverPending); }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await trustedPath(fileURLToPath(import.meta.url), 'ingress implementation file', {}); process.stdout.write(`${JSON.stringify(await runIngressHelper(process.argv.slice(2)))}\n`); }
  catch (error) { const failure = error instanceof ContractError ? error : new ContractError('unexpected ingress helper failure'); process.stderr.write(`${JSON.stringify({ schema: 'booking.ingress-error/v1', status: 'fail', message: failure.message })}\n`); process.exitCode = failure.exitCode; }
}
