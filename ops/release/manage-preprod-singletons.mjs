#!/usr/bin/env node
import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractError, EXIT, parseArgs, sha256 } from './lib/contracts.mjs';
import { digestFile } from './lib/artifacts.mjs';
import { LEGACY_OLD_BINDING } from './lib/legacy-preprod.mjs';

const PROJECT = 'booking-preprod';
const SLOT = new Set(['blue', 'green']);
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IMAGE_INSPECT_FORMAT = '{{json .Id}}|{{json .RepoDigests}}|{{json .RepoTags}}|{{json .Config.Labels}}';
const CONTAINER_INSPECT_FORMAT = '{"id":{{json .Id}},"image":{{json .Image}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"env":{{json .Config.Env}},"mounts":{{json .Mounts}},"networks":{{json .NetworkSettings.Networks}},"readOnly":{{json .HostConfig.ReadonlyRootfs}},"capDrop":{{json .HostConfig.CapDrop}},"capAdd":{{json .HostConfig.CapAdd}},"securityOpt":{{json .HostConfig.SecurityOpt}},"portBindings":{{json .HostConfig.PortBindings}},"ports":{{json .NetworkSettings.Ports}},"user":{{json .Config.User}},"privileged":{{json .HostConfig.Privileged}},"pidMode":{{json .HostConfig.PidMode}},"ipcMode":{{json .HostConfig.IpcMode}},"devices":{{json .HostConfig.Devices}},"status":{{json .State.Status}},"health":{{json .State.Health}}}';
const ALLOWED = new Set(['action', 'readback', 'project', 'compose-file', 'egress-compose-file', 'target-slot', 'source-slot', 'release-id', 'git-sha', 'manifest-digest', 'backend-image', 'backend-digest',
  'source-release-id', 'source-git-sha', 'source-manifest-digest', 'source-backend-image', 'source-backend-digest']);

function defaultRunner(executable, argv, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, argv, { cwd: options.cwd, env: options.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    const limit = 64 * 1024;
    const collect = (target) => (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) child.kill('SIGKILL');
      else target.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    const timer = setTimeout(() => child.kill('SIGTERM'), options.timeoutMs || 120_000);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code, signal, overflow: bytes > limit, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
  });
}

function assertResult(result, message) {
  if (!result || result.exitCode !== 0 || result.signal || result.overflow) throw new ContractError(message, EXIT.SINGLETON);
}

async function executable(candidates) {
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return candidate; } catch {}
  }
  throw new ContractError('trusted Docker executable is unavailable', EXIT.SINGLETON);
}

function validateArgs(args) {
  for (const key of Object.keys(args)) if (!ALLOWED.has(key)) throw new ContractError(`unsupported singleton argument: --${key}`, EXIT.SINGLETON);
  for (const key of ['action', 'project', 'compose-file', 'target-slot', 'source-slot', 'release-id', 'git-sha', 'manifest-digest', 'backend-image', 'backend-digest',
    'source-release-id', 'source-git-sha', 'source-manifest-digest', 'source-backend-image', 'source-backend-digest']) {
    if (!args[key]) throw new ContractError(`--${key} is required`, EXIT.SINGLETON);
  }
  if (!['transfer', 'rollback'].includes(args.action) || args.project !== PROJECT || !SLOT.has(args['target-slot']) || !SLOT.has(args['source-slot']) || args['target-slot'] === args['source-slot']) {
    throw new ContractError('singleton action scope is invalid', EXIT.SINGLETON);
  }
  if (!/^booking-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/.test(args['release-id']) || !/^[0-9a-f]{40}$/.test(args['git-sha']) ||
      !DIGEST.test(args['manifest-digest']) || !DIGEST.test(args['backend-digest']) || !/^[A-Za-z0-9._/-]+$/.test(args['backend-image'])) {
    throw new ContractError('singleton release identity is invalid', EXIT.IDENTITY);
  }
  if (!/^booking-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/.test(args['source-release-id']) || !/^[0-9a-f]{40}$/.test(args['source-git-sha']) ||
      !DIGEST.test(args['source-manifest-digest']) || !DIGEST.test(args['source-backend-digest']) || !/^[A-Za-z0-9._/-]+$/.test(args['source-backend-image'])) {
    throw new ContractError('singleton source identity is invalid', EXIT.IDENTITY);
  }
  if (args.readback !== undefined && args.readback !== 'true') throw new ContractError('--readback must be true when present', EXIT.SINGLETON);
  if (args['release-id'] !== LEGACY_OLD_BINDING.releaseId && !args['egress-compose-file']) {
    throw new ContractError('--egress-compose-file is required for a non-legacy singleton target', EXIT.IDENTITY);
  }
}

function parseJsonLines(text, message) {
  if (!text.trim()) return [];
  try { return text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }
  catch { throw new ContractError(message, EXIT.SINGLETON); }
}

function envMap(values, service) {
  if (!Array.isArray(values)) throw new ContractError(`${service} environment readback is invalid`, EXIT.IDENTITY);
  const output = new Map();
  for (const value of values) {
    const split = String(value).indexOf('=');
    const key = split < 0 ? String(value) : String(value).slice(0, split);
    const item = split < 0 ? '' : String(value).slice(split + 1);
    if (output.has(key)) throw new ContractError(`${service} has duplicate environment key ${key}`, EXIT.IDENTITY);
    output.set(key, item);
  }
  return output;
}

function requireEnv(container, expected) {
  const actual = envMap(container.env, container.service);
  for (const [key, value] of Object.entries(expected)) {
    if (actual.get(key) !== value) throw new ContractError(`${container.service} environment ${key} drifted`, EXIT.IDENTITY);
  }
}

function isRunning(container) {
  return String(container.status).toLowerCase() === 'running';
}

function healthStatus(container) {
  return String(typeof container.health === 'string' ? container.health : container.health?.Status || '').toLowerCase();
}

function verifyWorkerRuntimeIsolation(containers) {
  const allowedServices = new Set(['order-worker-blue', 'order-worker-green']);
  const expectedNetworks = ['booking-preprod-data', 'booking-preprod-telegram'];
  const expectedMounts = [
    { type: 'tmpfs', source: '', destination: '/app/logs', rw: true },
    { type: 'tmpfs', source: '', destination: '/tmp', rw: true },
    { type: 'bind', source: '/volume1/happybooking/booking-preprod/.g4/secrets/telegram-data-encryption-secret',
      destination: '/run/secrets/telegram_data_encryption_secret', rw: false },
  ];
  for (const container of containers.filter((item) => item.service?.startsWith('order-worker-'))) {
    if (!allowedServices.has(container.service)) throw new ContractError(`${container.service} runtime isolation drifted`, EXIT.IDENTITY);
    const networkNames = container.networks && typeof container.networks === 'object' && !Array.isArray(container.networks)
      ? Object.keys(container.networks).sort() : [];
    const mounts = Array.isArray(container.mounts) ? container.mounts.map((item) => ({
      type: item.Type, source: item.Source || '', destination: item.Destination, rw: item.RW,
    })).sort((a, b) => a.destination.localeCompare(b.destination)) : [];
    const allowedMounts = [...expectedMounts].sort((a, b) => a.destination.localeCompare(b.destination));
    const noCapabilitiesAdded = container.capAdd === null || (Array.isArray(container.capAdd) && container.capAdd.length === 0);
    const noPortBindings = container.portBindings === null ||
      (container.portBindings && typeof container.portBindings === 'object' && !Array.isArray(container.portBindings) && Object.keys(container.portBindings).length === 0);
    const ports = container.ports === null ||
      (container.ports && typeof container.ports === 'object' && !Array.isArray(container.ports)) ? container.ports : undefined;
    if (JSON.stringify(networkNames) !== JSON.stringify(expectedNetworks) || container.readOnly !== true || container.user !== 'node' ||
        JSON.stringify(container.capDrop) !== JSON.stringify(['ALL']) || !noCapabilitiesAdded ||
        !Array.isArray(container.securityOpt) || container.securityOpt.length !== 1 || container.securityOpt[0] !== 'no-new-privileges:true' ||
        !noPortBindings || ports === undefined || container.privileged !== false ||
        container.pidMode !== '' || container.ipcMode !== '' || !Array.isArray(container.devices) || container.devices.length !== 0 ||
        JSON.stringify(mounts) !== JSON.stringify(allowedMounts)) {
      throw new ContractError(`${container.service} runtime isolation drifted`, EXIT.IDENTITY);
    }
    for (const bindings of Object.values(ports || {})) {
      if (Array.isArray(bindings) && bindings.length > 0) throw new ContractError(`${container.service} runtime isolation drifted`, EXIT.IDENTITY);
    }
  }
}

async function inspectProjectContainers(docker, runner, options) {
  const listed = await runner(docker, ['container', 'ls', '--all', '--no-trunc', '--filter', `label=com.docker.compose.project=${PROJECT}`, '--format', '{{.ID}}'], options);
  assertResult(listed, 'cannot enumerate booking-preprod containers');
  const containers = [];
  for (const id of listed.stdout.trim().split(/\r?\n/).filter(Boolean)) {
    if (!/^[0-9a-f]{12,64}$/.test(id)) throw new ContractError('container enumeration returned an invalid ID', EXIT.IDENTITY);
    const inspected = await runner(docker, ['container', 'inspect', '--format', CONTAINER_INSPECT_FORMAT, id], options);
    assertResult(inspected, 'cannot inspect booking-preprod container');
    const values = parseJsonLines(inspected.stdout, 'container inspect readback is not JSON');
    if (values.length !== 1 || values[0].project !== PROJECT || values[0].id !== id) throw new ContractError('container identity readback mismatch', EXIT.IDENTITY);
    containers.push(values[0]);
  }
  return containers;
}

function exactlyOne(containers, service, required) {
  const found = containers.filter((item) => item.service === service);
  if (found.length > 1 || (required && found.length !== 1)) throw new ContractError(`${service} container cardinality is invalid`, EXIT.SINGLETON);
  return found[0] || null;
}

function hasExactLegacySourceArgs(args) {
  return args.action === 'transfer' && args['source-slot'] === 'green' &&
    args['source-release-id'] === LEGACY_OLD_BINDING.releaseId && args['source-git-sha'] === LEGACY_OLD_BINDING.gitSha &&
    args['source-manifest-digest'] === LEGACY_OLD_BINDING.manifestRawDigest && args['source-backend-digest'] === LEGACY_OLD_BINDING.imageId &&
    args['source-backend-image'] === LEGACY_OLD_BINDING.manifestRepository;
}

function hasExactLegacyTargetArgs(args) {
  return args.action === 'rollback' && args['target-slot'] === 'green' &&
    args['release-id'] === LEGACY_OLD_BINDING.releaseId && args['git-sha'] === LEGACY_OLD_BINDING.gitSha &&
    args['manifest-digest'] === LEGACY_OLD_BINDING.manifestRawDigest && args['backend-digest'] === LEGACY_OLD_BINDING.imageId &&
    args['backend-image'] === LEGACY_OLD_BINDING.manifestRepository;
}

function isExactLegacySource(args, container) {
  return hasExactLegacySourceArgs(args) && container.service === 'backend-green' && container.image === LEGACY_OLD_BINDING.imageId;
}

function isExactLegacyTarget(args, container) {
  return hasExactLegacyTargetArgs(args) && container.service === 'backend-green' && container.image === LEGACY_OLD_BINDING.imageId;
}

function verifyApiWorkersDisabled(containers, args, targetImageId, sourceImageId) {
  for (const slot of SLOT) {
    const service = `backend-${slot}`;
    const container = exactlyOne(containers, service, true);
    if (!isRunning(container)) throw new ContractError(`${service} must remain running during singleton transfer`, EXIT.READINESS);
    const expectedIdentity = slot === args['target-slot']
      ? { release: args['release-id'], gitSha: args['git-sha'], manifest: args['manifest-digest'], image: targetImageId }
      : { release: args['source-release-id'], gitSha: args['source-git-sha'], manifest: args['source-manifest-digest'], image: sourceImageId };
    if (container.image !== expectedIdentity.image) throw new ContractError(`${service} image identity drifted`, EXIT.IDENTITY);
    requireEnv(container, { BOOKING_RELEASE_ID: expectedIdentity.release, BOOKING_GIT_SHA: expectedIdentity.gitSha,
      BOOKING_MANIFEST_DIGEST: expectedIdentity.manifest, BOOKING_WORKERS_ENABLED: 'false' });
    const actual = envMap(container.env, service);
    if (!actual.has('ORDER_OUTBOX_DISPATCH_ENABLED')) {
      if (!isExactLegacySource(args, container) && !isExactLegacyTarget(args, container)) throw new ContractError(`${service} environment ORDER_OUTBOX_DISPATCH_ENABLED is missing`, EXIT.IDENTITY);
    } else if (actual.get('ORDER_OUTBOX_DISPATCH_ENABLED') !== 'false') {
      throw new ContractError(`${service} environment ORDER_OUTBOX_DISPATCH_ENABLED drifted`, EXIT.IDENTITY);
    }
  }
}

async function inspectReleaseImage(docker, runner, options, identity) {
  const reference = `${identity.image}:${identity.releaseId}`;
  const result = await runner(docker, ['image', 'inspect', '--format', IMAGE_INSPECT_FORMAT, reference], options);
  assertResult(result, 'cannot inspect manifest-bound backend image');
  const parts = result.stdout.trim().split('|');
  if (parts.length !== 4) throw new ContractError('backend image readback is malformed', EXIT.IDENTITY);
  let image;
  try { image = { id: JSON.parse(parts[0]), repoDigests: JSON.parse(parts[1]), repoTags: JSON.parse(parts[2]), labels: JSON.parse(parts[3]) || {} }; }
  catch { throw new ContractError('backend image readback is invalid', EXIT.IDENTITY); }
  const tagged = `${identity.image}:${identity.releaseId}`;
  if (!DIGEST.test(image.id || '') || !Array.isArray(image.repoDigests) || !Array.isArray(image.repoTags) || !image.repoTags.includes(tagged) ||
      (image.repoDigests.length ? !image.repoDigests.includes(`${identity.image}@${identity.digest}`) : image.id !== identity.digest) ||
      image.labels['org.opencontainers.image.revision'] !== identity.gitSha || image.labels['uk.happybooking.release-id'] !== identity.releaseId ||
      image.labels['uk.happybooking.component'] !== 'backend') throw new ContractError('backend image does not match singleton target identity', EXIT.IDENTITY);
  return image.id;
}

async function inspectLegacyImage(docker, runner, options) {
  const result = await runner(docker, ['image', 'inspect', '--format', IMAGE_INSPECT_FORMAT, LEGACY_OLD_BINDING.uniqueTag], options);
  assertResult(result, 'cannot inspect exact legacy source image');
  const parts = result.stdout.trim().split('|');
  let inspected;
  try { inspected = { id: JSON.parse(parts[0]), repoDigests: JSON.parse(parts[1]), repoTags: JSON.parse(parts[2]), labels: JSON.parse(parts[3]) }; }
  catch { throw new ContractError('legacy source image readback is invalid', EXIT.IDENTITY); }
  if (parts.length !== 4 || inspected.id !== LEGACY_OLD_BINDING.imageId || !Array.isArray(inspected.repoDigests) || inspected.repoDigests.length !== 0 ||
      !Array.isArray(inspected.repoTags) || inspected.repoTags.length !== 1 || inspected.repoTags[0] !== LEGACY_OLD_BINDING.uniqueTag || inspected.labels !== null) {
    throw new ContractError('legacy source image does not match the one-time fixed binding', EXIT.IDENTITY);
  }
  return inspected.id;
}

async function inspectSourceImage(docker, runner, options, args) {
  if (hasExactLegacySourceArgs(args)) return inspectLegacyImage(docker, runner, options);
  return inspectReleaseImage(docker, runner, options, { image: args['source-backend-image'], digest: args['source-backend-digest'],
    releaseId: args['source-release-id'], gitSha: args['source-git-sha'] });
}

async function inspectTargetImage(docker, runner, options, args) {
  if (hasExactLegacyTargetArgs(args)) return inspectLegacyImage(docker, runner, options);
  return inspectReleaseImage(docker, runner, options, { image: args['backend-image'], digest: args['backend-digest'],
    releaseId: args['release-id'], gitSha: args['git-sha'] });
}

function verifyFinal(containers, args, targetSupported, imageId, sourceImageId) {
  verifyWorkerRuntimeIsolation(containers);
  verifyApiWorkersDisabled(containers, args, imageId, sourceImageId);
  const blue = exactlyOne(containers, 'order-worker-blue', false);
  const green = exactlyOne(containers, 'order-worker-green', false);
  const running = [blue, green].filter((item) => item && isRunning(item));
  if (!targetSupported) {
    if (args.action !== 'rollback' || running.length !== 0) throw new ContractError('rollback release without worker service requires zero running workers', EXIT.SINGLETON);
    return { targetService: null, workerContainerId: null, workerImageId: null, workerHealth: 'absent' };
  }
  const targetService = `order-worker-${args['target-slot']}`;
  const target = exactlyOne(containers, targetService, true);
  if (running.length !== 1 || running[0].service !== targetService || !isRunning(target) || healthStatus(target) !== 'healthy') {
    throw new ContractError('singleton readback did not prove exactly one healthy target worker', EXIT.SINGLETON);
  }
  if (target.image !== imageId) throw new ContractError('singleton worker image drifted from manifest-bound backend image', EXIT.IDENTITY);
  requireEnv(target, {
    BOOKING_RELEASE_ID: args['release-id'], BOOKING_GIT_SHA: args['git-sha'], BOOKING_MANIFEST_DIGEST: args['manifest-digest'],
    BOOKING_SLOT: args['target-slot'], BOOKING_RUNTIME_ROLE: 'worker', BOOKING_WORKERS_ENABLED: 'true', ORDER_OUTBOX_DISPATCH_ENABLED: 'true',
    TELEGRAM_BOT_MODE: 'polling', TELEGRAM_ENABLE_WEBHOOK: 'false', TELEGRAM_POLLING_DELETE_WEBHOOK_ON_STARTUP: 'false',
    BOOKING_TELEGRAM_EGRESS_REQUIRED: 'true', TELEGRAM_PROXY_URL: 'socks5h://telegram-egress:1080',
  });
  if (target.portBindings && Object.keys(target.portBindings).length > 0) throw new ContractError('singleton worker must not publish host ports', EXIT.IDENTITY);
  for (const bindings of Object.values(target.ports || {})) if (Array.isArray(bindings) && bindings.length > 0) throw new ContractError('singleton worker has a published port', EXIT.IDENTITY);
  return { targetService, workerContainerId: target.id, workerImageId: imageId, workerHealth: 'healthy' };
}

async function composeServices(docker, runner, options, composeFiles, controlEnvFile) {
  const result = await runner(docker, ['compose', '--env-file', controlEnvFile, '--project-name', PROJECT,
    ...composeFiles.flatMap((file) => ['--file', file]), 'config', '--services'], options);
  assertResult(result, 'cannot read singleton compose services');
  return new Set(result.stdout.trim().split(/\r?\n/).filter(Boolean));
}

async function canonicalEgressComposePath(path, releaseId, runtime) {
  if (releaseId === LEGACY_OLD_BINDING.releaseId) return null;
  if (!isAbsolute(path)) throw new ContractError('singleton Telegram egress Compose file must be absolute', EXIT.IDENTITY);
  const root = await realpath(runtime.releaseRoot || '/volume1/happybooking/booking-preprod/releases').catch(() => { throw new ContractError('release root cannot be resolved', EXIT.IDENTITY); });
  const file = await realpath(path).catch(() => { throw new ContractError('singleton Telegram egress Compose file cannot be resolved', EXIT.IDENTITY); });
  const expected = await realpath(resolve(root, releaseId, 'ops', 'compose', 'compose.preprod-telegram-egress.yml')).catch(() => {
    throw new ContractError('release-bound singleton Telegram egress Compose file cannot be resolved', EXIT.IDENTITY);
  });
  const containment = relative(root, file);
  const metadata = await stat(file);
  if (!containment || containment.startsWith('..') || isAbsolute(containment) || !metadata.isFile() || file !== expected) {
    throw new ContractError('singleton Telegram egress Compose file is not release-bound', EXIT.IDENTITY);
  }
  return file;
}

async function canonicalComposePath(path, releaseId, runtime) {
  if (!isAbsolute(path)) throw new ContractError('singleton compose file must be absolute', EXIT.IDENTITY);
  if (releaseId === LEGACY_OLD_BINDING.releaseId) {
    const file = await realpath(path).catch(() => { throw new ContractError('fixed legacy rollback compose cannot be resolved', EXIT.IDENTITY); });
    const expected = await realpath(runtime.legacyComposeFile || fileURLToPath(new URL('./legacy-preprod-rollback.compose.yml', import.meta.url))).catch(() => {
      throw new ContractError('fixed legacy rollback compose cannot be resolved', EXIT.IDENTITY);
    });
    const metadata = await stat(file);
    if (file !== expected || !metadata.isFile() || (process.platform !== 'win32' && (metadata.uid !== 0 || (metadata.mode & 0o022) !== 0)) ||
        await digestFile(file) !== LEGACY_OLD_BINDING.rollbackComposeDigest) {
      throw new ContractError('fixed legacy rollback compose identity is invalid', EXIT.IDENTITY);
    }
    return file;
  }
  const root = await realpath(runtime.releaseRoot || '/volume1/happybooking/booking-preprod/releases').catch(() => { throw new ContractError('release root cannot be resolved', EXIT.IDENTITY); });
  const file = await realpath(path).catch(() => { throw new ContractError('singleton compose file cannot be resolved', EXIT.IDENTITY); });
  const expected = await realpath(resolve(root, releaseId, 'ops', 'compose', 'compose.preprod.yml')).catch(() => {
    throw new ContractError('release-bound singleton compose file cannot be resolved', EXIT.IDENTITY);
  });
  const containment = relative(root, file);
  const metadata = await stat(file);
  if (!containment || containment.startsWith('..') || isAbsolute(containment) || !metadata.isFile() || file !== expected) throw new ContractError('singleton compose file is not the release-bound preproduction file', EXIT.IDENTITY);
  return file;
}

export async function runSingletonAction(args, runtime = {}) {
  validateArgs(args);
  const composeFile = await canonicalComposePath(args['compose-file'], args['release-id'], runtime);
  const egressComposeFile = await canonicalEgressComposePath(args['egress-compose-file'], args['release-id'], runtime);
  const composeFiles = [composeFile, ...(egressComposeFile ? [egressComposeFile] : [])];
  const docker = runtime.dockerExecutable || await executable(['/var/packages/ContainerManager/target/usr/bin/docker', '/usr/bin/docker']);
  const runner = runtime.commandRunner || defaultRunner;
  const controlEnvFile = runtime.controlEnvFile || '/etc/happybooking/secrets/booking-preprod-control-plane.env';
  if (!isAbsolute(controlEnvFile)) throw new ContractError('singleton Compose env file must be absolute', EXIT.IDENTITY);
  if (process.platform !== 'win32') {
    const canonicalEnv = await realpath(controlEnvFile).catch(() => { throw new ContractError('singleton Compose env file cannot be resolved', EXIT.IDENTITY); });
    const envMetadata = await stat(canonicalEnv);
    if (canonicalEnv !== controlEnvFile || !envMetadata.isFile() || envMetadata.uid !== 0 || (envMetadata.mode & 0o077) !== 0) {
      throw new ContractError('singleton Compose env file must be a root-only canonical regular file', EXIT.IDENTITY);
    }
  }
  const options = { cwd: dirname(composeFile), env: runtime.env || process.env, timeoutMs: runtime.timeoutMs || 120_000 };
  const services = await composeServices(docker, runner, options, composeFiles, controlEnvFile);
  const targetService = `order-worker-${args['target-slot']}`;
  const sourceService = `order-worker-${args['source-slot']}`;
  const targetSupported = services.has(targetService);
  if (!targetSupported && args.action !== 'rollback') throw new ContractError('candidate compose is missing the target singleton worker', EXIT.IDENTITY);
  const sourceImageId = await inspectSourceImage(docker, runner, options, args);
  const imageId = await inspectTargetImage(docker, runner, options, args);

  if (args.readback !== 'true') {
    let containers = await inspectProjectContainers(docker, runner, options);
    verifyWorkerRuntimeIsolation(containers);
    verifyApiWorkersDisabled(containers, args, imageId, sourceImageId);
    const target = exactlyOne(containers, targetService, false);
    const source = exactlyOne(containers, sourceService, false);
    if (target && isRunning(target) && source && isRunning(source)) throw new ContractError('two singleton workers are running', EXIT.SINGLETON);
    if (target && isRunning(target)) throw new ContractError('target singleton worker was already running before the fenced mutation', EXIT.SINGLETON);
    if (source && isRunning(source)) {
      const stopped = await runner(docker, ['container', 'stop', '--time', '30', source.id], options);
      assertResult(stopped, 'failed to stop source singleton worker');
    }
    containers = await inspectProjectContainers(docker, runner, options);
    verifyWorkerRuntimeIsolation(containers);
    const residual = exactlyOne(containers, sourceService, false);
    if (residual && isRunning(residual)) throw new ContractError('source singleton worker remains running after stop', EXIT.SINGLETON);
    if (containers.some((item) => item.service?.startsWith('order-worker-') && isRunning(item))) throw new ContractError('a worker remained running before target activation', EXIT.SINGLETON);
    if (targetSupported) {
      const started = await runner(docker, ['compose', '--env-file', controlEnvFile, '--project-name', PROJECT,
        ...composeFiles.flatMap((file) => ['--file', file]), 'up', '--no-build', '--no-deps', '--wait', targetService], options);
      assertResult(started, 'failed to start target singleton worker');
    }
  }

  const finalContainers = await inspectProjectContainers(docker, runner, options);
  const verification = verifyFinal(finalContainers, args, targetSupported, imageId, sourceImageId);
  return {
    schema: 'booking.singleton-transfer-readback/v1', project: PROJECT, action: args.action,
    releaseId: args['release-id'], gitSha: args['git-sha'], manifestDigest: args['manifest-digest'], targetSlot: args['target-slot'],
    sourceSlot: args['source-slot'], targetSupported, legacySourceNoOutbox: finalContainers.some((item) => item.service === `backend-${args['source-slot']}` &&
      !envMap(item.env, item.service).has('ORDER_OUTBOX_DISPATCH_ENABLED') && isExactLegacySource(args, item)),
    legacyTargetNoOutbox: finalContainers.some((item) => item.service === `backend-${args['target-slot']}` &&
      !envMap(item.env, item.service).has('ORDER_OUTBOX_DISPATCH_ENABLED') && isExactLegacyTarget(args, item)),
    ...verification, observedAt: new Date(runtime.nowMs ?? Date.now()).toISOString(),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runSingletonAction(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const failure = error instanceof ContractError ? error : new ContractError('unexpected singleton transfer failure', EXIT.SINGLETON);
    process.stderr.write(`${JSON.stringify({ schema: 'booking.singleton-transfer-error/v1', status: 'fail', code: 'SINGLETON_TRANSFER_REJECTED', detail: failure.message })}\n`);
    process.exitCode = failure.exitCode;
  }
}
