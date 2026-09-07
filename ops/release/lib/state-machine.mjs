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
const STATE_KEYS = new Set([
  'schema', 'generation', 'activeSlot', 'activeRelease', 'candidateSlot', 'candidateRelease',
  'previousSlot', 'previousRelease', 'phase', 'manifestDigest', 'operationId', 'contractMigrationApplied',
]);
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CANDIDATE_PHASES = new Set([
  'MANIFEST_VERIFIED', 'STAGED', 'EXPAND_MIGRATED', 'CANDIDATE_STARTED', 'CANDIDATE_READY',
  'SINGLETON_TRANSFERRED',
]);

export function validateDeployState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new ContractError('state must be an object');
  for (const key of STATE_KEYS) {
    if (!(key in state)) throw new ContractError(`state.${key} is required`);
  }
  for (const key of Object.keys(state)) {
    if (!STATE_KEYS.has(key)) throw new ContractError(`state.${key} is not allowed`);
  }
  if (state.schema !== 'booking.deploy-state/v1') throw new ContractError('state.schema is unsupported');
  if (!Number.isInteger(state.generation) || state.generation < 0) throw new ContractError('state.generation is invalid');
  if (!SLOT.has(state.activeSlot) || typeof state.activeRelease !== 'string' || !state.activeRelease) {
    throw new ContractError('active slot identity is invalid');
  }
  if (!(state.phase in TRANSITIONS)) throw new ContractError('state.phase is invalid');
  if ((state.candidateSlot === null) !== (state.candidateRelease === null)) {
    throw new ContractError('candidate slot and release must both be set or both be null');
  }
  if (state.candidateSlot !== null) {
    if (!SLOT.has(state.candidateSlot) || state.candidateSlot === state.activeSlot) {
      throw new ContractError('candidate slot must be the inactive slot');
    }
    if (typeof state.candidateRelease !== 'string' || !state.candidateRelease) {
      throw new ContractError('candidate release is invalid');
    }
  }
  if ((state.previousSlot === null) !== (state.previousRelease === null)) {
    throw new ContractError('previous slot and release must both be set or both be null');
  }
  if (state.previousSlot !== null && (!SLOT.has(state.previousSlot) || typeof state.previousRelease !== 'string' || !state.previousRelease)) {
    throw new ContractError('previous slot identity is invalid');
  }
  if (state.manifestDigest !== null && !DIGEST.test(state.manifestDigest)) throw new ContractError('manifestDigest is invalid');
  if (state.operationId !== null && (typeof state.operationId !== 'string' || !state.operationId)) {
    throw new ContractError('operationId is invalid');
  }
  if (typeof state.contractMigrationApplied !== 'boolean') {
    throw new ContractError('contractMigrationApplied must be boolean');
  }
  if (state.phase !== 'IDLE' && !state.operationId) throw new ContractError('non-idle state requires operationId');
  if (CANDIDATE_PHASES.has(state.phase) && (!state.candidateSlot || !state.manifestDigest)) {
    throw new ContractError('candidate phase requires candidate identity and manifest digest');
  }
  return state;
}

export function assertTransition(state, nextPhase, expectedGeneration) {
  validateDeployState(state);
  if (!Number.isInteger(expectedGeneration) || state.generation !== expectedGeneration) {
    throw new ContractError('deployment generation mismatch', EXIT.SWITCH);
  }
  if (!TRANSITIONS[state.phase].includes(nextPhase)) {
    throw new ContractError(`transition ${state.phase} -> ${nextPhase} is not allowed`, EXIT.SWITCH);
  }
  if (nextPhase === 'SWITCHED' && !state.candidateSlot) {
    throw new ContractError('cannot switch without a candidate slot', EXIT.SWITCH);
  }
  if (nextPhase === 'ROLLBACK_PENDING' && state.contractMigrationApplied) {
    throw new ContractError('automatic rollback is forbidden after contract migration', EXIT.ROLLBACK);
  }
  return true;
}
