#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ContractError, EXIT, gateResult, parseArgs } from './lib/contracts.mjs';
import { canonicalStatePath, recoverStaleDeployStateLock } from './lib/deploy-state-store.mjs';
import { recoverStaleResourceLocks } from './lib/fenced-resource-store.mjs';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ALLOWED = new Set(['action', 'execute', 'environment', 'project', 'expected-state-digest', 'expected-lock-digest', 'resource-id']);
const DOCKER = '/var/packages/ContainerManager/target/usr/bin/docker';
const CONTROL_CONTAINER_NAME = 'booking-preprod-control-plane';

function validate(args) {
  for (const key of Object.keys(args)) if (!ALLOWED.has(key)) throw new ContractError(`unsupported argument: --${key}`, EXIT.IDENTITY);
  if (args.execute !== 'true' || args.environment !== 'preprod' || args.project !== 'booking-preprod' ||
      !['recover-deploy-lock', 'recover-resource-lock'].includes(args.action) ||
      !DIGEST.test(args['expected-state-digest'] || '') || !DIGEST.test(args['expected-lock-digest'] || '')) {
    throw new ContractError('stale lock recovery arguments are incomplete or outside preproduction', EXIT.IDENTITY);
  }
  if (args.action === 'recover-resource-lock' && !IDENTIFIER.test(args['resource-id'] || '')) {
    throw new ContractError('--resource-id is required for resource lock recovery', EXIT.IDENTITY);
  }
  if (args.action === 'recover-deploy-lock' && args['resource-id'] !== undefined) {
    throw new ContractError('--resource-id is forbidden for deployment lock recovery', EXIT.IDENTITY);
  }
}

function runDocker(argv, runtime) {
  const executable = runtime.dockerExecutable || DOCKER;
  const runner = runtime.commandRunner || ((file, args) => new Promise((resolvePromise) => {
    const child = spawn(file, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { if (stdout.length < 16_384) stdout += chunk; });
    child.stderr.on('data', (chunk) => { if (stderr.length < 16_384) stderr += chunk; });
    child.on('error', () => resolvePromise({ exitCode: -1, stdout, stderr }));
    child.on('close', (exitCode) => resolvePromise({ exitCode, stdout, stderr }));
  }));
  return runner(executable, argv);
}

async function dockerOwnerProbe(containerId, ownerContainerName, runtime) {
  if (!/^[0-9a-f]{12,64}$/.test(containerId || '')) throw new ContractError('lock owner container ID is invalid', EXIT.IDENTITY);
  if (ownerContainerName !== CONTROL_CONTAINER_NAME) throw new ContractError('lock owner container name is invalid', EXIT.IDENTITY);
  const inspectArgv = (target) => ['container', 'inspect', '--format',
    '{"Id":{{json .Id}},"Name":{{json .Name}},"Running":{{json .State.Running}}}', target];
  const parseOwner = (result, target) => {
    if (result.exitCode !== 0) return null;
    let value;
    try { value = JSON.parse(String(result.stdout || '').trim()); }
    catch { throw new ContractError(`Docker owner inspect for ${target} is malformed`, EXIT.IDENTITY); }
    if (!/^[0-9a-f]{64}$/.test(value?.Id || '') || value.Name !== `/${CONTROL_CONTAINER_NAME}` ||
        typeof value.Running !== 'boolean') {
      throw new ContractError('Docker lock owner does not match the fixed control-plane identity', EXIT.IDENTITY);
    }
    return value;
  };
  const first = await runDocker(inspectArgv(containerId), runtime);
  const owner = parseOwner(first, containerId);
  if (owner) {
    if (!owner.Id.startsWith(containerId)) throw new ContractError('Docker lock owner ID does not match its recorded HOSTNAME ID', EXIT.IDENTITY);
    return owner.Running;
  }
  const daemon = await runDocker(['info', '--format', '{{.ServerVersion}}'], runtime);
  if (daemon.exitCode !== 0 || !String(daemon.stdout || '').trim()) {
    throw new ContractError('Docker daemon cannot prove stale lock owner absence', EXIT.SINGLETON);
  }
  const namedResult = await runDocker(inspectArgv(CONTROL_CONTAINER_NAME), runtime);
  const named = parseOwner(namedResult, CONTROL_CONTAINER_NAME);
  if (named) {
    if (!named.Id.startsWith(containerId)) {
      throw new ContractError('fixed control-plane name resolves to a different container ID', EXIT.IDENTITY);
    }
    return named.Running;
  }
  const second = await runDocker(inspectArgv(containerId), runtime);
  const rechecked = parseOwner(second, containerId);
  if (!rechecked) return false;
  if (!rechecked.Id.startsWith(containerId)) throw new ContractError('Docker lock owner ID changed during recovery', EXIT.IDENTITY);
  return rechecked.Running;
}

export async function runStaleFencingLockRecovery(args, runtime = {}) {
  validate(args);
  const statePath = await canonicalStatePath({ environment: args.environment, project: args.project,
    deployStateRoot: runtime.deployStateRoot });
  const options = { expectedStateDigest: args['expected-state-digest'], expectedLockDigest: args['expected-lock-digest'],
    nowMs: runtime.nowMs === undefined ? Date.now() : runtime.nowMs,
    ownerContainerProbe: (containerId, ownerContainerName) => dockerOwnerProbe(containerId, ownerContainerName, runtime) };
  return args.action === 'recover-deploy-lock'
    ? recoverStaleDeployStateLock(statePath, options)
    : recoverStaleResourceLocks(statePath, [{ resourceId: args['resource-id'], lockDigest: args['expected-lock-digest'] }], options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let exitCode = EXIT.PASS; let output;
  try {
    const receipt = await runStaleFencingLockRecovery(parseArgs(process.argv.slice(2)));
    output = gateResult({ gate: 'stale-fencing-lock-recovery', checks: [{ name: receipt.kind, status: 'pass',
      code: 'STALE_LOCK_RECOVERED', detail: `receipt=${receipt.receiptDigest}` }] });
  } catch (error) {
    const failure = error instanceof ContractError ? error : new ContractError('unexpected stale lock recovery failure', EXIT.SINGLETON);
    exitCode = failure.exitCode;
    output = gateResult({ gate: 'stale-fencing-lock-recovery', checks: [{ name: 'recovery', status: 'fail',
      code: 'STALE_LOCK_RECOVERY_REJECTED', detail: failure.message }] });
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = exitCode;
}
