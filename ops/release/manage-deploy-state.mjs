#!/usr/bin/env node
import { readFile, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, ContractError, EXIT, gateResult, parseArgs, sha256 } from './lib/contracts.mjs';
import { canonicalStatePath, initializeStateFile, mutateStateFile } from './lib/deploy-state-store.mjs';
import { readCanonicalExecutorReceiptByDigest, readCompletedExecutorReceiptByDigest, resourceDirectory } from './lib/fenced-resource-store.mjs';
import { LEGACY_OLD_BINDING } from './lib/legacy-preprod.mjs';
import { acquireLease, initialDeployState, renewLease, ROLLBACK_MODE, rollbackModeForState, takeoverExpiredLease, transitionDeployState } from './lib/state-machine.mjs';

export const MIN_LEASE_DURATION_MS = 30_000;
export const MAX_LEASE_DURATION_MS = 30 * 60_000;
const FORBIDDEN_CALLER_FIELDS = new Set(['state', 'now', 'expires-at']);
const ALLOWED_FIELDS = new Set([
  'action', 'execute', 'environment', 'project', 'approval-id', 'expected-generation', 'expected-fencing-epoch', 'manifest-digest',
  'active-slot', 'active-release', 'active-git-sha', 'active-manifest-digest',
  'candidate-slot', 'candidate-release', 'candidate-git-sha', 'candidate-manifest-digest',
  'edge-network', 'data-network', 'database-ref', 'ingress-ref',
  'operation-id', 'lease-id', 'holder-id', 'lease-duration-ms', 'to',
  'baseline-receipt-digest', 'expand-migration-receipt-digest', 'stage-receipt-digest',
  'candidate-probe-digest', 'rollback-pre-switch-probe-digest', 'singleton-transfer-receipt-digest', 'switch-receipt-digest',
  'webhook-receipt-digest', 'observation-receipt-digest', 'rollback-receipt-digest', 'rollback-singleton-transfer-receipt-digest', 'rolled-back-probe-digest',
]);

function required(args, names) {
  for (const name of names) if (!args[name]) throw new ContractError(`--${name} is required`);
}

function integer(value, name) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0) throw new ContractError(`--${name} must be a non-negative integer`);
  return result;
}

function leaseDuration(value) {
  const result = integer(value, 'lease-duration-ms');
  if (result < MIN_LEASE_DURATION_MS || result > MAX_LEASE_DURATION_MS) {
    throw new ContractError(`--lease-duration-ms must be between ${MIN_LEASE_DURATION_MS} and ${MAX_LEASE_DURATION_MS}`, EXIT.SINGLETON);
  }
  return result;
}

function identity(args, prefix) {
  required(args, [`${prefix}-slot`, `${prefix}-release`, `${prefix}-git-sha`, `${prefix}-manifest-digest`]);
  return { slot: args[`${prefix}-slot`], releaseId: args[`${prefix}-release`], gitSha: args[`${prefix}-git-sha`], manifestDigest: args[`${prefix}-manifest-digest`] };
}

function validateArgumentSurface(args) {
  for (const key of Object.keys(args)) {
    if (FORBIDDEN_CALLER_FIELDS.has(key)) throw new ContractError(`--${key} is forbidden; path and time are derived by the release tool`, EXIT.SWITCH);
    if (!ALLOWED_FIELDS.has(key)) throw new ContractError(`unsupported argument: --${key}`);
  }
}

function authorized(args) {
  required(args, ['environment', 'project', 'approval-id', 'expected-generation', 'expected-fencing-epoch', 'manifest-digest']);
  if (args.execute !== 'true') throw new ContractError('state mutation requires --execute true', EXIT.SWITCH);
  return { expectedGeneration: integer(args['expected-generation'], 'expected-generation'), expectedFencingEpoch: integer(args['expected-fencing-epoch'], 'expected-fencing-epoch') };
}

function leaseInput(args, cas, now) {
  required(args, ['lease-id', 'holder-id']);
  return { ...cas, leaseId: args['lease-id'], holderId: args['holder-id'], now };
}

function assertOperationBinding(state, args, allowApprovalChange = false) {
  required(args, ['operation-id']);
  const operationIdentity = state.candidate || state.active;
  if (operationIdentity.manifestDigest !== args['manifest-digest']) throw new ContractError('authorized manifest digest does not match operation identity', EXIT.IDENTITY);
  if (state.operationId !== args['operation-id']) throw new ContractError('operation ID does not match active operation', EXIT.SINGLETON);
  if (!allowApprovalChange && state.approvalId !== args['approval-id']) throw new ContractError('approval ID does not match active operation', EXIT.SWITCH);
}

const RECEIPT_TRANSITIONS = Object.freeze({
  EXPAND_MIGRATED: [
    { argument: 'expand-migration-receipt-digest', action: 'preprod-expand-migrate', identity: 'candidate', resources: ['databaseRef', 'dataNetwork'] },
    { argument: 'baseline-receipt-digest', action: 'preprod-baseline-ledger', identity: 'candidate', resources: ['databaseRef', 'dataNetwork'], legacyOnly: true, predecessorOf: 'preprod-expand-migrate' },
  ],
  CANDIDATE_STARTED: [{ argument: 'stage-receipt-digest', action: 'preprod-stage', identity: 'candidate', resources: ['edgeNetwork'] }],
  CANDIDATE_READY: [{ argument: 'candidate-probe-digest', action: 'preprod-probe-candidate', identity: 'candidate', resources: ['candidateProbe'] }],
  SINGLETON_TRANSFERRED: [
    { argument: 'rollback-pre-switch-probe-digest', action: 'preprod-probe-active', identity: 'active', resources: ['activeProbe'] },
    { argument: 'singleton-transfer-receipt-digest', action: 'preprod-transfer-singletons', identity: 'candidate', resources: ['edgeNetwork', 'dataNetwork', 'databaseRef', 'telegram'] },
  ],
  SWITCHED: [{ argument: 'switch-receipt-digest', action: 'preprod-switch-ingress', identity: 'candidate', resources: ['ingressRef'] }],
  OBSERVING: [{ argument: 'webhook-receipt-digest', action: 'preprod-set-webhook', identity: 'active', resources: ['telegram', 'databaseRef', 'dataNetwork'] }],
  COMMITTED: [{ argument: 'observation-receipt-digest', action: 'preprod-probe-observation', identity: 'active', resources: ['observationProbe'] }],
  ROLLED_BACK: [
    { argument: 'rollback-receipt-digest', action: 'preprod-rollback-ingress', identity: 'rollback', resources: ['ingressRef'], postSwitchOnly: true },
    { argument: 'rollback-singleton-transfer-receipt-digest', action: 'preprod-rollback-singletons', identity: 'rollback', resources: ['edgeNetwork', 'dataNetwork', 'databaseRef', 'telegram'] },
    { argument: 'rolled-back-probe-digest', action: 'preprod-probe-rollback', identity: 'rollback', resources: ['rollbackProbe'] },
  ],
});

function sameIdentity(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function isExactLegacyBootstrap(identityValue) {
  return identityValue.slot === 'green' && identityValue.releaseId === LEGACY_OLD_BINDING.releaseId &&
    identityValue.gitSha === LEGACY_OLD_BINDING.gitSha && identityValue.manifestDigest === LEGACY_OLD_BINDING.manifestRawDigest;
}

async function inspectRuntimeEnvironment(args, runtime) {
  const fixedPath = `/volume1/happybooking/${args.project}/.env`;
  if (runtime.runtimeEnvFile !== undefined && runtime.allowInsecureTestPaths !== true) {
    throw new ContractError('runtime environment path cannot be supplied by the caller', EXIT.IDENTITY);
  }
  const configured = runtime.runtimeEnvFile || fixedPath;
  const canonical = await realpath(configured).catch(() => { throw new ContractError('fixed runtime environment file cannot be resolved', EXIT.IDENTITY); });
  const metadata = await stat(canonical);
  if (canonical !== resolve(configured) || !metadata.isFile() ||
      (!runtime.allowInsecureTestPaths && process.platform !== 'win32' && (metadata.uid !== 0 || (metadata.mode & 0o777) !== 0o600))) {
    throw new ContractError('runtime environment file must be the fixed canonical root-owned 0600 regular file', EXIT.IDENTITY);
  }
  return sha256(await readFile(canonical, 'utf8'));
}

async function verifyTransitionReceipts(statePath, state, args) {
  const requirements = RECEIPT_TRANSITIONS[args.to] || [];
  const rollbackMode = args.to === 'ROLLED_BACK' ? rollbackModeForState(state) : null;
  if (rollbackMode === ROLLBACK_MODE.PRE_SWITCH_SINGLETON && args['rollback-receipt-digest'] !== undefined) {
    throw new ContractError('pre-switch rollback must not consume ingress mutation evidence', EXIT.ROLLBACK);
  }
  const resourceMap = { ...state.resources, telegram: `telegram:${state.project}`,
    candidateProbe: `probe:${state.project}:candidate`, activeProbe: `probe:${state.project}:active`,
    observationProbe: `probe:${state.project}:observation`, rollbackProbe: `probe:${state.project}:rollback` };
  const verified = new Map();
  for (const requirement of requirements) {
    if (requirement.postSwitchOnly && rollbackMode === ROLLBACK_MODE.PRE_SWITCH_SINGLETON) continue;
    if (requirement.legacyOnly && !(state.active.slot === 'green' && state.active.releaseId === LEGACY_OLD_BINDING.releaseId &&
        state.active.gitSha === LEGACY_OLD_BINDING.gitSha && state.active.manifestDigest === LEGACY_OLD_BINDING.manifestRawDigest)) continue;
    required(args, [requirement.argument]);
    const expectedIdentity = state[requirement.identity];
    if (!expectedIdentity) throw new ContractError(`${args.to} executor receipt target identity is unavailable`, EXIT.IDENTITY);
    // A later action on the same fenced resources intentionally replaces the
    // predecessor as the resource chain head.  The predecessor is still
    // canonical immutable evidence, but completion is proven by the current
    // action plus its exact previousReceiptDigest relation below.
    const reader = requirement.predecessorOf ? readCanonicalExecutorReceiptByDigest : readCompletedExecutorReceiptByDigest;
    const { receipt, acceptedReceipt } = await reader(statePath, args[requirement.argument]);
    const expectedResources = requirement.resources.map((key) => resourceMap[key]);
    const successor = requirement.predecessorOf ? verified.get(requirement.predecessorOf) : null;
    let priorFenceSuccessor = null;
    if (successor?.receipt.verification?.adoption?.mode === 'independent-readback') {
      const priorDigest = successor.receipt.verification.adoption.priorReceiptDigest;
      const prior = await readCanonicalExecutorReceiptByDigest(statePath, priorDigest);
      const priorRequest = {
        schema: 'booking.fenced-action-request/v1', environment: prior.receipt.environment, project: prior.receipt.project,
        action: prior.receipt.action, actionId: prior.receipt.actionId, operationId: prior.receipt.operationId,
        approvalId: prior.receipt.approvalId, generation: prior.receipt.generation, fencingEpoch: prior.receipt.fencingEpoch,
        leaseId: prior.receipt.leaseId, holderId: prior.receipt.holderId, manifestDigest: prior.receipt.manifestDigest,
        releaseIdentity: prior.receipt.releaseIdentity, resourceIds: prior.receipt.resourceIds,
        runtimeEnvDigest: prior.receipt.runtimeEnvDigest, commandDigest: prior.receipt.commandDigest,
      };
      const adoptedHeads = successor.receipt.resources?.map((resource) => resource.previousReceiptDigest);
      if (prior.acceptedReceipt.receiptDigest !== priorDigest || prior.receipt.action !== requirement.predecessorOf ||
          prior.receipt.status !== 'pass' || prior.receipt.operationId !== state.operationId ||
          prior.receipt.manifestDigest !== successor.receipt.manifestDigest || prior.receipt.runtimeEnvDigest !== state.runtimeEnvDigest ||
          prior.receipt.fencingEpoch >= state.fencingEpoch || prior.receipt.requestDigest !== sha256(priorRequest) ||
          !Array.isArray(adoptedHeads) || adoptedHeads.some((digest) => digest !== priorDigest)) {
        throw new ContractError(`${args.to} adopted successor does not prove an exact prior-fence completion`, EXIT.IDENTITY);
      }
      priorFenceSuccessor = prior.receipt;
    }
    const receiptFenceIdentity = priorFenceSuccessor ? {
      approvalId: priorFenceSuccessor.approvalId, fencingEpoch: priorFenceSuccessor.fencingEpoch,
      leaseId: priorFenceSuccessor.leaseId, holderId: priorFenceSuccessor.holderId,
    } : { approvalId: state.approvalId, fencingEpoch: state.fencingEpoch, leaseId: state.lease?.leaseId, holderId: state.lease?.holderId };
    const requestBody = {
      schema: 'booking.fenced-action-request/v1', environment: receipt.environment, project: receipt.project,
      action: receipt.action, actionId: receipt.actionId, operationId: receipt.operationId, approvalId: receipt.approvalId,
      generation: receipt.generation, fencingEpoch: receipt.fencingEpoch, leaseId: receipt.leaseId, holderId: receipt.holderId,
      manifestDigest: receipt.manifestDigest, releaseIdentity: receipt.releaseIdentity, resourceIds: receipt.resourceIds,
      runtimeEnvDigest: receipt.runtimeEnvDigest, commandDigest: receipt.commandDigest,
    };
    const mismatches = [
      [receipt.schema === 'booking.external-action-receipt/v1', 'schema'], [receipt.status === 'pass', 'status'],
      [acceptedReceipt.receiptDigest === args[requirement.argument], 'digest'], [receipt.action === requirement.action, 'action'],
      [receipt.environment === state.environment, 'environment'], [receipt.project === state.project, 'project'],
      [receipt.operationId === state.operationId, 'operation'], [receipt.approvalId === receiptFenceIdentity.approvalId, 'approval'],
      [receipt.generation <= state.generation, 'generation'], [receipt.fencingEpoch === receiptFenceIdentity.fencingEpoch, 'fencing'],
      [receipt.leaseId === receiptFenceIdentity.leaseId, 'lease'], [receipt.holderId === receiptFenceIdentity.holderId, 'holder'],
      [receipt.runtimeEnvDigest === state.runtimeEnvDigest, 'runtime environment'],
      [receipt.manifestDigest === expectedIdentity.manifestDigest, 'manifest'], [sameIdentity(receipt.releaseIdentity, expectedIdentity), 'identity'],
      [canonicalJson(receipt.resourceIds) === canonicalJson(expectedResources), 'resources'], [receipt.requestDigest === sha256(requestBody), 'request'],
    ].filter(([matches]) => !matches).map(([, name]) => name);
    if (mismatches.length) throw new ContractError(`${args.to} executor receipt does not match the canonical transition identity: ${mismatches.join(',')}`, EXIT.IDENTITY);
    verified.set(requirement.action, { receipt, acceptedReceipt, expectedResources });
    if (requirement.predecessorOf) {
      if (!successor) throw new ContractError(`${args.to} executor receipt predecessor proof is unavailable`, EXIT.IDENTITY);
      const observedPredecessors = (priorFenceSuccessor || successor.receipt).resources?.map((resource) => ({
        resourceId: resource.resourceId,
        previousReceiptDigest: resource.previousReceiptDigest,
      })).sort((left, right) => left.resourceId.localeCompare(right.resourceId));
      const expectedPredecessors = successor.expectedResources.map((resourceId) => ({
        resourceId,
        previousReceiptDigest: acceptedReceipt.receiptDigest,
      })).sort((left, right) => left.resourceId.localeCompare(right.resourceId));
      if (canonicalJson(observedPredecessors) !== canonicalJson(expectedPredecessors)) {
        throw new ContractError(`${args.to} executor receipt does not prove the exact baseline predecessor chain`, EXIT.IDENTITY);
      }
    }
  }
}

async function verifyTerminalResourceClosure(statePath, state, nextPhase, args) {
  if (!['COMMITTED', 'IDLE'].includes(nextPhase)) return;
  const resourceMap = { ...state.resources, telegram: `telegram:${state.project}`,
    candidateProbe: `probe:${state.project}:candidate`, activeProbe: `probe:${state.project}:active`,
    observationProbe: `probe:${state.project}:observation`, rollbackProbe: `probe:${state.project}:rollback` };
  const resourceIds = new Set([...Object.values(state.resources), `telegram:${state.project}`,
    `probe:${state.project}:candidate`, `probe:${state.project}:active`, `probe:${state.project}:observation`, `probe:${state.project}:rollback`]);
  const acceptedHeads = new Set(Object.values(state.evidence).filter(Boolean));
  const requiredResourceIds = new Set();
  for (const requirements of Object.values(RECEIPT_TRANSITIONS)) {
    for (const requirement of requirements) {
      const evidenceKey = requirement.argument.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
      const evidenceDigest = args[requirement.argument] || state.evidence[evidenceKey];
      if (/^sha256:[0-9a-f]{64}$/.test(evidenceDigest || '')) {
        for (const resourceKey of requirement.resources) requiredResourceIds.add(resourceMap[resourceKey]);
      }
    }
  }
  for (const requirement of RECEIPT_TRANSITIONS[nextPhase] || []) {
    if (/^sha256:[0-9a-f]{64}$/.test(args[requirement.argument] || '')) acceptedHeads.add(args[requirement.argument]);
  }
  for (const resourceId of resourceIds) {
    const path = join(resourceDirectory(statePath, resourceId), 'resource-state.json');
    let resource;
    try { resource = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) {
      if (error?.code === 'ENOENT' && !requiredResourceIds.has(resourceId)) continue;
      throw new ContractError(`resource ${resourceId} completion state is missing or unreadable`, EXIT.IDENTITY);
    }
    if (resource.environment !== state.environment || resource.project !== state.project || resource.resourceId !== resourceId ||
        resource.pendingAction !== null || (resource.receiptChainHead !== null && !acceptedHeads.has(resource.receiptChainHead))) {
      throw new ContractError(`${nextPhase} requires fenced resource ${resourceId} mutation head to be explicitly consumed by deployment evidence`, EXIT.IDENTITY);
    }
  }
}

export async function runManageDeployState(args, runtime = {}) {
  validateArgumentSurface(args);
  required(args, ['action']);
  const cas = authorized(args);
  const nowMs = runtime.nowMs === undefined ? Date.now() : runtime.nowMs;
  if (!Number.isFinite(nowMs)) throw new ContractError('trusted runtime clock is invalid', EXIT.SWITCH);
  const now = new Date(nowMs).toISOString();
  const statePath = await canonicalStatePath({ environment: args.environment, project: args.project, deployStateRoot: runtime.deployStateRoot });
  const storeOptions = { nowMs };

  if (args.action === 'init') {
    if (cas.expectedGeneration !== 0 || cas.expectedFencingEpoch !== 0) throw new ContractError('initial state requires zero generation and fencing epoch');
    const active = identity(args, 'active');
    if (active.manifestDigest !== args['manifest-digest']) throw new ContractError('authorized manifest digest does not match active identity', EXIT.IDENTITY);
    if (!isExactLegacyBootstrap(active)) throw new ContractError('initial bootstrap active identity must be the exact fixed legacy release', EXIT.IDENTITY);
    required(args, ['edge-network', 'data-network', 'database-ref', 'ingress-ref']);
    const resources = { edgeNetwork: args['edge-network'], dataNetwork: args['data-network'], databaseRef: args['database-ref'], ingressRef: args['ingress-ref'] };
    const runtimeEnvDigest = await inspectRuntimeEnvironment(args, runtime);
    return initializeStateFile(statePath, initialDeployState({ environment: args.environment, project: args.project, resources, active, runtimeEnvDigest }, now), storeOptions);
  }

  return mutateStateFile(statePath, async (state) => {
    if (state.environment !== args.environment || state.project !== args.project) throw new ContractError('canonical state identity mismatch', EXIT.SWITCH);
    if (args.action === 'acquire') {
      const candidate = identity(args, 'candidate');
      if (candidate.manifestDigest !== args['manifest-digest']) throw new ContractError('authorized manifest digest does not match candidate identity', EXIT.IDENTITY);
      required(args, ['operation-id', 'lease-id', 'holder-id', 'lease-duration-ms']);
      const expiresAt = new Date(nowMs + leaseDuration(args['lease-duration-ms'])).toISOString();
      const runtimeEnvDigest = await inspectRuntimeEnvironment(args, runtime);
      return acquireLease(state, { ...cas, candidate, operationId: args['operation-id'], approvalId: args['approval-id'], leaseId: args['lease-id'], holderId: args['holder-id'], now, expiresAt, runtimeEnvDigest });
    }
    const runtimeEnvDigest = await inspectRuntimeEnvironment(args, runtime);
    if (runtimeEnvDigest !== state.runtimeEnvDigest) {
      throw new ContractError('runtime environment digest drifted from the active deployment operation', EXIT.IDENTITY);
    }
    if (args.action === 'takeover') {
      assertOperationBinding(state, args, true);
      required(args, ['lease-id', 'holder-id', 'lease-duration-ms']);
      const expiresAt = new Date(nowMs + leaseDuration(args['lease-duration-ms'])).toISOString();
      return takeoverExpiredLease(state, { ...cas, approvalId: args['approval-id'], leaseId: args['lease-id'], holderId: args['holder-id'], now, expiresAt });
    }
    assertOperationBinding(state, args);
    const lease = leaseInput(args, cas, now);
    if (args.action === 'renew') {
      required(args, ['lease-duration-ms']);
      const expiresAt = new Date(nowMs + leaseDuration(args['lease-duration-ms'])).toISOString();
      return renewLease(state, { ...lease, expiresAt });
    }
    if (args.action === 'transition') {
      required(args, ['to']);
      await verifyTransitionReceipts(statePath, state, args);
      await verifyTerminalResourceClosure(statePath, state, args.to, args);
      return transitionDeployState(state, {
        ...lease, to: args.to, manifestDigest: args['manifest-digest'],
        baselineReceiptDigest: args['baseline-receipt-digest'], expandMigrationReceiptDigest: args['expand-migration-receipt-digest'],
        stageReceiptDigest: args['stage-receipt-digest'],
        candidateProbeDigest: args['candidate-probe-digest'], rollbackPreSwitchProbeDigest: args['rollback-pre-switch-probe-digest'],
        singletonTransferReceiptDigest: args['singleton-transfer-receipt-digest'],
        switchReceiptDigest: args['switch-receipt-digest'], webhookReceiptDigest: args['webhook-receipt-digest'], observationReceiptDigest: args['observation-receipt-digest'],
        rollbackReceiptDigest: args['rollback-receipt-digest'], rollbackSingletonTransferReceiptDigest: args['rollback-singleton-transfer-receipt-digest'],
        rolledBackProbeDigest: args['rolled-back-probe-digest'],
      });
    }
    throw new ContractError(`unsupported --action: ${args.action}`);
  }, storeOptions);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let exitCode = EXIT.PASS;
  let output;
  try {
    const args = parseArgs(process.argv.slice(2));
    const state = await runManageDeployState(args);
    output = gateResult({ gate: 'deploy-state-cas', releaseId: (state.candidate || state.active).releaseId, slot: (state.candidate || state.active).slot, checks: [{ name: args.action, status: 'pass', code: `STATE_${args.action.toUpperCase()}_RECORDED`, detail: `generation=${state.generation};fencingEpoch=${state.fencingEpoch};phase=${state.phase}` }] });
  } catch (error) {
    const failure = error instanceof ContractError ? error : new ContractError('unexpected deployment state failure');
    exitCode = failure.exitCode;
    output = gateResult({ gate: 'deploy-state-cas', checks: [{ name: 'state-mutation', status: 'fail', code: 'STATE_MUTATION_REJECTED', detail: failure.message }] });
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = exitCode;
}
