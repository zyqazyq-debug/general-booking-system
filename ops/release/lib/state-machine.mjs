import { ContractError, EXIT } from './contracts.mjs';
import { LEGACY_OLD_BINDING } from './legacy-preprod.mjs';

const V2_TRANSITIONS = Object.freeze({
  IDLE: ['LOCKED'],
  LOCKED: ['MANIFEST_VERIFIED', 'FAILED'],
  MANIFEST_VERIFIED: ['STAGED', 'FAILED'],
  STAGED: ['EXPAND_MIGRATED', 'FAILED'],
  EXPAND_MIGRATED: ['CANDIDATE_STARTED', 'FAILED'],
  CANDIDATE_STARTED: ['CANDIDATE_READY', 'FAILED'],
  CANDIDATE_READY: ['SINGLETON_TRANSFERRED', 'FAILED'],
  SINGLETON_TRANSFERRED: ['SWITCHED', 'ROLLBACK_PENDING', 'FAILED'],
  SWITCHED: ['OBSERVING', 'ROLLBACK_PENDING', 'AUTOMATIC_ROLLBACK_FORBIDDEN'],
  OBSERVING: ['COMMITTED', 'ROLLBACK_PENDING', 'AUTOMATIC_ROLLBACK_FORBIDDEN'],
  COMMITTED: ['IDLE'],
  ROLLBACK_PENDING: ['ROLLED_BACK', 'FAILED'],
  ROLLED_BACK: ['CANDIDATE_STARTED', 'IDLE'],
  AUTOMATIC_ROLLBACK_FORBIDDEN: ['FAILED'],
  FAILED: [],
});

export const TRANSITIONS = Object.freeze({
  IDLE: ['LOCKED'],
  LOCKED: ['MANIFEST_VERIFIED', 'FAILED'],
  MANIFEST_VERIFIED: ['STAGED', 'FAILED'],
  STAGED: ['EXPAND_MIGRATED', 'FAILED'],
  EXPAND_MIGRATED: ['CANDIDATE_STARTED', 'FAILED'],
  CANDIDATE_STARTED: ['CANDIDATE_READY', 'FAILED'],
  CANDIDATE_READY: ['SINGLETON_TRANSFERRED', 'FAILED'],
  SINGLETON_TRANSFERRED: ['SWITCHED', 'ROLLBACK_PENDING', 'FAILED'],
  SWITCHED: ['OBSERVING', 'ROLLBACK_PENDING', 'AUTOMATIC_ROLLBACK_FORBIDDEN'],
  OBSERVING: ['COMMITTED', 'ROLLBACK_PENDING', 'AUTOMATIC_ROLLBACK_FORBIDDEN'],
  COMMITTED: ['IDLE'],
  ROLLBACK_PENDING: ['ROLLED_BACK', 'FAILED'],
  ROLLED_BACK: ['CANDIDATE_STARTED', 'IDLE'],
  AUTOMATIC_ROLLBACK_FORBIDDEN: ['FAILED'],
  FAILED: ['FAILED_RECOVERED'],
  FAILED_RECOVERED: ['IDLE'],
});

const SLOT = new Set(['blue', 'green']);
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RELEASE_ID = /^booking-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ROOT_KEYS = new Set(['schema', 'environment', 'project', 'resources', 'runtimeEnvDigest', 'generation', 'fencingEpoch', 'phase', 'operationId', 'approvalId', 'lease', 'active', 'candidate', 'rollback', 'evidence', 'receiptChainHead', 'contractMigrationApplied', 'rollbackRehearsalCompleted', 'updatedAt']);
const V3_ROOT_KEYS = new Set([...ROOT_KEYS, 'recovery', 'observationWindowMinutes', 'observationStartedAt']);
const RECOVERY_KEYS = new Set(['databaseRestoreReceiptDigest', 'telegramAbortReceiptDigest', 'activeRuntimeRestoreReceiptDigest', 'activeProbeDigest', 'priorFailedStateDigest']);
const EVIDENCE_KEYS = new Set(['baselineReceiptDigest', 'expandMigrationReceiptDigest', 'telegramEgressReceiptDigest', 'stageReceiptDigest', 'candidateProbeDigest', 'rollbackPreSwitchProbeDigest', 'singletonTransferReceiptDigest', 'switchReceiptDigest', 'webhookReceiptDigest', 'observationReceiptDigest', 'rollbackReceiptDigest', 'rollbackSingletonTransferReceiptDigest', 'rolledBackProbeDigest']);
const POST_SWITCH_PHASES = new Set(['SWITCHED', 'OBSERVING', 'COMMITTED', 'ROLLBACK_PENDING', 'AUTOMATIC_ROLLBACK_FORBIDDEN']);
export const DEFAULT_OBSERVATION_WINDOW_MINUTES = 30;
export const MAX_OBSERVATION_WINDOW_MINUTES = 1440;

export const ROLLBACK_MODE = Object.freeze({
  PRE_SWITCH_SINGLETON: 'pre-switch-singleton',
  POST_SWITCH_FULL: 'post-switch-full',
});

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

function requireObservationWindow(value, path = 'state.observationWindowMinutes') {
  if (!Number.isInteger(value) || value < 1 || value > MAX_OBSERVATION_WINDOW_MINUTES) {
    throw new ContractError(`${path} must be an integer between 1 and ${MAX_OBSERVATION_WINDOW_MINUTES}`);
  }
  return value;
}

function observationWindowElapsed(state, now) {
  if (!state.observationStartedAt) return false;
  return Date.parse(now) - Date.parse(state.observationStartedAt) >= state.observationWindowMinutes * 60_000;
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

export function rollbackModeForState(state) {
  if (!state || typeof state !== 'object') throw new ContractError('rollback mode requires deployment state', EXIT.ROLLBACK);
  if (state.phase === 'SINGLETON_TRANSFERRED') return ROLLBACK_MODE.PRE_SWITCH_SINGLETON;
  if (state.phase === 'SWITCHED' || state.phase === 'OBSERVING') return ROLLBACK_MODE.POST_SWITCH_FULL;
  if (state.phase !== 'ROLLBACK_PENDING') throw new ContractError('rollback mode is unavailable outside a rollback-capable phase', EXIT.ROLLBACK);
  const preSwitch = Boolean(state.candidate !== null && state.evidence?.switchReceiptDigest === null && sameIdentity(state.active, state.rollback));
  const postSwitch = Boolean(state.candidate === null && DIGEST.test(state.evidence?.switchReceiptDigest || '') && !sameIdentity(state.active, state.rollback));
  if (preSwitch === postSwitch) throw new ContractError('rollback mode cannot be derived from the deployment state', EXIT.ROLLBACK);
  return preSwitch ? ROLLBACK_MODE.PRE_SWITCH_SINGLETON : ROLLBACK_MODE.POST_SWITCH_FULL;
}

function isLegacyOldActive(identity) {
  return identity?.slot === 'green' && identity.releaseId === LEGACY_OLD_BINDING.releaseId && identity.gitSha === LEGACY_OLD_BINDING.gitSha &&
    identity.manifestDigest === LEGACY_OLD_BINDING.manifestRawDigest;
}

function validateEvidence(evidence) {
  exactKeys(evidence, EVIDENCE_KEYS, 'state.evidence');
  for (const [key, value] of Object.entries(evidence)) {
    if (value !== null && !DIGEST.test(value)) throw new ContractError(`state.evidence.${key} is invalid`);
  }
}

export function validateDeployState(state) {
  if (state?.schema === 'booking.deploy-state/v2') exactKeys(state, ROOT_KEYS, 'state');
  else if (state?.schema === 'booking.deploy-state/v3') exactKeys(state, V3_ROOT_KEYS, 'state');
  else throw new ContractError('state.schema is unsupported');
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
  if (!DIGEST.test(state.runtimeEnvDigest || '')) throw new ContractError('state.runtimeEnvDigest is invalid');
  if (!Number.isInteger(state.generation) || state.generation < 0) throw new ContractError('state.generation is invalid');
  if (!Number.isInteger(state.fencingEpoch) || state.fencingEpoch < 0) throw new ContractError('state.fencingEpoch is invalid');
  const transitions = state.schema === 'booking.deploy-state/v2' ? V2_TRANSITIONS : TRANSITIONS;
  if (!(state.phase in transitions)) throw new ContractError('state.phase is invalid');
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
  if (typeof state.rollbackRehearsalCompleted !== 'boolean') throw new ContractError('state.rollbackRehearsalCompleted must be boolean');
  if (state.schema === 'booking.deploy-state/v3' && state.recovery !== null) {
    exactKeys(state.recovery, RECOVERY_KEYS, 'state.recovery');
    for (const [key, value] of Object.entries(state.recovery)) {
      if (!DIGEST.test(value || '')) throw new ContractError(`state.recovery.${key} is invalid`);
    }
  }
  if (state.schema === 'booking.deploy-state/v3' && state.phase === 'FAILED_RECOVERED') {
    if (!state.recovery) throw new ContractError('failed recovery phase requires immutable recovery evidence');
  } else if (state.schema === 'booking.deploy-state/v3' && state.recovery !== null) {
    throw new ContractError('recovery evidence is only valid in the failed recovery phase');
  }
  if (state.schema === 'booking.deploy-state/v3') {
    requireObservationWindow(state.observationWindowMinutes);
    if (state.observationStartedAt !== null) requireIso(state.observationStartedAt, 'state.observationStartedAt');
    if (state.phase === 'OBSERVING' && state.observationStartedAt === null) {
      throw new ContractError('observing state requires an immutable observation start');
    }
    if (['IDLE', 'LOCKED', 'MANIFEST_VERIFIED', 'STAGED', 'EXPAND_MIGRATED', 'CANDIDATE_STARTED', 'CANDIDATE_READY',
      'SINGLETON_TRANSFERRED', 'SWITCHED', 'FAILED_RECOVERED'].includes(state.phase) && state.observationStartedAt !== null) {
      throw new ContractError(`state.observationStartedAt is not allowed in phase ${state.phase}`);
    }
  }

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
  if (state.phase === 'ROLLBACK_PENDING') rollbackModeForState(state);
  return state;
}

export function initialDeployState({ environment, project, resources, active, runtimeEnvDigest,
  observationWindowMinutes = DEFAULT_OBSERVATION_WINDOW_MINUTES }, now) {
  validateIdentity(active, 'active');
  requireIso(now, 'now');
  return validateDeployState({
    schema: 'booking.deploy-state/v3', environment, project, resources: structuredClone(resources), runtimeEnvDigest, generation: 0, fencingEpoch: 0, phase: 'IDLE',
    operationId: null, approvalId: null, lease: null, active: structuredClone(active), candidate: null, rollback: null,
    evidence: Object.fromEntries([...EVIDENCE_KEYS].map((key) => [key, null])),
    receiptChainHead: null, contractMigrationApplied: false, rollbackRehearsalCompleted: false, updatedAt: now,
    recovery: null, observationWindowMinutes: requireObservationWindow(observationWindowMinutes), observationStartedAt: null,
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
  const runtimeEnvDigest = input.runtimeEnvDigest || state.runtimeEnvDigest;
  if (!DIGEST.test(runtimeEnvDigest || '')) throw new ContractError('runtime environment digest is required', EXIT.IDENTITY);
  const observationWindowMinutes = requireObservationWindow(
    input.observationWindowMinutes ?? state.observationWindowMinutes ?? DEFAULT_OBSERVATION_WINDOW_MINUTES,
    'observationWindowMinutes',
  );
  return validateDeployState({
    ...structuredClone(state), schema: 'booking.deploy-state/v3', generation: state.generation + 1, fencingEpoch: nextEpoch, phase: 'LOCKED',
    operationId: input.operationId, approvalId: input.approvalId,
    lease: { leaseId: input.leaseId, holderId: input.holderId, fencingEpoch: nextEpoch, acquiredAt: input.now, expiresAt: input.expiresAt },
    candidate: structuredClone(input.candidate), rollback: structuredClone(state.active), runtimeEnvDigest, updatedAt: input.now,
    recovery: null, observationWindowMinutes, observationStartedAt: null,
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
  const allowed = state.schema === 'booking.deploy-state/v2' && state.phase === 'FAILED' && nextPhase === 'FAILED_RECOVERED'
    ? true
    : (state.schema === 'booking.deploy-state/v2' ? V2_TRANSITIONS : TRANSITIONS)[state.phase].includes(nextPhase);
  if (!allowed) throw new ContractError(`transition ${state.phase} -> ${nextPhase} is not allowed`, EXIT.SWITCH);
  if (nextPhase === 'ROLLBACK_PENDING' && state.contractMigrationApplied) throw new ContractError('automatic rollback is forbidden after contract migration', EXIT.ROLLBACK);
  return true;
}

export function assertStaticTransition(state, nextPhase) {
  validateDeployState(state);
  const allowed = state.schema === 'booking.deploy-state/v2' && state.phase === 'FAILED' && nextPhase === 'FAILED_RECOVERED'
    ? true
    : (state.schema === 'booking.deploy-state/v2' ? V2_TRANSITIONS : TRANSITIONS)[state.phase].includes(nextPhase);
  if (!allowed) throw new ContractError(`transition ${state.phase} -> ${nextPhase} is not statically allowed`, EXIT.SWITCH);
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
  if (input.to === 'EXPAND_MIGRATED') {
    if (!DIGEST.test(input.expandMigrationReceiptDigest || '') || (isLegacyOldActive(state.active) && !DIGEST.test(input.baselineReceiptDigest || ''))) {
      throw new ContractError('expand migration requires fenced migration receipt evidence and the legacy baseline receipt when applicable', EXIT.DATABASE);
    }
    next.evidence.expandMigrationReceiptDigest = input.expandMigrationReceiptDigest;
    if (input.baselineReceiptDigest) next.evidence.baselineReceiptDigest = input.baselineReceiptDigest;
  }
  if (input.to === 'CANDIDATE_STARTED') {
    if (!DIGEST.test(input.stageReceiptDigest || '') || !DIGEST.test(input.telegramEgressReceiptDigest || '')) {
      throw new ContractError('candidate start requires fenced Telegram egress and stage receipt evidence', EXIT.READINESS);
    }
    if (!next.evidence.expandMigrationReceiptDigest) {
      throw new ContractError('candidate cannot start before the expand migration receipt is rooted', EXIT.DATABASE);
    }
    next.evidence.telegramEgressReceiptDigest = input.telegramEgressReceiptDigest;
    next.evidence.stageReceiptDigest = input.stageReceiptDigest;
    if (state.phase === 'ROLLED_BACK') {
      next.observationStartedAt = null;
      for (const key of ['candidateProbeDigest', 'rollbackPreSwitchProbeDigest', 'singletonTransferReceiptDigest', 'switchReceiptDigest',
        'webhookReceiptDigest', 'observationReceiptDigest']) {
        next.evidence[key] = null;
      }
    }
  }
  if (input.to === 'CANDIDATE_READY') {
    if (!DIGEST.test(input.candidateProbeDigest || '')) throw new ContractError('candidate readiness requires a fenced probe receipt', EXIT.READINESS);
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
    next.observationStartedAt = null;
  }
  if (input.to === 'OBSERVING') {
    if (!DIGEST.test(input.webhookReceiptDigest || '')) throw new ContractError('observation requires fenced webhook receipt evidence', EXIT.INGRESS);
    next.evidence.webhookReceiptDigest = input.webhookReceiptDigest;
    next.observationStartedAt = input.now;
  }
  if (input.to === 'COMMITTED') {
    if (!next.rollbackRehearsalCompleted || !next.evidence.webhookReceiptDigest || !DIGEST.test(input.observationReceiptDigest || '')) {
      throw new ContractError('commit requires a completed rollback rehearsal, webhook, and post-switch public probe evidence', EXIT.READINESS);
    }
    if (!observationWindowElapsed(state, input.now)) {
      throw new ContractError('commit requires the declared observation window to elapse', EXIT.READINESS);
    }
    next.evidence.observationReceiptDigest = input.observationReceiptDigest;
    next.rollbackRehearsalCompleted = false;
  }
  if (input.to === 'ROLLED_BACK') {
    const rollbackMode = rollbackModeForState(state);
    const postSwitch = rollbackMode === ROLLBACK_MODE.POST_SWITCH_FULL;
    if (!next.rollback || !DIGEST.test(input.rollbackSingletonTransferReceiptDigest || '') || !DIGEST.test(input.rolledBackProbeDigest || '') ||
        (postSwitch && !DIGEST.test(input.rollbackReceiptDigest || '')) || (!postSwitch && input.rollbackReceiptDigest !== undefined)) {
      throw new ContractError(postSwitch
        ? 'post-switch rollback requires immutable target, ingress receipt, singleton receipt, and post-rollback probe evidence'
        : 'pre-switch rollback requires immutable target, singleton receipt, and post-rollback probe evidence without ingress mutation evidence', EXIT.ROLLBACK);
    }
    if (postSwitch) next.evidence.rollbackReceiptDigest = input.rollbackReceiptDigest;
    next.evidence.rollbackSingletonTransferReceiptDigest = input.rollbackSingletonTransferReceiptDigest;
    next.evidence.rolledBackProbeDigest = input.rolledBackProbeDigest;
    next.evidence.telegramEgressReceiptDigest = null;
    next.evidence.stageReceiptDigest = null;
    const failedCandidate = structuredClone(next.candidate || next.active);
    next.active = structuredClone(next.rollback);
    next.candidate = failedCandidate;
    // A singleton-only abort before ingress promotion is a recovery, not a
    // rollback rehearsal. Preserve an earlier completed full rehearsal, but do
    // not create one from the pre-switch path.
    next.rollbackRehearsalCompleted = (postSwitch && observationWindowElapsed(state, input.now)) || state.rollbackRehearsalCompleted;
  }
  if (input.to === 'FAILED_RECOVERED') {
    if (!DIGEST.test(input.databaseRestoreReceiptDigest || '') || !DIGEST.test(input.telegramAbortReceiptDigest || '') ||
        !DIGEST.test(input.activeRuntimeRestoreReceiptDigest || '') || !DIGEST.test(input.activeProbeDigest || '') ||
        !DIGEST.test(input.priorFailedStateDigest || '')) {
      throw new ContractError('failed recovery requires database, Telegram, active runtime, public probe, and prior failed-state evidence', EXIT.IDENTITY);
    }
    next.schema = 'booking.deploy-state/v3';
    next.observationWindowMinutes = requireObservationWindow(
      input.observationWindowMinutes ?? DEFAULT_OBSERVATION_WINDOW_MINUTES,
      'observationWindowMinutes',
    );
    next.observationStartedAt = null;
    next.recovery = {
      databaseRestoreReceiptDigest: input.databaseRestoreReceiptDigest,
      telegramAbortReceiptDigest: input.telegramAbortReceiptDigest,
      activeRuntimeRestoreReceiptDigest: input.activeRuntimeRestoreReceiptDigest,
      activeProbeDigest: input.activeProbeDigest,
      priorFailedStateDigest: input.priorFailedStateDigest,
    };
  }
  if (input.to === 'IDLE') {
    // Terminal cleanup is an explicit v2 -> v3 migration boundary.  The
    // terminal receipt is still derived from the current terminal state, so a
    // legacy COMMITTED/ROLLED_BACK state continues to emit a v1 receipt while
    // the newly persisted IDLE state uses the current v3 contract.
    next.schema = 'booking.deploy-state/v3';
    next.operationId = null;
    next.approvalId = null;
    next.lease = null;
    next.candidate = null;
    next.rollback = null;
    next.evidence = Object.fromEntries([...EVIDENCE_KEYS].map((key) => [key, null]));
    next.contractMigrationApplied = false;
    next.rollbackRehearsalCompleted = false;
    next.recovery = null;
    if (state.schema === 'booking.deploy-state/v2') {
      next.observationWindowMinutes = requireObservationWindow(
        input.observationWindowMinutes ?? DEFAULT_OBSERVATION_WINDOW_MINUTES,
        'observationWindowMinutes',
      );
    }
    next.observationStartedAt = null;
  }
  return validateDeployState(next);
}
