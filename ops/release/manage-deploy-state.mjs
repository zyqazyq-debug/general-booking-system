#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, ContractError, EXIT, gateResult, parseArgs, sha256 } from './lib/contracts.mjs';
import { canonicalStatePath, initializeStateFile, mutateStateFile } from './lib/deploy-state-store.mjs';
import { readCompletedExecutorReceiptByDigest } from './lib/fenced-resource-store.mjs';
import { acquireLease, initialDeployState, renewLease, takeoverExpiredLease, transitionDeployState } from './lib/state-machine.mjs';

export const MIN_LEASE_DURATION_MS = 30_000;
export const MAX_LEASE_DURATION_MS = 30 * 60_000;
const FORBIDDEN_CALLER_FIELDS = new Set(['state', 'now', 'expires-at']);
const ALLOWED_FIELDS = new Set([
  'action', 'execute', 'environment', 'project', 'approval-id', 'expected-generation', 'expected-fencing-epoch', 'manifest-digest',
  'active-slot', 'active-release', 'active-git-sha', 'active-manifest-digest',
  'candidate-slot', 'candidate-release', 'candidate-git-sha', 'candidate-manifest-digest',
  'edge-network', 'data-network', 'database-ref', 'ingress-ref',
  'operation-id', 'lease-id', 'holder-id', 'lease-duration-ms', 'to',
  'candidate-probe-digest', 'rollback-pre-switch-probe-digest', 'singleton-transfer-receipt-digest', 'switch-receipt-digest',
  'observation-receipt-digest', 'rollback-receipt-digest', 'rollback-singleton-transfer-receipt-digest', 'rolled-back-probe-digest',
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
  const operationIdentity = state.candidate || state.active;
  if (operationIdentity.manifestDigest !== args['manifest-digest']) throw new ContractError('authorized manifest digest does not match operation identity', EXIT.IDENTITY);
  if (!allowApprovalChange && state.approvalId !== args['approval-id']) throw new ContractError('approval ID does not match active operation', EXIT.SWITCH);
}

const RECEIPT_TRANSITIONS = Object.freeze({
  SINGLETON_TRANSFERRED: [{ argument: 'singleton-transfer-receipt-digest', action: 'preprod-transfer-singletons', identity: 'candidate', resources: ['edgeNetwork', 'dataNetwork', 'databaseRef', 'telegram'] }],
  SWITCHED: [{ argument: 'switch-receipt-digest', action: 'preprod-switch-ingress', identity: 'candidate', resources: ['ingressRef'] }],
  ROLLED_BACK: [
    { argument: 'rollback-receipt-digest', action: 'preprod-rollback-ingress', identity: 'rollback', resources: ['ingressRef'] },
    { argument: 'rollback-singleton-transfer-receipt-digest', action: 'preprod-rollback-singletons', identity: 'rollback', resources: ['edgeNetwork', 'dataNetwork', 'databaseRef', 'telegram'] },
  ],
});

function sameIdentity(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

async function verifyTransitionReceipts(statePath, state, args) {
  const requirements = RECEIPT_TRANSITIONS[args.to] || [];
  const resourceMap = { ...state.resources, telegram: `telegram:${state.project}` };
  for (const requirement of requirements) {
    required(args, [requirement.argument]);
    const expectedIdentity = state[requirement.identity];
    if (!expectedIdentity) throw new ContractError(`${args.to} executor receipt target identity is unavailable`, EXIT.IDENTITY);
    const { receipt, acceptedReceipt } = await readCompletedExecutorReceiptByDigest(statePath, args[requirement.argument]);
    const expectedResources = requirement.resources.map((key) => resourceMap[key]);
    const requestBody = {
      schema: 'booking.fenced-action-request/v1', environment: receipt.environment, project: receipt.project,
      action: receipt.action, actionId: receipt.actionId, operationId: receipt.operationId, approvalId: receipt.approvalId,
      generation: receipt.generation, fencingEpoch: receipt.fencingEpoch, leaseId: receipt.leaseId, holderId: receipt.holderId,
      manifestDigest: receipt.manifestDigest, releaseIdentity: receipt.releaseIdentity, resourceIds: receipt.resourceIds,
      commandDigest: receipt.commandDigest,
    };
    const mismatches = [
      [receipt.schema === 'booking.external-action-receipt/v1', 'schema'], [receipt.status === 'pass', 'status'],
      [acceptedReceipt.receiptDigest === args[requirement.argument], 'digest'], [receipt.action === requirement.action, 'action'],
      [receipt.environment === state.environment, 'environment'], [receipt.project === state.project, 'project'],
      [receipt.operationId === state.operationId, 'operation'], [receipt.approvalId === state.approvalId, 'approval'],
      [receipt.generation === state.generation, 'generation'], [receipt.fencingEpoch === state.fencingEpoch, 'fencing'],
      [receipt.leaseId === state.lease?.leaseId, 'lease'], [receipt.holderId === state.lease?.holderId, 'holder'],
      [receipt.manifestDigest === expectedIdentity.manifestDigest, 'manifest'], [sameIdentity(receipt.releaseIdentity, expectedIdentity), 'identity'],
      [canonicalJson(receipt.resourceIds) === canonicalJson(expectedResources), 'resources'], [receipt.requestDigest === sha256(requestBody), 'request'],
    ].filter(([matches]) => !matches).map(([, name]) => name);
    if (mismatches.length) throw new ContractError(`${args.to} executor receipt does not match the canonical transition identity: ${mismatches.join(',')}`, EXIT.IDENTITY);
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
    required(args, ['edge-network', 'data-network', 'database-ref', 'ingress-ref']);
    const resources = { edgeNetwork: args['edge-network'], dataNetwork: args['data-network'], databaseRef: args['database-ref'], ingressRef: args['ingress-ref'] };
    return initializeStateFile(statePath, initialDeployState({ environment: args.environment, project: args.project, resources, active }, now), storeOptions);
  }

  return mutateStateFile(statePath, async (state) => {
    if (state.environment !== args.environment || state.project !== args.project) throw new ContractError('canonical state identity mismatch', EXIT.SWITCH);
    if (args.action === 'acquire') {
      const candidate = identity(args, 'candidate');
      if (candidate.manifestDigest !== args['manifest-digest']) throw new ContractError('authorized manifest digest does not match candidate identity', EXIT.IDENTITY);
      required(args, ['operation-id', 'lease-id', 'holder-id', 'lease-duration-ms']);
      const expiresAt = new Date(nowMs + leaseDuration(args['lease-duration-ms'])).toISOString();
      return acquireLease(state, { ...cas, candidate, operationId: args['operation-id'], approvalId: args['approval-id'], leaseId: args['lease-id'], holderId: args['holder-id'], now, expiresAt });
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
      return transitionDeployState(state, {
        ...lease, to: args.to, manifestDigest: args['manifest-digest'],
        candidateProbeDigest: args['candidate-probe-digest'], rollbackPreSwitchProbeDigest: args['rollback-pre-switch-probe-digest'],
        singletonTransferReceiptDigest: args['singleton-transfer-receipt-digest'],
        switchReceiptDigest: args['switch-receipt-digest'], observationReceiptDigest: args['observation-receipt-digest'],
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
