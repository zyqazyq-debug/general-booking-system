import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { canonicalJson, ContractError, EXIT, sha256 } from './contracts.mjs';
import { canonicalStatePath } from './deploy-state-store.mjs';
import { withDeployStateLock } from './deploy-state-store.mjs';
import { validateDeployState } from './state-machine.mjs';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const EVIDENCE_BINDING_FIELDS = Object.freeze([
  'environment', 'project', 'operation-id', 'approval-id', 'expected-generation', 'expected-fencing-epoch', 'manifest-digest', 'lease-id', 'holder-id',
]);

export async function readEvidenceDeployBinding(args, runtime = {}) {
  for (const key of EVIDENCE_BINDING_FIELDS) if (!args[key]) throw new ContractError(`--${key} is required`, EXIT.IDENTITY);
  if (args.environment !== 'preprod' || args.project !== 'booking-preprod' || !DIGEST.test(args['manifest-digest'])) {
    throw new ContractError('evidence deployment scope is invalid', EXIT.IDENTITY);
  }
  for (const key of ['operation-id', 'approval-id', 'lease-id', 'holder-id']) {
    if (!IDENTIFIER.test(args[key])) throw new ContractError(`--${key} is invalid`, EXIT.IDENTITY);
  }
  const generation = Number(args['expected-generation']);
  if (!Number.isInteger(generation) || generation < 1) throw new ContractError('--expected-generation is invalid', EXIT.IDENTITY);
  const fencingEpoch = Number(args['expected-fencing-epoch']);
  if (!Number.isInteger(fencingEpoch) || fencingEpoch < 1) throw new ContractError('--expected-fencing-epoch is invalid', EXIT.IDENTITY);
  const statePath = await canonicalStatePath({ environment: args.environment, project: args.project, deployStateRoot: runtime.deployStateRoot });
  let state;
  try { state = validateDeployState(JSON.parse(await readFile(statePath, 'utf8'))); }
  catch { throw new ContractError('canonical deployment state is unavailable for evidence binding', EXIT.IDENTITY); }
  if (state.phase === 'IDLE' || !state.candidate || state.operationId !== args['operation-id'] || state.approvalId !== args['approval-id'] ||
      state.generation !== generation || state.fencingEpoch !== fencingEpoch || state.candidate.manifestDigest !== args['manifest-digest'] ||
      state.lease?.leaseId !== args['lease-id'] || state.lease?.holderId !== args['holder-id'] || state.lease.fencingEpoch !== fencingEpoch ||
      Date.parse(state.lease.expiresAt) <= (runtime.nowMs ?? Date.now())) {
    throw new ContractError('evidence request does not match the current fenced deployment operation', EXIT.IDENTITY);
  }
  return Object.freeze({ environment: state.environment, project: state.project, operationId: state.operationId, approvalId: state.approvalId,
    generation: state.generation, fencingEpoch: state.fencingEpoch, leaseId: state.lease.leaseId, holderId: state.lease.holderId,
    currentManifestDigest: state.candidate.manifestDigest, phase: state.phase, runtimeEnvDigest: state.runtimeEnvDigest });
}

export async function publishWithCurrentEvidenceBinding(args, binding, runtime, publish) {
  if (runtime.deploymentBinding) return publish();
  const statePath = await canonicalStatePath({ environment: args.environment, project: args.project, deployStateRoot: runtime.deployStateRoot });
  return withDeployStateLock(statePath, async (state) => {
    const current = { environment: state.environment, project: state.project, operationId: state.operationId, approvalId: state.approvalId,
      generation: binding.generation, fencingEpoch: state.fencingEpoch, leaseId: state.lease?.leaseId, holderId: state.lease?.holderId,
      currentManifestDigest: state.candidate?.manifestDigest, phase: state.phase, runtimeEnvDigest: state.runtimeEnvDigest };
    if (state.generation < binding.generation || canonicalJson(current) !== canonicalJson(binding) ||
        Date.parse(state.lease?.expiresAt || '') <= (runtime.nowMs ?? Date.now())) {
      throw new ContractError('evidence generation lost its canonical lease or fencing identity before publication', EXIT.IDENTITY);
    }
    const fixedPath = `/volume1/homes/realzyq/${state.project}/.env`;
    if (runtime.runtimeEnvFile !== undefined && runtime.allowInsecureTestPaths !== true) {
      throw new ContractError('runtime environment path cannot be supplied by the evidence publisher', EXIT.IDENTITY);
    }
    const configured = runtime.runtimeEnvFile || fixedPath;
    const canonical = await realpath(configured).catch(() => {
      throw new ContractError('fixed runtime environment file cannot be resolved before evidence publication', EXIT.IDENTITY);
    });
    const metadata = await stat(canonical);
    if (canonical !== resolve(configured) || !metadata.isFile() ||
        (!runtime.allowInsecureTestPaths && process.platform !== 'win32' && (metadata.uid !== 0 || (metadata.mode & 0o777) !== 0o600))) {
      throw new ContractError('runtime environment file must remain the fixed canonical root-owned 0600 regular file before evidence publication', EXIT.IDENTITY);
    }
    const runtimeEnvDigest = sha256(await readFile(canonical, 'utf8'));
    if (runtimeEnvDigest !== state.runtimeEnvDigest || runtimeEnvDigest !== binding.runtimeEnvDigest) {
      throw new ContractError('runtime environment digest drifted before evidence publication', EXIT.IDENTITY);
    }
    return publish();
  });
}
