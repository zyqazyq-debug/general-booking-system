import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const EXIT = Object.freeze({
  PASS: 0,
  CONTRACT: 10,
  IDENTITY: 20,
  READINESS: 30,
  DATABASE: 40,
  SINGLETON: 50,
  INGRESS: 60,
  SWITCH: 70,
  ROLLBACK: 80,
});

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RELEASE_ID = /^booking-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const SECRET_KEY = /(secret|token|password|credential|private[_-]?key|authorization)/i;

export class ContractError extends Error {
  constructor(message, exitCode = EXIT.CONTRACT) {
    super(message);
    this.name = 'ContractError';
    this.exitCode = exitCode;
  }
}

function requireObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractError(`${path} must be an object`);
  }
  return value;
}

function exactKeys(value, required, allowed, path) {
  const object = requireObject(value, path);
  for (const key of required) {
    if (!(key in object)) throw new ContractError(`${path}.${key} is required`);
  }
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) throw new ContractError(`${path}.${key} is not allowed`);
  }
  return object;
}

function requireString(value, path, pattern) {
  if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value))) {
    throw new ContractError(`${path} is invalid`);
  }
  return value;
}

function requireDigest(value, path) {
  return requireString(value, path, DIGEST);
}

function rejectSecretFields(value, path = 'manifest') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new ContractError(`${path}.${key} may contain secret material`);
    rejectSecretFields(item, `${path}.${key}`);
  }
}

function validateImageArtifact(value, path, gateway = false) {
  const required = ['image', 'digest', 'sbomDigest'];
  if (gateway) required.push('frontendAssetDigest', 'routeContractDigest');
  exactKeys(value, required, required, path);
  const image = requireString(value.image, `${path}.image`);
  if (image === 'latest' || image.endsWith(':latest') || image.includes('@')) {
    throw new ContractError(`${path}.image must be a repository without tag or digest`, EXIT.IDENTITY);
  }
  requireDigest(value.digest, `${path}.digest`);
  requireDigest(value.sbomDigest, `${path}.sbomDigest`);
  if (gateway) {
    requireDigest(value.frontendAssetDigest, `${path}.frontendAssetDigest`);
    requireDigest(value.routeContractDigest, `${path}.routeContractDigest`);
  }
}

export function validateReleaseManifest(value) {
  rejectSecretFields(value);
  const rootKeys = ['schema', 'releaseId', 'source', 'artifacts', 'contracts', 'runtime', 'probes'];
  exactKeys(value, rootKeys, rootKeys, 'manifest');
  if (value.schema !== 'booking.release/v1') throw new ContractError('manifest.schema is unsupported');
  requireString(value.releaseId, 'manifest.releaseId', RELEASE_ID);

  exactKeys(value.source, ['gitSha', 'treeState'], ['gitSha', 'treeState'], 'manifest.source');
  requireString(value.source.gitSha, 'manifest.source.gitSha', GIT_SHA);
  if (value.source.treeState !== 'clean') throw new ContractError('manifest source tree must be clean', EXIT.IDENTITY);

  exactKeys(value.artifacts, ['backend', 'gateway'], ['backend', 'gateway'], 'manifest.artifacts');
  validateImageArtifact(value.artifacts.backend, 'manifest.artifacts.backend');
  validateImageArtifact(value.artifacts.gateway, 'manifest.artifacts.gateway', true);

  const contractKeys = ['configSchema', 'apiVersion', 'frontendCompatibleApi', 'migrationExpandFloor', 'rollbackCompatibleRelease'];
  exactKeys(value.contracts, contractKeys, contractKeys, 'manifest.contracts');
  requireString(value.contracts.configSchema, 'manifest.contracts.configSchema', /^booking\.config\/v[1-9][0-9]*$/);
  requireString(value.contracts.apiVersion, 'manifest.contracts.apiVersion', /^v[1-9][0-9]*$/);
  requireString(value.contracts.frontendCompatibleApi, 'manifest.contracts.frontendCompatibleApi', /^v[1-9][0-9]*$/);
  requireString(value.contracts.migrationExpandFloor, 'manifest.contracts.migrationExpandFloor');
  if (value.contracts.rollbackCompatibleRelease !== null) {
    requireString(value.contracts.rollbackCompatibleRelease, 'manifest.contracts.rollbackCompatibleRelease', RELEASE_ID);
  }

  exactKeys(value.runtime, ['nodeMajor', 'targetPlatform'], ['nodeMajor', 'targetPlatform'], 'manifest.runtime');
  if (!Number.isInteger(value.runtime.nodeMajor) || value.runtime.nodeMajor < 20) {
    throw new ContractError('manifest.runtime.nodeMajor is invalid');
  }
  requireString(value.runtime.targetPlatform, 'manifest.runtime.targetPlatform', /^linux\/(amd64|arm64)$/);

  exactKeys(value.probes, ['live', 'ready', 'version'], ['live', 'ready', 'version'], 'manifest.probes');
  for (const key of ['live', 'ready', 'version']) {
    requireString(value.probes[key], `manifest.probes.${key}`, /^\/[A-Za-z0-9_./-]*$/);
  }
  if (value.probes.live === value.probes.ready) {
    throw new ContractError('liveness and readiness paths must be distinct');
  }
  return value;
}

export function validateIngressContract(value) {
  rejectSecretFields(value, 'ingress');
  const keys = ['schema', 'hostname', 'origin', 'healthPath', 'versionPath', 'webhookPath', 'owner'];
  exactKeys(value, keys, keys, 'ingress');
  if (value.schema !== 'booking.ingress/v1') throw new ContractError('ingress.schema is unsupported');
  requireString(value.hostname, 'ingress.hostname', /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
  exactKeys(value.origin, ['scheme', 'service', 'port'], ['scheme', 'service', 'port'], 'ingress.origin');
  if (!['http', 'https'].includes(value.origin.scheme)) throw new ContractError('ingress.origin.scheme is invalid');
  requireString(value.origin.service, 'ingress.origin.service');
  if (!Number.isInteger(value.origin.port) || value.origin.port < 1 || value.origin.port > 65535) {
    throw new ContractError('ingress.origin.port is invalid');
  }
  requireString(value.healthPath, 'ingress.healthPath', /^\//);
  requireString(value.versionPath, 'ingress.versionPath', /^\//);
  if (value.webhookPath !== '/telegram/webhook') {
    throw new ContractError('Telegram webhook must be exactly /telegram/webhook', EXIT.INGRESS);
  }
  if (value.owner !== 'booking-nas-cloudflare') throw new ContractError('ingress.owner is invalid');
  return value;
}

export async function readJsonFile(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new ContractError(`cannot read JSON file: ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ContractError(`invalid JSON file: ${path}`);
  }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  const bytes = typeof value === 'string' ? value : canonicalJson(value);
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function gateResult({ gate, releaseId = 'unknown', slot = null, checks }) {
  const normalized = checks.map((check) => ({
    name: String(check.name),
    status: check.status === 'pass' ? 'pass' : 'fail',
    ...(check.code ? { code: String(check.code) } : {}),
    ...(check.detail ? { detail: String(check.detail).slice(0, 512) } : {}),
  }));
  return {
    schema: 'booking.gate-result/v1',
    gate,
    releaseId,
    slot,
    status: normalized.every((check) => check.status === 'pass') ? 'pass' : 'fail',
    observedAt: new Date().toISOString(),
    checks: normalized,
    evidenceDigest: sha256(normalized),
  };
}

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) throw new ContractError(`unexpected argument: ${item}`);
    const key = item.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new ContractError(`missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

export function safeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ContractError('base URL is invalid', EXIT.INGRESS);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ContractError('base URL must be HTTP(S) without credentials, query, or fragment', EXIT.INGRESS);
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  return url;
}
