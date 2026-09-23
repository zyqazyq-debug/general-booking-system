import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { assertCandidateRollbackCompatibility, LEGACY_SUPPORTING_INSPECT_FORMAT, runFencedAction, verifyLegacyActiveRuntimeInspect,
  verifyLegacyDockerStartOutput, verifyLegacyNetworkTopology } from '../release/execute-fenced-action.mjs';
import { canonicalStatePath, initializeStateFile, mutateStateFile } from '../release/lib/deploy-state-store.mjs';
import { resourceDirectory } from '../release/lib/fenced-resource-store.mjs';
import { acquireLease, initialDeployState, takeoverExpiredLease, transitionDeployState } from '../release/lib/state-machine.mjs';
import { sha256 } from '../release/lib/contracts.mjs';

const ACTIVE = { slot: 'green', releaseId: 'booking-20260908T120000Z-aaaaaaa', gitSha: 'a'.repeat(40), manifestDigest: `sha256:${'a'.repeat(64)}` };
const CANDIDATE = { slot: 'blue', releaseId: 'booking-20260910T120000Z-bbbbbbb', gitSha: 'b'.repeat(40), manifestDigest: `sha256:${'b'.repeat(64)}` };
const RESOURCES = { edgeNetwork: 'booking-preprod-edge', dataNetwork: 'booking-preprod-data',
  databaseRef: 'database:booking-preprod', ingressRef: 'ingress:booking-preprod' };

function failedFenceThree() {
  let state = initialDeployState({ environment: 'preprod', project: 'booking-preprod', resources: RESOURCES,
    active: ACTIVE, runtimeEnvDigest: sha256('fixture\n') }, '2026-09-10T10:00:00.000Z');
  state = acquireLease(state, { expectedGeneration: 0, expectedFencingEpoch: 0, candidate: CANDIDATE,
    operationId: 'op-active-recovery', approvalId: 'approval-f1', leaseId: 'lease-f1', holderId: 'holder',
    now: '2026-09-10T10:01:00.000Z', expiresAt: '2026-09-10T10:02:00.000Z', observationWindowMinutes: 1 });
  state = transitionDeployState(state, { expectedGeneration: 1, expectedFencingEpoch: 1, leaseId: 'lease-f1', holderId: 'holder',
    now: '2026-09-10T10:01:10.000Z', to: 'FAILED' });
  state = takeoverExpiredLease(state, { expectedGeneration: 2, expectedFencingEpoch: 1, approvalId: 'approval-f2',
    leaseId: 'lease-f2', holderId: 'holder', now: '2026-09-10T10:03:00.000Z', expiresAt: '2026-09-10T10:04:00.000Z' });
  return takeoverExpiredLease(state, { expectedGeneration: 3, expectedFencingEpoch: 2, approvalId: 'approval-f3',
    leaseId: 'lease-f3', holderId: 'holder', now: '2026-09-10T10:05:00.000Z', expiresAt: '2026-09-10T10:06:00.000Z' });
}

test('failed legacy active equal to rollback is not mistaken for the promoted candidate', () => {
  const legacyManifest = { contracts: { rollbackCompatibleRelease: null } };
  assert.doesNotThrow(() => assertCandidateRollbackCompatibility({ active: ACTIVE, rollback: ACTIVE, candidate: CANDIDATE },
    ACTIVE, legacyManifest));
  assert.throws(() => assertCandidateRollbackCompatibility({ active: ACTIVE, rollback: ACTIVE, candidate: CANDIDATE },
    CANDIDATE, legacyManifest), /canonical rollback target release/);
  assert.throws(() => assertCandidateRollbackCompatibility({ active: CANDIDATE, rollback: ACTIVE, candidate: null },
    CANDIDATE, legacyManifest), /canonical rollback target release/);
});

function args(state, actionId) {
  return { action: 'preprod-restore-active-runtime', execute: 'true', environment: 'preprod', project: 'booking-preprod',
    'approval-id': state.approvalId, 'expected-generation': String(state.generation),
    'expected-fencing-epoch': String(state.fencingEpoch), 'manifest-digest': ACTIVE.manifestDigest,
    'operation-id': state.operationId, 'lease-id': state.lease.leaseId, 'holder-id': state.lease.holderId,
    'resource-id': RESOURCES.edgeNetwork, 'action-id': actionId };
}

function resourceState(resourceId, state, receiptChainHead) {
  return { schema: 'booking.fenced-resource/v1', environment: 'preprod', project: 'booking-preprod', resourceId,
    highestAcceptedFencingEpoch: 2, operationId: state.operationId, manifestDigest: CANDIDATE.manifestDigest,
    pendingAction: null, receiptChainHead, updatedAt: '2026-09-10T10:04:00.000Z' };
}

async function installActiveRecoveryFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'booking-active-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const statePath = await canonicalStatePath({ environment: 'preprod', project: 'booking-preprod', deployStateRoot: root });
  const state = failedFenceThree();
  await initializeStateFile(statePath, state);
  const resourceIds = [...Object.values(RESOURCES), 'telegram:booking-preprod'];
  for (const resourceId of resourceIds) {
    const path = join(resourceDirectory(statePath, resourceId), 'resource-state.json');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(resourceState(resourceId, state,
      [RESOURCES.databaseRef, RESOURCES.dataNetwork].includes(resourceId) ? `sha256:${'d'.repeat(64)}` :
        resourceId === 'telegram:booking-preprod' ? `sha256:${'e'.repeat(64)}` : null))}\n`);
  }
  return { root, statePath, state, resourceIds };
}

function recoverableRuntimePlan(snapshot) {
  return () => ({ executable: '/trusted/docker', argv: ['start', 'fixed-backend', 'fixed-gateway'], cwd: '/trusted',
    preflightArtifacts: async () => ({ containers: structuredClone(snapshot) }),
    replayPreflightArtifacts: async () => ({ containers: structuredClone(snapshot) }),
    readback: { executable: '/trusted/docker', argv: ['container', 'inspect', 'fixed-backend', 'fixed-gateway'],
      verify: () => ({ fixedLegacyRuntime: true }) } });
}

function registryBoundPlan(builder) {
  return (state) => {
    const registrySupplyChainBinding = { schema: 'booking.registry-runtime-gate/v1',
      operationId: state.operationId, fencingEpoch: state.fencingEpoch,
      components: { backend: { digest: `sha256:${'c'.repeat(64)}` } } };
    return { ...builder(state), registrySupplyChainBinding,
      environmentBinding: { BOOKING_REGISTRY_SUPPLY_CHAIN_DIGEST: sha256(registrySupplyChainBinding) } };
  };
}

function legacyNetworkFixture(binding, fixedContainers = { backend: { running: true }, gateway: { running: true } },
  includeRogue = false) {
  const postgresId = '7'.repeat(64);
  const redisId = '8'.repeat(64);
  const cloudflaredId = '9'.repeat(64);
  const edgeContainers = { [cloudflaredId]: { Name: binding.cloudflared.name } };
  if (fixedContainers.backend.running) edgeContainers[binding.backend.id] = { Name: 'booking-preprod-backend-green-1' };
  if (fixedContainers.gateway.running) edgeContainers[binding.gateway.id] = { Name: 'booking-preprod-gateway-green-1' };
  if (includeRogue) edgeContainers['a'.repeat(64)] = { Name: 'rogue-no-project-label' };
  const dataContainers = {
    [postgresId]: { Name: 'booking-preprod-postgres-1' },
    [redisId]: { Name: 'booking-preprod-redis-1' },
  };
  if (fixedContainers.backend.running) dataContainers[binding.backend.id] = { Name: 'booking-preprod-backend-green-1' };
  const networks = [
    { Name: RESOURCES.edgeNetwork, Containers: edgeContainers },
    { Name: RESOURCES.dataNetwork, Containers: dataContainers },
  ];
  const dataContainer = (id, service) => ({ Id: id, Name: `/booking-preprod-${service}-1`, Running: true,
    Labels: { 'com.docker.compose.project': 'booking-preprod', 'com.docker.compose.service': service },
    Networks: { [RESOURCES.dataNetwork]: { Aliases: [`booking-preprod-${service}-1`, service, id.slice(0, 12)] } } });
  const cloudflared = { Id: cloudflaredId, Name: `/${binding.cloudflared.name}`, Image: binding.cloudflared.imageId,
    ConfigImage: binding.cloudflared.image, User: binding.cloudflared.user, Running: true, PortBindings: {}, Labels: null,
    ReadonlyRootfs: true, Privileged: false, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'],
    Cmd: binding.cloudflared.cmd || ['tunnel', '--no-autoupdate', 'run', '--token-file', '/run/secrets/tunnel-token'],
    Mounts: [{ Type: 'bind', Source: '/etc/happybooking/secrets/cloudflare-preprod-tunnel-token',
      Destination: '/run/secrets/tunnel-token', RW: false, Propagation: 'rprivate' }],
    Networks: { [RESOURCES.edgeNetwork]: { Aliases: [cloudflaredId.slice(0, 12)] } } };
  return { networks, supportingContainers: [dataContainer(postgresId, 'postgres'), dataContainer(redisId, 'redis'), cloudflared] };
}

test('rogue legacy network endpoint is rejected before docker start or resource fencing mutation', async (t) => {
  const fixture = await installActiveRecoveryFixture(t);
  const binding = {
    backend: { id: '1'.repeat(64), service: 'backend-green' },
    gateway: { id: '4'.repeat(64), service: 'gateway-green' },
    cloudflared: { name: 'booking-preprod-cloudflared', imageId: `sha256:${'5'.repeat(64)}`,
      image: `cloudflare/cloudflared@sha256:${'6'.repeat(64)}`, user: '65532:65532' },
  };
  const fixedContainers = { backend: { running: false }, gateway: { running: false } };
  const topology = legacyNetworkFixture(binding, fixedContainers, true);
  const basePlan = recoverableRuntimePlan({ backend: { running: false }, gateway: { running: false } })();
  const planBuilder = () => ({ ...basePlan, preflightArtifacts: async () =>
    verifyLegacyNetworkTopology(JSON.stringify(topology.networks), JSON.stringify(topology.supportingContainers),
      { project: 'booking-preprod', resources: RESOURCES }, fixedContainers, binding) });
  let mutations = 0;
  await assert.rejects(runFencedAction(args(fixture.state, 'restore-network-rogue'), { deployStateRoot: fixture.root,
    now: () => new Date('2026-09-10T10:05:30.000Z'), planBuilder,
    commandRunner: async () => { mutations += 1;
      return { exitCode: 0, signal: null, overflow: false, stdout: '', stderr: '' }; },
    failedRestoreBinding: { operationId: fixture.state.operationId } }), /endpoint membership drifted/);
  assert.equal(mutations, 0);
  for (const resourceId of fixture.resourceIds) {
    const value = JSON.parse(await readFile(join(resourceDirectory(fixture.statePath, resourceId), 'resource-state.json'), 'utf8'));
    assert.equal(value.highestAcceptedFencingEpoch, 2);
    assert.equal(value.pendingAction, null);
  }
});

test('same fence retries fixed docker start when all resources became pending before execution completed', async (t) => {
  const fixture = await installActiveRecoveryFixture(t);
  const snapshot = { backend: { running: false }, gateway: { running: false } };
  const planBuilder = recoverableRuntimePlan(snapshot);
  const action = args(fixture.state, 'restore-f3');
  const resourceIds = [RESOURCES.edgeNetwork, RESOURCES.dataNetwork, RESOURCES.databaseRef,
    'telegram:booking-preprod', RESOURCES.ingressRef];
  const plan = planBuilder();
  const commandDigest = sha256({ executable: plan.executable, argv: plan.argv, cwd: plan.cwd,
    preflight: null, readback: { executable: plan.readback.executable, argv: plan.readback.argv },
    readbackFromExecution: false, artifactBinding: null, environmentBinding: null, registrySupplyChainBinding: null });
  const request = { schema: 'booking.fenced-action-request/v2', environment: 'preprod', project: 'booking-preprod',
    action: action.action, actionId: action['action-id'], operationId: fixture.state.operationId,
    approvalId: fixture.state.approvalId, generation: fixture.state.generation, fencingEpoch: fixture.state.fencingEpoch,
    leaseId: fixture.state.lease.leaseId, holderId: fixture.state.lease.holderId, manifestDigest: ACTIVE.manifestDigest,
    releaseIdentity: ACTIVE, resourceIds, runtimeEnvDigest: fixture.state.runtimeEnvDigest, commandDigest };
  const pendingAction = { actionId: action['action-id'], requestDigest: sha256(request), action: action.action,
    approvalId: fixture.state.approvalId, leaseId: fixture.state.lease.leaseId, holderId: fixture.state.lease.holderId,
    generation: fixture.state.generation, fencingEpoch: fixture.state.fencingEpoch, commandDigest };
  for (const resourceId of resourceIds) {
    const path = join(resourceDirectory(fixture.statePath, resourceId), 'resource-state.json');
    const value = JSON.parse(await readFile(path, 'utf8'));
    value.highestAcceptedFencingEpoch = fixture.state.fencingEpoch;
    value.manifestDigest = ACTIVE.manifestDigest;
    value.pendingAction = pendingAction;
    await writeFile(path, `${JSON.stringify(value)}\n`);
  }
  const observedCommands = [];
  const receipt = await runFencedAction(action, { deployStateRoot: fixture.root,
    now: () => new Date('2026-09-10T10:05:40.000Z'), planBuilder,
    commandRunner: async (executable, argv) => { observedCommands.push([executable, argv]);
      return { exitCode: 0, signal: null, overflow: false, stdout: '', stderr: '' }; },
    failedRestoreBinding: { operationId: fixture.state.operationId } });
  assert.deepEqual(observedCommands.map(([, argv]) => argv), [
    ['start', 'fixed-backend', 'fixed-gateway'],
    ['container', 'inspect', 'fixed-backend', 'fixed-gateway'],
  ]);
  assert.equal(receipt.verification.adoption.mode, 'fixed-container-idempotent-start-retried');
  for (const resourceId of fixture.resourceIds) {
    const value = JSON.parse(await readFile(join(resourceDirectory(fixture.statePath, resourceId), 'resource-state.json'), 'utf8'));
    assert.equal(value.pendingAction, null);
    assert.equal(value.receiptChainHead, receipt.receiptDigest);
  }
});

test('failed active restore replays a dispatched action group with pending predecessor heads', async (t) => {
  const fixture = await installActiveRecoveryFixture(t);
  const action = args(fixture.state, 'restore-group-f3');
  let desired = false;
  let starts = 0;
  let replayContext;
  const planBuilder = () => ({ executable: '/trusted/docker', argv: ['start', 'fixed-backend', 'fixed-gateway'], cwd: '/trusted',
    preflightArtifacts: async () => ({ containers: { backend: { running: false }, gateway: { running: false } } }),
    replayPreflightArtifacts: async (context) => {
      replayContext = context;
      if (!context.recoveryPending || context.adoptionReceipt !== null) throw new Error('pending recovery context is invalid');
      return { containers: { backend: { running: true }, gateway: { running: true } } };
    },
    readback: { executable: '/trusted/docker', argv: ['container', 'inspect', 'fixed-backend', 'fixed-gateway'],
      verify: () => {
        if (!desired) throw new Error('runtime not healthy yet');
        return { fixedLegacyRuntime: true };
      } } });
  const runner = async (_executable, argv) => {
    if (argv[0] === 'start') starts += 1;
    return { exitCode: 0, signal: null, overflow: false, stdout: '', stderr: '' };
  };
  await assert.rejects(runFencedAction(action, { deployStateRoot: fixture.root,
    now: () => new Date('2026-09-10T10:05:30.000Z'), planBuilder, commandRunner: runner,
    failedRestoreBinding: { operationId: fixture.state.operationId } }), /runtime not healthy yet/);
  desired = true;
  const recovered = await runFencedAction(action, { deployStateRoot: fixture.root,
    now: () => new Date('2026-09-10T10:05:40.000Z'), planBuilder, commandRunner: runner,
    failedRestoreBinding: { operationId: fixture.state.operationId } });
  assert.equal(starts, 1);
  assert.equal(recovered.status, 'pass');
  assert.equal(recovered.verification.reconcile.mode, 'same-fence-proven-applied-read-only');
  assert.equal(replayContext.recoveryPending, true);
  for (const resourceId of fixture.resourceIds) {
    const value = JSON.parse(await readFile(join(resourceDirectory(fixture.statePath, resourceId), 'resource-state.json'), 'utf8'));
    assert.equal(value.pendingAction, null);
    assert.equal(value.receiptChainHead, recovered.receiptDigest);
  }
});

test('takeover retries both fixed IDs idempotently after only one legacy container started', async (t) => {
  const fixture = await installActiveRecoveryFixture(t);
  const snapshot = { backend: { running: false }, gateway: { running: false } };
  const planBuilder = registryBoundPlan(recoverableRuntimePlan(snapshot));
  let calls = 0;
  await assert.rejects(runFencedAction(args(fixture.state, 'restore-f3'), { deployStateRoot: fixture.root,
    now: () => new Date('2026-09-10T10:05:30.000Z'), planBuilder,
    commandRunner: async () => ({ exitCode: ++calls === 1 ? 0 : 1, signal: null, overflow: false, stdout: '', stderr: '' }),
    failedRestoreBinding: { operationId: fixture.state.operationId } }), /external action failed/);
  assert.equal(calls, 2);
  snapshot.backend.running = true;
  const stateFour = await mutateStateFile(fixture.statePath, (current) => takeoverExpiredLease(current, {
    expectedGeneration: current.generation, expectedFencingEpoch: 3, approvalId: 'approval-f4', leaseId: 'lease-f4',
    holderId: 'holder', now: '2026-09-10T10:07:00.000Z', expiresAt: '2026-09-10T10:08:00.000Z',
  }));
  const observedCommands = [];
  const receipt = await runFencedAction(args(stateFour, 'restore-f4'), { deployStateRoot: fixture.root,
    now: () => new Date('2026-09-10T10:07:30.000Z'), planBuilder,
    commandRunner: async (executable, argv) => { observedCommands.push([executable, argv]);
      return { exitCode: 0, signal: null, overflow: false, stdout: '', stderr: '' }; },
    failedRestoreBinding: { operationId: stateFour.operationId } });
  assert.deepEqual(observedCommands.map(([, argv]) => argv), [
    ['start', 'fixed-backend', 'fixed-gateway'],
    ['container', 'inspect', 'fixed-backend', 'fixed-gateway'],
  ]);
  assert.equal(receipt.verification.adoption.mode, 'fixed-container-idempotent-start-retried');
  assert.equal(receipt.verification.adoption.priorFencingEpoch, 3);
});

test('fence 4 re-attests a fence 3 started active restore without executing docker start again', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'booking-active-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const statePath = await canonicalStatePath({ environment: 'preprod', project: 'booking-preprod', deployStateRoot: root });
  const stateThree = failedFenceThree();
  await initializeStateFile(statePath, stateThree);
  const ids = [...Object.values(RESOURCES), 'telegram:booking-preprod'];
  for (const resourceId of ids) {
    const path = join(resourceDirectory(statePath, resourceId), 'resource-state.json');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(resourceState(resourceId, stateThree,
      [RESOURCES.databaseRef, RESOURCES.dataNetwork].includes(resourceId) ? `sha256:${'d'.repeat(64)}` :
        resourceId === 'telegram:booking-preprod' ? `sha256:${'e'.repeat(64)}` : null))}\n`);
  }
  const planBuilder = registryBoundPlan(() => ({ executable: '/trusted/docker', argv: ['start', 'fixed-backend', 'fixed-gateway'], cwd: '/trusted',
    readback: { executable: '/trusted/docker', argv: ['container', 'inspect', 'fixed-backend', 'fixed-gateway'],
      verify: () => ({ fixedLegacyRuntime: true }) } }));
  let calls = 0;
  await assert.rejects(runFencedAction(args(stateThree, 'restore-f3'), { deployStateRoot: root,
    now: () => new Date('2026-09-10T10:05:30.000Z'), planBuilder,
    commandRunner: async () => ({ exitCode: ++calls === 1 ? 0 : 1, signal: null, overflow: false, stdout: '', stderr: '' }),
    failedRestoreBinding: { operationId: stateThree.operationId } }), /external action failed/);
  assert.equal(calls, 2);
  for (const resourceId of ids) {
    const value = JSON.parse(await readFile(join(resourceDirectory(statePath, resourceId), 'resource-state.json'), 'utf8'));
    assert.equal(value.highestAcceptedFencingEpoch, 3);
    assert.equal(value.pendingAction.action, 'preprod-restore-active-runtime');
  }
  const stateFour = await mutateStateFile(statePath, (current) => takeoverExpiredLease(current, {
    expectedGeneration: current.generation, expectedFencingEpoch: 3, approvalId: 'approval-f4', leaseId: 'lease-f4',
    holderId: 'holder', now: '2026-09-10T10:07:00.000Z', expiresAt: '2026-09-10T10:08:00.000Z',
  }));
  const observedCommands = [];
  const receipt = await runFencedAction(args(stateFour, 'restore-f4'), { deployStateRoot: root,
    now: () => new Date('2026-09-10T10:07:30.000Z'), planBuilder,
    commandRunner: async (executable, argv) => { observedCommands.push([executable, argv]);
      return { exitCode: 0, signal: null, overflow: false, stdout: '{}', stderr: '' }; },
    failedRestoreBinding: { operationId: stateFour.operationId } });
  assert.equal(receipt.fencingEpoch, 4);
  assert.equal(receipt.verification.adoption.mode, 'prior-pending-proven-applied-read-only');
  assert.equal(observedCommands.length, 1);
  assert.deepEqual(observedCommands[0][1], ['container', 'inspect', 'fixed-backend', 'fixed-gateway']);
  for (const resourceId of ids) {
    const value = JSON.parse(await readFile(join(resourceDirectory(statePath, resourceId), 'resource-state.json'), 'utf8'));
    assert.equal(value.highestAcceptedFencingEpoch, 4);
    assert.equal(value.pendingAction, null);
    assert.equal(value.receiptChainHead, receipt.receiptDigest);
  }
});

test('fixed legacy runtime inspect binds exact containers, security configuration, networks, and loopback port', () => {
  const binding = {
    backend: { id: '1'.repeat(64), imageId: `sha256:${'2'.repeat(64)}`, image: 'backend:legacy', service: 'backend-green', configHash: '3'.repeat(64) },
    gateway: { id: '4'.repeat(64), imageId: `sha256:${'5'.repeat(64)}`, image: 'gateway:legacy', service: 'gateway-green', configHash: '6'.repeat(64) },
    cloudflared: { name: 'booking-preprod-cloudflared', imageId: `sha256:${'7'.repeat(64)}`,
      image: `cloudflare/cloudflared@sha256:${'8'.repeat(64)}`, user: '65532:65532' },
    nginx: { source: '/fixed/nginx.conf', destination: '/etc/nginx/conf.d/default.conf' },
  };
  const container = (component) => {
    const expected = binding[component];
    const backend = component === 'backend';
    const composeName = `booking-preprod-${expected.service}-1`;
    const aliases = [composeName, expected.service, ...(backend ? [] : [expected.service]), expected.id.slice(0, 12)];
    return { Id: expected.id, Name: `/booking-preprod-${expected.service}-1`, Image: expected.imageId,
      State: { Running: true, Health: { Status: 'healthy' } }, Config: { Image: expected.image, User: backend ? '' : '101',
        Labels: { 'com.docker.compose.project': 'booking-preprod', 'com.docker.compose.service': expected.service,
          'com.docker.compose.config-hash': expected.configHash },
        Env: backend ? ['TELEGRAM_BOT_MODE=polling', 'TELEGRAM_ENABLE_WEBHOOK=false'] : [] },
      HostConfig: { ReadonlyRootfs: true, Privileged: false, CapDrop: ['ALL'], CapAdd: backend ? null : ['NET_BIND_SERVICE'],
        SecurityOpt: ['no-new-privileges:true'], PidMode: '', IpcMode: 'private', Devices: null,
        PortBindings: backend ? {} : { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '18082' }] } },
      Mounts: backend ? [] : [
        { Type: 'tmpfs', Destination: '/tmp', RW: true },
        { Type: 'bind', Source: binding.nginx.source, Destination: binding.nginx.destination, RW: false, Propagation: 'rprivate' },
        { Type: 'tmpfs', Destination: '/var/cache/nginx', RW: true },
        { Type: 'tmpfs', Destination: '/var/run', RW: true },
      ], NetworkSettings: { Networks: backend ? {
        'booking-preprod-data': { Aliases: [...aliases] }, 'booking-preprod-edge': { Aliases: [...aliases] },
      } : { 'booking-preprod-edge': { Aliases: [...aliases] } } } };
  };
  const values = [container('backend'), container('gateway')];
  const verified = verifyLegacyActiveRuntimeInspect(JSON.stringify(values), { project: 'booking-preprod', resources: RESOURCES }, binding);
  assert.equal(verified.gateway.health, 'healthy');
  values[0].State.Running = false;
  values[0].State.Health.Status = 'unhealthy';
  const partial = verifyLegacyActiveRuntimeInspect(JSON.stringify(values),
    { project: 'booking-preprod', resources: RESOURCES }, binding, false, true);
  assert.equal(partial.backend.running, false);
  assert.equal(partial.gateway.running, true);
  assert.throws(() => verifyLegacyActiveRuntimeInspect(JSON.stringify(values),
    { project: 'booking-preprod', resources: RESOURCES }, binding, false), /identity or isolation drifted/);
  values[0].State.Running = true;
  values[0].State.Health.Status = 'healthy';
  values[0].NetworkSettings.Networks['booking-preprod-data'].Aliases.push('rogue-alias');
  assert.throws(() => verifyLegacyActiveRuntimeInspect(JSON.stringify(values),
    { project: 'booking-preprod', resources: RESOURCES }, binding), /network alias drifted/);
  values[0].NetworkSettings.Networks['booking-preprod-data'].Aliases.pop();
  values[1].NetworkSettings.Networks['booking-preprod-edge'].Aliases.splice(2, 1);
  assert.throws(() => verifyLegacyActiveRuntimeInspect(JSON.stringify(values),
    { project: 'booking-preprod', resources: RESOURCES }, binding), /network alias drifted/,
  'gateway duplicate business-alias count is part of the frozen legacy multiset');
  values[1].NetworkSettings.Networks['booking-preprod-edge'].Aliases.splice(2, 0, 'gateway-green');
  values[0].NetworkSettings.Networks['booking-preprod-edge'].Aliases.pop();
  assert.throws(() => verifyLegacyActiveRuntimeInspect(JSON.stringify(values),
    { project: 'booking-preprod', resources: RESOURCES }, binding), /network alias drifted/,
  'Compose short container ID is required');
  values[0].NetworkSettings.Networks['booking-preprod-edge'].Aliases.push(binding.backend.id.slice(0, 12));
  values[1].Config.Labels['com.docker.compose.config-hash'] = 'drift';
  assert.throws(() => verifyLegacyActiveRuntimeInspect(JSON.stringify(values), { project: 'booking-preprod', resources: RESOURCES }, binding), /identity or isolation drifted/);
  assert.deepEqual(verifyLegacyDockerStartOutput(`${binding.backend.id}\nbooking-preprod-gateway-green-1\n`, binding),
    { startedExistingContainerIds: [binding.backend.id, binding.gateway.id] });
  assert.throws(() => verifyLegacyDockerStartOutput(`${binding.backend.id}\n${binding.backend.id}\n`, binding),
    /exactly the two fixed legacy containers/);
  for (const fixedContainers of [
    { backend: { running: false }, gateway: { running: false } },
    { backend: { running: true }, gateway: { running: false } },
    { backend: { running: false }, gateway: { running: true } },
    { backend: { running: true }, gateway: { running: true } },
  ]) {
    const topology = legacyNetworkFixture(binding, fixedContainers);
    assert.equal(verifyLegacyNetworkTopology(JSON.stringify(topology.networks), JSON.stringify(topology.supportingContainers),
      { project: 'booking-preprod', resources: RESOURCES }, fixedContainers, binding).networks.length, 2);
  }
  const stopped = { backend: { running: false }, gateway: { running: false } };
  const topology = legacyNetworkFixture(binding, stopped);
  topology.supportingContainers[0].Networks['booking-preprod-data'].Aliases.push('rogue-alias');
  assert.throws(() => verifyLegacyNetworkTopology(JSON.stringify(topology.networks), JSON.stringify(topology.supportingContainers),
    { project: 'booking-preprod', resources: RESOURCES }, stopped, binding), /aliases or ownership drifted/);
  for (const serviceIndex of [0, 1]) {
    for (const mutate of [
      (aliases) => aliases.pop(),
      (aliases) => aliases.push(aliases[1]),
    ]) {
      const drifted = legacyNetworkFixture(binding, stopped);
      mutate(drifted.supportingContainers[serviceIndex].Networks['booking-preprod-data'].Aliases);
      assert.throws(() => verifyLegacyNetworkTopology(JSON.stringify(drifted.networks),
        JSON.stringify(drifted.supportingContainers), { project: 'booking-preprod', resources: RESOURCES }, stopped, binding),
      /aliases or ownership drifted/);
    }
  }
  const wrongCommand = legacyNetworkFixture(binding, stopped);
  wrongCommand.supportingContainers[2].Cmd = ['tunnel', '--no-autoupdate', '--token-file', '/run/secrets/tunnel-token', 'run'];
  assert.throws(() => verifyLegacyNetworkTopology(JSON.stringify(wrongCommand.networks),
    JSON.stringify(wrongCommand.supportingContainers), { project: 'booking-preprod', resources: RESOURCES }, stopped, binding),
  /cloudflared identity, network, alias, or port binding drifted/);
});

test('legacy topology rejects phase disagreement and cloudflared identity or isolation drift', () => {
  const binding = {
    backend: { id: '1'.repeat(64), service: 'backend-green' },
    gateway: { id: '4'.repeat(64), service: 'gateway-green' },
    cloudflared: { name: 'booking-preprod-cloudflared', imageId: `sha256:${'5'.repeat(64)}`,
      image: `cloudflare/cloudflared@sha256:${'6'.repeat(64)}`, user: '65532:65532' },
  };
  const state = { project: 'booking-preprod', resources: RESOURCES };
  const stopped = { backend: { running: false }, gateway: { running: false } };
  const running = { backend: { running: true }, gateway: { running: true } };
  const stoppedTopology = legacyNetworkFixture(binding, stopped);
  assert.throws(() => verifyLegacyNetworkTopology(JSON.stringify(stoppedTopology.networks),
    JSON.stringify(stoppedTopology.supportingContainers), state, running, binding), /endpoint membership drifted/);
  const runningTopology = legacyNetworkFixture(binding, running);
  assert.throws(() => verifyLegacyNetworkTopology(JSON.stringify(runningTopology.networks),
    JSON.stringify(runningTopology.supportingContainers), state, stopped, binding), /endpoint membership drifted/);
  for (const mutate of [
    (cloudflared) => { cloudflared.Image = `sha256:${'0'.repeat(64)}`; },
    (cloudflared) => { cloudflared.User = '0:0'; },
    (cloudflared) => { cloudflared.Networks[RESOURCES.edgeNetwork].Aliases.push('cloudflared'); },
    (cloudflared) => { cloudflared.PortBindings = { '1234/tcp': [{ HostIp: '0.0.0.0', HostPort: '1234' }] }; },
    (cloudflared) => { cloudflared.Networks[RESOURCES.dataNetwork] = { Aliases: ['cloudflared'] }; },
    (cloudflared) => { cloudflared.Cmd = ['tunnel', 'run', '--token', 'forbidden']; },
    (cloudflared) => { cloudflared.Mounts[0].RW = true; },
    (cloudflared) => { cloudflared.ReadonlyRootfs = false; },
    (cloudflared) => { cloudflared.CapDrop = null; },
  ]) {
    const drifted = legacyNetworkFixture(binding, stopped);
    mutate(drifted.supportingContainers[2]);
    assert.throws(() => verifyLegacyNetworkTopology(JSON.stringify(drifted.networks),
      JSON.stringify(drifted.supportingContainers), state, stopped, binding), /cloudflared identity, network, alias, or port binding drifted/);
  }
  assert.doesNotMatch(LEGACY_SUPPORTING_INSPECT_FORMAT, /\.(?:Args|Env)\b|\"(?:Args|Env)\"/);
  assert.match(LEGACY_SUPPORTING_INSPECT_FORMAT, /\.Config\.Cmd/);
});
