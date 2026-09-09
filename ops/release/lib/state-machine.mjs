import { ContractError, EXIT } from './contracts.mjs';

export const TRANSITIONS = Object.freeze({
  IDLE: ['LOCKED'],
  LOCKED: ['MANIFEST_VERIFIED', 'FAILED'],
  MANIFEST_VERIFIED: ['STAGED', 'FAILED'],
  STAGED: ['EXPAND_MIGRATED', 'CANDIDATE_STARTED', 'ABORT_CANDIDATE', 'FAILED'],
  EXPAND_MIGRATED: ['CANDIDATE_STARTED', 'ABORT_CANDIDATE', 'FAILED'],
  CANDIDATE_STARTED: ['CANDIDATE_READY', 'ABORT_CANDIDATE', 'FAILED'],
  CANDIDATE_READY: ['SINGLETON_TRANSFERRED', 'ABORT_CANDIDATE', 'FAILED'],
  SINGLETON_TRANSFERRED: ['SWITCHED', 'ROLLBACK_PENDING', 'FAILED'],
  SWITCHED: ['OBSERVING', 'ROLLBACK_PENDING', 'AUTOMATIC_ROLLBACK_FORBIDDEN'],
  OBSERVING: ['COMMITTED', 'ROLLBACK_PENDING', 'AUTOMATIC_ROLLBACK_FORBIDDEN'],
  COMMITTED: ['IDLE'],
  ABORT_CANDIDATE: ['IDLE'],
  ROLLBACK_PENDING: ['ROLLED_BACK', 'FAILED'],
  ROLLED_BACK: ['IDLE'],
  AUTOMATIC_ROLLBACK_FORBIDDEN: ['FAILED'],
  FAILED: [],
});

const SLOT = new Set(['blue', 'green']);
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RELEASE_ID = /^booking-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ROOT_KEYS = new Set(['schema', 'environment', 'project', 'resources', 'generation', 'fencingEpoch', 'phase', 'operationId', 'approvalId', 'lease', 'active', 'candidate', 'rollback', 'evidence', 'receiptChainHead', 'contractMigrationApplied', 'updatedAt']);
const EVIDENCE_KEYS = new Set(['candidateProbeDigest', 'rollbackPreSwitchProbeDigest', 'singletonTransferReceiptDigest', 'switchReceiptDigest', 'observationReceiptDigest', 'rollbackReceiptDigest', 'rollbackSingletonTransferReceiptDigest', 'rolledBackProbeDigest']);
const POST_SWITCH_PHASES = new Set(['SWITCHED', 'OBSERVING', 'COMMITTED', 'ROLLBACK_PENDING', 'AUTOMATIC_ROLLBACK_FORBIDDEN']);

function exactKeys(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError(`${path} must be an object`);
  for (const key of keys) if (!(key in value)) throw new ContractError(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!keys.has(key)) throw new ContractError(`${path}.${key} is not allowed`);
}

function requireIso(value, path) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new ContractError(`${path} must be a canonical ISO timestamp`);
  }
}

function validateIdentity(identity, path) {
  exactKeys(identity, new Set(['slot', 'releaseId', 'gitSha', 'manifestDigest']), path);
  if (!SLOT.has(identity.slot)) throw new ContractError(`${path}.slot is invalid`);
  if (!RELEASE_ID.test(identity.releaseId)) throw new ContractError(`${path}.releaseId is invalid`);
  if (!GIT_SHA.test(identity.gitSha)) throw new ContractError(`${path}.gitSha is invalid`);
  if (!DIGEST.test(identity.manifestDigest)) throw new ContractError(`${path}.manifestDigest is invalid`);
}

function sameIdentity(left, right) {
  return left && right && left.slot === right.slot && left.releaseId === right.releaseId && left.gitSha === right.gitSha && left.manifestDigest === right.manifestDigest;
}

function validateEvidence(evidence) {
  exactKeys(evidence, EVIDENCE_KEYS, 'state.evidence');
  for (const [key, value] of Object.entries(evidence)) {
    if (value !== null && !DIGEST.test(value)) throw new ContractError(`state.evidence.${key} is invalid`);
  }
}

export function validateDeployState(state) {
  exactKeys(state, ROOT_KEYS, 'state');
  if (state.schema !== 'booking.deploy-state/v2') throw new ContractError('state.schema is unsupported');
  if (!['preprod', 'production'].includes(state.environment)) throw new ContractError('state.environment is invalid');
  const resourcePrefix = state.environment === 'preprod' ? 'booking-preprod' : 'booking-prod';
  if (state.project !== resourcePrefix) throw new ContractError('state.project does not match environment');
  exactKeys(state.resources, new Set(['edgeNetwork', 'dataNetwork', 'databaseRef', 'ingressRef']), 'state.resources');
  const expectedResources = {
    edgeNetwork: `${resourcePrefix}-edge`, dataNetwork: `${resourcePrefix}-data`,
    databaseRef: `database:${resourcePrefix}`, ingressRef: `ingress:${resourcePrefix}`,
  };
  for (const [key, value] of Object.entries(expectedResources)) {
    if (state.resources[key] !== value) throw new ContractError(`state.resources.${key} does not match project`);
  }
  if (!Number.isInteger(state.generation) || state.generation < 0) throw new ContractError('state.generation is invalid');
  if (!Number.isInteger(state.fencingEpoch) || state.fencingEpoch < 0) throw new ContractError('state.fencingEpoch is invalid');
  if (!(state.phase in TRANSITIONS)) throw new ContractError('state.phase is invalid');
  validateIdentity(state.active, 'state.active');
  if (state.candidate !== null) validateIdentity(state.candidate, 'state.candidate');
  if (state.rollback !== null) validateIdentity(state.rollback, 'state.rollback');
  if (state.candidate && state.candidate.slot === state.active.slot) throw new ContractError('candidate must use the inactive slot');
  if (state.rollback && !POST_SWITCH_PHASES.has(state.phase) && !sameIdentity(state.rollback, state.active)) {
    throw new ContractError('pre-switch rollback identity must equal active identity');
  }
  validateEvidence(state.evidence);
  if (state.receiptChainHead !== null && !DIGEST.test(state.receiptChainHead)) throw new ContractError('state.receiptChainHead is invalid');
  requireIso(state.updatedAt, 'state.updatedAt');
  if (typeof state.contractMigrationApplied !== 'boolean') throw new ContractError('state.contractMigrationApplied must be boolean');

  if (state.phase === 'IDLE') {
    if (state.operationId !== null || state.approvalId !== null || state.lease !== null || state.candidate !== null || state.rollback !== null) {
      throw new ContractError('idle state must not retain operation, lease, candidate, or rollback state');
    }
    if (Object.values(state.evidence).some((value) => value !== null)) throw new ContractError('idle state must not retain operation evidence');
  } else {
    if (!IDENTIFIER.test(state.operationId || '') || !IDENTIFIER.test(state.approvalId || '')) {
      throw new ContractError('non-idle state requires operationId and approvalId');
    }
    if (!state.lease) throw new ContractError('non-idle state requires an exclusive lease');
  }

  if (state.lease) {
    exactKeys(state.lease, new Set(['leaseId', 'holderId', 'fencingEpoch', 'acquiredAt', 'expiresAt']), 'state.lease');
    if (!IDENTIFIER.test(state.lease.leaseId || '') || !IDENTIFIER.test(state.lease.holderId || '')) throw new ContractError('lease identity is invalid');
    if (state.lease.fencingEpoch !== state.fencingEpoch || state.fencingEpoch < 1) throw new ContractError('lease fencing epoch must equal state fencing epoch');
    requireIso(state.lease.acquiredAt, 'state.lease.acquiredAt');
    requireIso(state.lease.expiresAt, 'state.lease.expiresAt');
    if (Date.parse(state.lease.expiresAt) <= Date.parse(state.lease.acquiredAt)) throw new ContractError('lease expiry must follow acquisition');
  }
  return state;
}

export function initialDeployState({ environment, project, resources, active }, now) {
  validateIdentity(active, 'active');
  requireIso(now, 'now');
  return validateDeployState({
    schema: 'booking.deploy-state/v2', environment, project, resources: structuredClone(resources), generation: 0, fencingEpoch: 0, phase: 'IDLE',
    operationId: null, approvalId: null, lease: null, active: structuredClone(active), candidate: null, rollback: null,
    evidence: Object.fromEntries([...EVIDENCE_KEYS].map((key) => [key, null])),
    receiptChainHead: null, contractMigrationApplied: false, updatedAt: now,
  });
}

function assertCas(state, expectedGeneration, expectedFencingEpoch) {
  validateDeployState(state);
  if (!Number.isInteger(expectedGeneration) || state.generation !== expectedGeneration) throw new ContractError('deployment generation mismatch', EXIT.SWITCH);
  if (!Number.isInteger(expectedFencingEpoch) || state.fencingEpoch !== expectedFencingEpoch) throw new ContractError('deployment fencing epoch mismatch', EXIT.SWITCH);
}

function assertLease(state, input) {
  assertCas(state, input.expectedGeneration, input.expectedFencingEpoch);
  if (!state.lease || state.lease.leaseId !== input.leaseId || state.lease.holderId !== input.holderId) throw new ContractError('lease identity mismatch', EXIT.SINGLETON);
  if (state.lease.fencingEpoch !== input.expectedFencingEpoch) throw new ContractError('lease has been fenced', EXIT.SINGLETON);
  requireIso(input.now, 'now');
  if (Date.parse(state.lease.expiresAt) <= Date.parse(input.now)) throw new ContractError('lease has expired', EXIT.SINGLETON);
}

export function acquireLease(state, input) {
  assertCas(state, input.expectedGeneration, input.expectedFencingEpoch);
  if (state.phase !== 'IDLE' || state.lease !== null) throw new ContractError('new operation requires an idle unlocked state', EXIT.SINGLETON);
  validateIdentity(input.candidate, 'candidate');
  if (input.candidate.slot === state.active.slot) throw new ContractError('candidate must use the inactive slot', EXIT.SWITCH);
  requireIso(input.now, 'now');
  requireIso(input.expiresAt, 'expiresAt');
  if (Date.parse(input.expiresAt) <= Date.parse(input.now)) throw new ContractError('lease expiry must be in the future', EXIT.SINGLETON);
  for (const key of ['operationId', 'approvalId', 'leaseId', 'holderId']) if (typeof input[key] !== 'string' || !input[key]) throw new ContractError(`${key} is required`);
  const nextEpoch = state.fencingEpoch + 1;
  return validateDeployState({
    ...structuredClone(state), generation: state.generation + 1, fencingEpoch: nextEpoch, phase: 'LOCKED',
    operationId: input.operationId, approvalId: input.approvalId,
    lease: { leaseId: input.leaseId, holderId: input.holderId, fencingEpoch: nextEpoch, acquiredAt: input.now, expiresAt: input.expiresAt },
    candidate: structuredClone(input.candidate), rollback: structuredClone(state.active), updatedAt: input.now,
  });
}

export function takeoverExpiredLease(state, input) {
  assertCas(state, input.expectedGeneration, input.expectedFencingEpoch);
  if (!state.lease || state.phase === 'IDLE') throw new ContractError('there is no active operation to take over', EXIT.SINGLETON);
  requireIso(input.now, 'now');
  requireIso(input.expiresAt, 'expiresAt');
  if (Date.parse(state.lease.expiresAt) > Date.parse(input.now)) throw new ContractError('existing lease has not expired', EXIT.SINGLETON);
  if (Date.parse(input.expiresAt) <= Date.parse(input.now)) throw new ContractError('lease expiry must be in the future', EXIT.SINGLETON);
  for (const key of ['approvalId', 'leaseId', 'holderId']) if (typeof input[key] !== 'string' || !input[key]) throw new ContractError(`${key} is required`);
  const nextEpoch = state.fencingEpoch + 1;
  return validateDeployState({
    ...structuredClone(state), generation: state.generation + 1, fencingEpoch: nextEpoch, approvalId: input.approvalId,
    lease: { leaseId: input.leaseId, holderId: input.holderId, fencingEpoch: nextEpoch, acquiredAt: input.now, expiresAt: input.expiresAt }, updatedAt: input.now,
  });
}

export function renewLease(state, input) {
  assertLease(state, input);
  requireIso(input.expiresAt, 'expiresAt');
  if (Date.parse(input.expiresAt) <= Date.parse(input.now) || Date.parse(input.expiresAt) <= Date.parse(state.lease.expiresAt)) {
    throw new ContractError('renewal must extend the unexpired lease', EXIT.SINGLETON);
  }
  return validateDeployState({ ...structuredClone(state), generation: state.generation + 1, lease: { ...state.lease, expiresAt: input.expiresAt }, updatedAt: input.now });
}

export function assertTransition(state, nextPhase, expectedGeneration, expectedFencingEpoch = state.fencingEpoch) {
  assertCas(state, expectedGeneration, expectedFencingEpoch);
  if (!TRANSITIONS[state.phase].includes(nextPhase)) throw new ContractError(`transition ${state.phase} -> ${nextPhase} is not allowed`, EXIT.SWITCH);
  if (nextPhase === 'ROLLBACK_PENDING' && state.contractMigrationApplied) throw new ContractError('automatic rollback is forbidden after contract migration', EXIT.ROLLBACK);
  return true;
}

export function assertStaticTransition(state, nextPhase) {
  validateDeployState(state);
  if (!TRANSITIONS[state.phase].includes(nextPhase)) throw new ContractError(`transition ${state.phase} -> ${nextPhase} is not statically allowed`, EXIT.SWITCH);
  if (nextPhase === 'ROLLBACK_PENDING' && state.contractMigrationApplied) throw new ContractError('automatic rollback is forbidden after contract migration', EXIT.ROLLBACK);
  return true;
}

export function transitionDeployState(state, input) {
  assertLease(state, input);
  assertTransition(state, input.to, input.expectedGeneration, input.expectedFencingEpoch);
  const next = structuredClone(state);
  next.phase = input.to;
  next.generation += 1;
  next.updatedAt = input.now;

  if (input.to === 'MANIFEST_VERIFIED' && input.manifestDigest !== state.candidate?.manifestDigest) throw new ContractError('verified manifest digest does not match candidate', EXIT.IDENTITY);
  // EXPAND_MIGRATED is the durable marker for this release's additive migration.
  // It must not be confused with an irreversible contract migration.
  if (input.to === 'CANDIDATE_READY') {
    if (!DIGEST.test(input.candidateProbeDigest || '')) throw new ContractError('candidate readiness requires a probe evidence digest', EXIT.READINESS);
    next.evidence.candidateProbeDigest = input.candidateProbeDigest;
  }
  if (input.to === 'SINGLETON_TRANSFERRED') {
    if (!DIGEST.test(input.rollbackPreSwitchProbeDigest || '') || !DIGEST.test(input.singletonTransferReceiptDigest || '')) {
      throw new ContractError('singleton transfer requires rollback identity probe and fenced transfer receipt evidence', EXIT.SINGLETON);
    }
    next.evidence.rollbackPreSwitchProbeDigest = input.rollbackPreSwitchProbeDigest;
    next.evidence.singletonTransferReceiptDigest = input.singletonTransferReceiptDigest;
  }
  if (input.to === 'SWITCHED') {
    if (!next.evidence.candidateProbeDigest || !next.evidence.rollbackPreSwitchProbeDigest || !next.evidence.singletonTransferReceiptDigest || !DIGEST.test(input.switchReceiptDigest || '')) {
      throw new ContractError('switch requires candidate, rollback, singleton-transfer, and switch receipt evidence', EXIT.SWITCH);
    }
    next.evidence.switchReceiptDigest = input.switchReceiptDigest;
    const promoted = next.candidate;
    next.candidate = null;
    next.active = promoted;
  }
  if (input.to === 'COMMITTED') {
    if (!DIGEST.test(input.observationReceiptDigest || '')) throw new ContractError('commit requires observation evidence', EXIT.READINESS);
    next.evidence.observationReceiptDigest = input.observationReceiptDigest;
  }
  if (input.to === 'ROLLED_BACK') {
    if (!next.rollback || !DIGEST.test(input.rollbackReceiptDigest || '') || !DIGEST.test(input.rollbackSingletonTransferReceiptDigest || '') || !DIGEST.test(input.rolledBackProbeDigest || '')) {
      throw new ContractError('rollback requires immutable target, ingress receipt, singleton receipt, and post-rollback probe evidence', EXIT.ROLLBACK);
    }
    next.evidence.rollbackReceiptDigest = input.rollbackReceiptDigest;
    next.evidence.rollbackSingletonTransferReceiptDigest = input.rollbackSingletonTransferReceiptDigest;
    next.evidence.rolledBackProbeDigest = input.rolledBackProbeDigest;
    const failedCandidate = structuredClone(next.candidate || next.active);
    next.active = structuredClone(next.rollback);
    next.candidate = failedCandidate;
  }
  if (input.to === 'IDLE') {
    next.operationId = null;
    next.approvalId = null;
    next.lease = null;
    next.candidate = null;
    next.rollback = null;
    next.evidence = Object.fromEntries([...EVIDENCE_KEYS].map((key) => [key, null]));
    next.contractMigrationApplied = false;
  }
  return validateDeployState(next);
}
