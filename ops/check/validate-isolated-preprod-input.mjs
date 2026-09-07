#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SCHEMA = 'booking.g4-isolated-preprod-input/v1';
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RECEIPT_SUFFIX = /\.json$/;
const PROTECTED_IDENTITY = /(?:^|[-_/])booking-(?:prod|production)(?:[-_/]|$)/i;

export class IsolatedPreprodInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IsolatedPreprodInputError';
  }
}

function fail(message) {
  throw new IsolatedPreprodInputError(message);
}

function object(value, path, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${path} has missing or unsupported fields`);
  }
  return value;
}

function string(value, path, pattern) {
  if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value))) {
    fail(`${path} is invalid`);
  }
  return value;
}

function isolatedPath(value, path, { receipt = false, projectRoot = null } = {}) {
  const resolved = string(value, path);
  if (!resolved.startsWith('/') || resolved.includes('\0') || PROTECTED_IDENTITY.test(resolved)) {
    fail(`${path} must be an isolated absolute path`);
  }
  if (!resolved.includes('booking-preprod')) fail(`${path} must identify booking-preprod`);
  if (receipt && !RECEIPT_SUFFIX.test(resolved)) fail(`${path} must be a JSON receipt path`);
  if (projectRoot && !resolved.startsWith(`${projectRoot}/`)) {
    fail(`${path} must remain below nas.projectRoot`);
  }
  return resolved;
}

function url(value, path, { httpsOnly = false } = {}) {
  const raw = string(value, path);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail(`${path} is not an HTTP(S) URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || (httpsOnly && parsed.protocol !== 'https:') || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    fail(`${path} must be a credential-free origin URL`);
  }
  return raw;
}

function digest(value, path) {
  return string(value, path, DIGEST);
}

function slot(value, path) {
  if (value !== 'blue' && value !== 'green') fail(`${path} must be blue or green`);
  return value;
}

function receiptPaths(input) {
  return [
    input.release.manifestPath,
    input.database.armedGateReceiptPath,
    input.database.backupReceiptPath,
    input.database.restoreReceiptPath,
    input.lease.switchReceiptPath,
    input.telegram.deliveryReceiptPath,
    input.rollback.previousReleaseManifestPath,
    input.rollback.observationReceiptPath,
  ];
}

export function validateIsolatedPreprodInput(input) {
  object(input, 'input', ['schema', 'environment', 'nas', 'networks', 'release', 'probes', 'edge', 'telegram', 'database', 'lease', 'rollback']);
  if (input.schema !== SCHEMA) fail('input.schema is unsupported');

  object(input.environment, 'environment', ['name', 'tier', 'externalChangesAuthorized']);
  if (input.environment.name !== 'booking-preprod' || input.environment.tier !== 'preprod') fail('environment must be booking-preprod/preprod');
  if (input.environment.externalChangesAuthorized !== false) fail('local preflight cannot authorize external changes');

  object(input.nas, 'nas', ['projectRoot', 'dataRoot', 'secretRoot']);
  const projectRoot = isolatedPath(input.nas.projectRoot, 'nas.projectRoot');
  isolatedPath(input.nas.dataRoot, 'nas.dataRoot');
  isolatedPath(input.nas.secretRoot, 'nas.secretRoot');
  if (new Set(Object.values(input.nas)).size !== 3) fail('NAS project, data, and secret roots must be distinct');

  object(input.networks, 'networks', ['edge', 'data']);
  string(input.networks.edge, 'networks.edge', /^booking-preprod-[a-z0-9-]+$/);
  string(input.networks.data, 'networks.data', /^booking-preprod-[a-z0-9-]+$/);
  if (input.networks.edge === input.networks.data) fail('edge and data networks must be distinct');

  object(input.release, 'release', ['manifestPath', 'manifestDigest', 'backendImageDigest', 'gatewayImageDigest']);
  isolatedPath(input.release.manifestPath, 'release.manifestPath', { projectRoot });
  digest(input.release.manifestDigest, 'release.manifestDigest');
  digest(input.release.backendImageDigest, 'release.backendImageDigest');
  digest(input.release.gatewayImageDigest, 'release.gatewayImageDigest');
  if (input.release.backendImageDigest === input.release.gatewayImageDigest) fail('backend and gateway image digests must differ');

  object(input.probes, 'probes', ['candidate', 'ingress', 'paths']);
  object(input.probes.candidate, 'probes.candidate', ['slot', 'baseUrl']);
  const candidateSlot = slot(input.probes.candidate.slot, 'probes.candidate.slot');
  url(input.probes.candidate.baseUrl, 'probes.candidate.baseUrl');
  object(input.probes.ingress, 'probes.ingress', ['baseUrl']);
  url(input.probes.ingress.baseUrl, 'probes.ingress.baseUrl', { httpsOnly: true });
  object(input.probes.paths, 'probes.paths', ['live', 'ready', 'version']);
  if (input.probes.paths.live !== '/livez' || input.probes.paths.ready !== '/readyz' || input.probes.paths.version !== '/__ops/version') {
    fail('probe paths must use the immutable release contract endpoints');
  }

  object(input.edge, 'edge', ['stableOriginRef', 'activeUpstreamPath', 'candidateUpstreamRef']);
  if (input.edge.stableOriginRef !== 'edge:booking-preprod') fail('edge.stableOriginRef is invalid');
  isolatedPath(input.edge.activeUpstreamPath, 'edge.activeUpstreamPath', { projectRoot });
  if (!['gateway-blue', 'gateway-green'].includes(input.edge.candidateUpstreamRef)) fail('edge.candidateUpstreamRef is invalid');
  if (input.edge.candidateUpstreamRef !== `gateway-${candidateSlot}`) fail('edge candidate upstream must match probe candidate slot');

  object(input.telegram, 'telegram', ['fixtureBotIdentityRef', 'webhookPath', 'deliveryReceiptPath']);
  string(input.telegram.fixtureBotIdentityRef, 'telegram.fixtureBotIdentityRef', /^fixture:[a-z0-9-]+$/);
  if (input.telegram.webhookPath !== '/telegram/webhook') fail('telegram.webhookPath must be /telegram/webhook');
  isolatedPath(input.telegram.deliveryReceiptPath, 'telegram.deliveryReceiptPath', { receipt: true, projectRoot });

  object(input.database, 'database', ['armedGateReceiptPath', 'backupReceiptPath', 'restoreReceiptPath']);
  for (const key of Object.keys(input.database)) {
    isolatedPath(input.database[key], `database.${key}`, { receipt: true, projectRoot });
  }
  if (new Set(Object.values(input.database)).size !== 3) fail('database receipt paths must be distinct');

  object(input.lease, 'lease', ['activeSlot', 'candidateSlot', 'expectedGeneration', 'expectedFencingEpoch', 'candidateWorkersEnabled', 'switchReceiptPath']);
  const activeSlot = slot(input.lease.activeSlot, 'lease.activeSlot');
  if (slot(input.lease.candidateSlot, 'lease.candidateSlot') !== candidateSlot || activeSlot === candidateSlot) fail('lease slots must identify the inactive candidate');
  if (!Number.isInteger(input.lease.expectedGeneration) || input.lease.expectedGeneration < 0) fail('lease.expectedGeneration is invalid');
  if (!Number.isInteger(input.lease.expectedFencingEpoch) || input.lease.expectedFencingEpoch < 1) fail('lease.expectedFencingEpoch is invalid');
  if (input.lease.candidateWorkersEnabled !== false) fail('candidate workers must remain disabled during preflight');
  isolatedPath(input.lease.switchReceiptPath, 'lease.switchReceiptPath', { receipt: true, projectRoot });

  object(input.rollback, 'rollback', ['windowMinutes', 'previousReleaseManifestPath', 'observationReceiptPath']);
  if (!Number.isInteger(input.rollback.windowMinutes) || input.rollback.windowMinutes < 1 || input.rollback.windowMinutes > 1440) fail('rollback.windowMinutes must be between 1 and 1440');
  isolatedPath(input.rollback.previousReleaseManifestPath, 'rollback.previousReleaseManifestPath', { projectRoot });
  if (input.rollback.previousReleaseManifestPath === input.release.manifestPath) fail('rollback manifest must differ from candidate manifest');
  isolatedPath(input.rollback.observationReceiptPath, 'rollback.observationReceiptPath', { receipt: true, projectRoot });

  return input;
}

export function verifyLocalEvidenceFiles(input) {
  for (const file of receiptPaths(input)) {
    if (!existsSync(file) || !statSync(file).isFile()) fail(`local evidence file is missing: ${file}`);
  }
  return true;
}

function result(status, detail = null, inputPath = null) {
  const checks = [{ name: 'isolated-preprod-input', status, code: status === 'pass' ? 'INPUT_CONTRACT_VALID' : 'INPUT_CONTRACT_INVALID', ...(detail ? { detail } : {}) }];
  return {
    schema: 'booking.g4-local-preflight-result/v1',
    gate: 'isolated-preprod-input',
    status,
    inputPath,
    checks,
    evidenceDigest: `sha256:${createHash('sha256').update(JSON.stringify(checks)).digest('hex')}`,
  };
}

function parseArgs(argv) {
  const verifyLocalEvidence = argv.includes('--verify-local-evidence');
  const inputIndex = argv.indexOf('--input');
  const expectedLength = verifyLocalEvidence ? 3 : 2;
  if (inputIndex === -1 || !argv[inputIndex + 1] || argv.length !== expectedLength) {
    fail('usage: --input <isolated-preprod-input.json> [--verify-local-evidence]');
  }
  return { inputPath: argv[inputIndex + 1], verifyLocalEvidence };
}

async function main() {
  let output;
  let exitCode = 0;
  try {
    const args = parseArgs(process.argv.slice(2));
    const input = JSON.parse(readFileSync(args.inputPath, 'utf8'));
    validateIsolatedPreprodInput(input);
    if (args.verifyLocalEvidence) verifyLocalEvidenceFiles(input);
    output = result('pass', null, args.inputPath);
  } catch (error) {
    exitCode = 10;
    const detail = error instanceof Error ? error.message : 'unexpected validation failure';
    output = result('fail', detail.slice(0, 512));
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
