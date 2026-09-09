import { Buffer } from 'node:buffer';

import { ContractError, canonicalJson, sha256 } from './contracts.mjs';

export const COSIGN_VERSION = '3.1.2';
export const COSIGN_SIGNING_MODE = 'cosign-v3.1.2-key-offline';
export const LOOPBACK_HTTP_REGISTRY = '127.0.0.1:15001';
export const ATTESTATION_TYPES = Object.freeze({
  'image-sbom': 'https://happybooking.uk/attestations/image-sbom/v2',
  'local-provenance': 'https://happybooking.uk/attestations/local-provenance/v1',
});
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;
const RELEASE = /^booking-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/;
const STATEMENT_TYPES = new Set(['https://in-toto.io/Statement/v0.1', 'https://in-toto.io/Statement/v1']);

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    throw new ContractError(`${label} does not match its exact schema`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) throw new ContractError(`${label} must be a SHA-256 digest`);
  return value;
}

function digestSet(values, label) {
  if (!Array.isArray(values) || values.length === 0 || new Set(values).size !== values.length) {
    throw new ContractError(`${label} must be a non-empty unique digest set`);
  }
  values.forEach((value, index) => digest(value, `${label}[${index}]`));
  if (JSON.stringify(values) !== JSON.stringify([...values].sort())) throw new ContractError(`${label} must be sorted`);
  return values;
}

export function evidencePredicate({ kind, component, releaseId, gitSha, manifestDigest, image, imageDigest, evidenceDigest, document }) {
  if (!Object.hasOwn(ATTESTATION_TYPES, kind)) throw new ContractError('registry evidence kind is unsupported');
  if (!['backend', 'gateway'].includes(component) || !RELEASE.test(releaseId || '') || !SHA.test(gitSha || '')) {
    throw new ContractError('registry evidence release identity is invalid');
  }
  digest(manifestDigest, 'registry evidence manifest digest');
  digest(imageDigest, 'registry evidence image digest');
  digest(evidenceDigest, 'registry evidence document digest');
  if (typeof image !== 'string' || !image || image.includes('@')) throw new ContractError('registry evidence image repository is invalid');
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new ContractError('registry evidence document is invalid');
  if (sha256(`${canonicalJson(document)}\n`) !== evidenceDigest) {
    throw new ContractError('registry evidence digest does not bind the canonical document bytes');
  }
  return {
    schema: 'booking.registry-evidence-predicate/v1',
    kind,
    component,
    releaseId,
    gitSha,
    manifestDigest,
    image: { name: image, digest: imageDigest },
    evidence: { digest: evidenceDigest, document },
  };
}

function parseJsonRecords(stdout, label) {
  const text = typeof stdout === 'string' ? stdout.trim() : '';
  if (!text) throw new ContractError(`${label} returned no verified records`);
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {}
  const records = [];
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    try { records.push(JSON.parse(line)); } catch { throw new ContractError(`${label} output is not JSON`); }
  }
  if (records.length === 0) throw new ContractError(`${label} returned no verified records`);
  return records;
}

function decodedPayload(record, label) {
  const encoded = record?.payload ?? record?.Payload;
  if (typeof encoded !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new ContractError(`${label} does not contain a strict base64 payload`);
  }
  let value;
  try { value = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); } catch { throw new ContractError(`${label} payload is not JSON`); }
  return value;
}

function digestHex(value, label) {
  exactObject(value, ['sha256'], label);
  if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) throw new ContractError(`${label}.sha256 is invalid`);
  return `sha256:${value.sha256}`;
}

export function verifyAttestationOutput(stdout, expected) {
  const records = parseJsonRecords(stdout, 'cosign verify-attestation');
  const statementDigests = new Set();
  for (const [index, record] of records.entries()) {
    const statement = decodedPayload(record, `verified attestation[${index}]`);
    exactObject(statement, ['_type', 'subject', 'predicateType', 'predicate'], `verified attestation[${index}] statement`);
    if (!STATEMENT_TYPES.has(statement._type) || statement.predicateType !== ATTESTATION_TYPES[expected.kind]) {
      throw new ContractError(`verified attestation[${index}] statement type is invalid`);
    }
    if (!Array.isArray(statement.subject) || statement.subject.length !== 1) throw new ContractError('verified attestation subject must be unique');
    const subject = exactObject(statement.subject[0], ['name', 'digest'], 'verified attestation subject');
    if (subject.name !== expected.image || digestHex(subject.digest, 'verified attestation subject digest') !== expected.imageDigest) {
      throw new ContractError('verified attestation subject does not bind the immutable image');
    }
    if (canonicalJson(statement.predicate) !== canonicalJson(expected.predicate)) {
      throw new ContractError('pulled-back attestation predicate differs from local immutable evidence');
    }
    statementDigests.add(sha256(statement));
  }
  return [...statementDigests].sort();
}

function caseInsensitiveValue(object, key) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return undefined;
  const match = Object.keys(object).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return match ? object[match] : undefined;
}

export function verifyImageSignatureOutput(stdout, { image, imageDigest, annotations }) {
  const records = parseJsonRecords(stdout, 'cosign verify');
  const payloadDigests = new Set();
  for (const [index, record] of records.entries()) {
    const payload = record?.critical ? record : decodedPayload(record, `verified image signature[${index}]`);
    const observedType = caseInsensitiveValue(payload?.critical, 'type');
    const observedRepository = caseInsensitiveValue(payload?.critical?.identity, 'docker-reference');
    const observedDigest = caseInsensitiveValue(payload?.critical?.image, 'docker-manifest-digest');
    if (observedType !== 'cosign container image signature' || observedRepository !== image ||
        (observedDigest !== imageDigest && observedDigest !== imageDigest.slice('sha256:'.length))) {
      throw new ContractError('verified image signature does not bind the immutable image digest');
    }
    const optional = payload.optional;
    if (!optional || typeof optional !== 'object' || Array.isArray(optional)) throw new ContractError('verified image signature annotations are absent');
    for (const [key, value] of Object.entries(annotations)) {
      if (optional[key] !== value) throw new ContractError(`verified image signature annotation drifted: ${key}`);
    }
    payloadDigests.add(sha256(payload));
  }
  return [...payloadDigests].sort();
}

export function validateRegistryAttestationReceipt(value, expected = {}) {
  exactObject(value, ['schema', 'component', 'registryTransport', 'releaseId', 'gitSha', 'manifestDigest', 'image', 'evidence', 'signer', 'verification', 'verifiedAt'], 'registry attestation receipt');
  if (value.schema !== 'booking.registry-attestation-receipt/v1' || !['backend', 'gateway'].includes(value.component) ||
      !RELEASE.test(value.releaseId || '') || !SHA.test(value.gitSha || '')) throw new ContractError('registry attestation receipt identity is invalid');
  if (!['https', 'loopback-http'].includes(value.registryTransport)) throw new ContractError('receipt registry transport is invalid');
  digest(value.manifestDigest, 'receipt manifest digest');
  exactObject(value.image, ['name', 'digest'], 'receipt image');
  if (typeof value.image.name !== 'string' || value.image.name.length === 0 || value.image.name.includes('@')) throw new ContractError('receipt image repository is invalid');
  if (value.registryTransport === 'loopback-http' && !value.image.name.startsWith(`${LOOPBACK_HTTP_REGISTRY}/`)) {
    throw new ContractError('receipt loopback HTTP transport is not bound to the approved registry');
  }
  digest(value.image.digest, 'receipt image digest');
  exactObject(value.evidence, ['sbomDigest', 'provenanceDigest'], 'receipt evidence');
  digest(value.evidence.sbomDigest, 'receipt SBOM digest');
  digest(value.evidence.provenanceDigest, 'receipt provenance digest');
  exactObject(value.signer, ['mode', 'cosignVersion', 'publicKeyDigest', 'signingMode'], 'receipt signer');
  if (value.signer.mode !== 'self-managed-key' || value.signer.cosignVersion !== COSIGN_VERSION) throw new ContractError('receipt signer is unsupported');
  digest(value.signer.publicKeyDigest, 'receipt public key digest');
  if (value.signer.signingMode !== COSIGN_SIGNING_MODE) throw new ContractError('receipt signing mode is unsupported');
  exactObject(value.verification, ['imageSignaturePayloadDigests', 'attestations', 'pullBackVerified'], 'receipt verification');
  digestSet(value.verification.imageSignaturePayloadDigests, 'receipt signature payload digests');
  if (value.verification.pullBackVerified !== true || !Array.isArray(value.verification.attestations) || value.verification.attestations.length !== 2) {
    throw new ContractError('receipt pull-back verification is incomplete');
  }
  for (const [index, kind] of ['image-sbom', 'local-provenance'].entries()) {
    const item = exactObject(value.verification.attestations[index], ['kind', 'predicateType', 'evidenceDigest', 'statementDigests'], `receipt attestations[${index}]`);
    if (item.kind !== kind || item.predicateType !== ATTESTATION_TYPES[kind]) throw new ContractError('receipt attestation order or type is invalid');
    digest(item.evidenceDigest, 'receipt attestation evidence digest');
    digestSet(item.statementDigests, 'receipt attestation statement digests');
  }
  if (typeof value.verifiedAt !== 'string' || !Number.isFinite(Date.parse(value.verifiedAt)) ||
      new Date(value.verifiedAt).toISOString() !== value.verifiedAt) throw new ContractError('receipt verifiedAt is invalid');
  for (const [path, observed] of Object.entries({
    component: value.component, registryTransport: value.registryTransport, releaseId: value.releaseId, gitSha: value.gitSha, manifestDigest: value.manifestDigest,
    image: value.image.name, imageDigest: value.image.digest, sbomDigest: value.evidence.sbomDigest,
    provenanceDigest: value.evidence.provenanceDigest, publicKeyDigest: value.signer.publicKeyDigest,
    signingMode: value.signer.signingMode,
  })) {
    if (expected[path] !== undefined && expected[path] !== observed) throw new ContractError(`registry attestation receipt binding drifted: ${path}`);
  }
  return value;
}
