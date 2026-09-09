#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { constants } from 'node:fs';
import { access, link, lstat, mkdir, open, realpath, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { canonicalDocument, digestFile, imageDigest, imageRepository, validateImageSbom } from './lib/artifacts.mjs';
import { ContractError, gateResult, parseArgs, readJsonFile } from './lib/contracts.mjs';

export const SYFT_VERSION = '1.51.1';
export const SYFT_JSON_SCHEMA_MAJOR = 16;
const SHA = /^[0-9a-f]{40}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const COMPONENTS = new Set(['backend', 'gateway']);
const ALLOWED_ARGS = new Set(['execute', 'component', 'git-sha', 'image', 'image-digest', 'native-output', 'output']);

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    throw new ContractError(`${label} does not match its exact schema`);
  }
  return value;
}

function regularString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new ContractError(`${label} must be a non-empty string`);
  return value;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function parseImageSbomArgs(argv) {
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 2) {
    const item = argv[index];
    const key = typeof item === 'string' && item.startsWith('--') ? item.slice(2) : '';
    if (!ALLOWED_ARGS.has(key)) throw new ContractError(`unsupported image SBOM argument: ${item}`);
    if (seen.has(key)) throw new ContractError(`duplicate image SBOM argument: --${key}`);
    seen.add(key);
  }
  return parseArgs(argv);
}

function scannerEnvironment(input = process.env) {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key.toUpperCase().startsWith('SYFT_') && value !== undefined) output[key] = value;
  }
  return {
    ...output,
    SYFT_CHECK_FOR_APP_UPDATE: 'false',
    SYFT_FILE_METADATA_SELECTION: 'all',
    SYFT_FILE_METADATA_DIGESTS: 'sha256',
    SYFT_FORMAT_JSON_LEGACY: 'false',
    SYFT_LOG_QUIET: 'true',
    SYFT_SCOPE: 'squashed',
  };
}

function runCapture(executable, args, { env = process.env, timeoutMs = 60_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 8 * 1024 * 1024) child.kill('SIGKILL');
      else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 64 * 1024) stderr.push(chunk);
    });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolvePromise({ exitCode, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
  });
}

function runToFile(executable, args, outputPath, { env = process.env, timeoutMs = 1_800_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const output = createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
    const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const stderr = [];
    let stderrBytes = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise(value);
    };
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.pipe(output);
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 64 * 1024) stderr.push(chunk);
    });
    output.on('error', (error) => { child.kill('SIGKILL'); finish(error); });
    child.on('error', (error) => finish(error));
    child.on('close', (exitCode, signal) => {
      output.end(() => finish(null, { exitCode, signal, stderr: Buffer.concat(stderr).toString('utf8') }));
    });
  });
}

async function assertUnusedOutput(path, label) {
  const metadata = await lstat(path).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (metadata) throw new ContractError(`${label} already exists; immutable evidence is never overwritten`);
}

async function assertTrustedEvidenceDirectory(path, runtime) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const canonical = await realpath(path);
  const metadata = await stat(canonical);
  if (!metadata.isDirectory()) throw new ContractError(`evidence parent is not a directory: ${path}`);
  if (!runtime.allowInsecureTestPaths && (process.platform === 'win32' || metadata.uid !== 0 || (metadata.mode & 0o077) !== 0)) {
    throw new ContractError(`evidence parent must be a root-only directory: ${path}`);
  }
  return canonical;
}

async function publishExclusive(tempPath, outputPath) {
  await link(tempPath, outputPath).catch((error) => {
    if (error?.code === 'EEXIST') throw new ContractError(`immutable evidence already exists: ${outputPath}`);
    throw error;
  });
  await unlink(tempPath);
}

async function syncFile(path) {
  if (process.platform === 'win32') return;
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function findTrustedExecutable(candidates, label) {
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      const canonical = await realpath(candidate);
      const metadata = await stat(canonical);
      if (!metadata.isFile() || (process.platform !== 'win32' && (metadata.uid !== 0 || (metadata.mode & 0o022) !== 0))) {
        throw new ContractError(`${label} executable is not a root-owned immutable regular file`);
      }
      return canonical;
    } catch (error) {
      if (error instanceof ContractError) throw error;
    }
  }
  throw new ContractError(`trusted ${label} executable is unavailable`);
}

function parseDockerInspect(stdout, { imageRef, component, gitSha }) {
  let value;
  try { value = JSON.parse(stdout); } catch { throw new ContractError('Docker image inspect did not return JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError('Docker image inspect result is invalid');
  const repoDigests = value.RepoDigests;
  if (!Array.isArray(repoDigests) || !repoDigests.includes(imageRef)) {
    throw new ContractError('Docker image does not expose the exact requested repository digest');
  }
  if (typeof value.Id !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value.Id)) {
    throw new ContractError('Docker image ID is invalid');
  }
  const labels = value.Config?.Labels;
  if (!labels || labels['org.opencontainers.image.revision'] !== gitSha || labels['uk.happybooking.component'] !== component) {
    throw new ContractError('Docker image labels do not bind the requested Git SHA and component');
  }
  return { imageId: value.Id, repoDigests: [...repoDigests].sort(), gitSha, component };
}

function sameDockerIdentity(before, after) {
  return JSON.stringify(before) === JSON.stringify(after);
}

export function normalizeSyftImageSbom(native, { component, gitSha, image, digest, nativeDigest, imageId }) {
  if (!COMPONENTS.has(component)) throw new ContractError('SBOM component is unsupported');
  if (!SHA.test(gitSha || '')) throw new ContractError('SBOM Git SHA is invalid');
  const repository = imageRepository(image, 'SBOM image');
  const immutableDigest = imageDigest(digest, 'SBOM image digest');
  imageDigest(nativeDigest, 'native Syft document digest');
  const imageRef = `${repository}@${immutableDigest}`;

  if (!native || typeof native !== 'object' || Array.isArray(native)) throw new ContractError('Syft document must be an object');
  if (native.descriptor?.name !== 'syft' || native.descriptor?.version !== SYFT_VERSION) {
    throw new ContractError(`Syft descriptor must bind version ${SYFT_VERSION}`);
  }
  const schemaVersion = native.schema?.version;
  if (typeof schemaVersion !== 'string' || !new RegExp(`^${SYFT_JSON_SCHEMA_MAJOR}\\.[0-9]+\\.[0-9]+$`).test(schemaVersion)) {
    throw new ContractError(`Syft JSON schema major must be ${SYFT_JSON_SCHEMA_MAJOR}`);
  }
  if (native.source?.type !== 'image') throw new ContractError('Syft source must be a container image');
  const metadata = native.source?.metadata;
  const nativeManifestDigest = metadata?.manifestDigest;
  if (native.source?.name !== repository || native.source?.version !== immutableDigest || metadata?.userInput !== imageRef ||
      !Array.isArray(metadata?.repoDigests) || !metadata.repoDigests.includes(imageRef)) {
    throw new ContractError('Syft source does not bind the exact requested repository digest');
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(nativeManifestDigest || '') || native.source?.id !== nativeManifestDigest.slice(7)) {
    throw new ContractError('Syft source native manifest identity is invalid');
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(metadata?.imageID || '') || (imageId && metadata.imageID !== imageId)) {
    throw new ContractError('Syft source does not bind the Docker image ID');
  }
  const syftFiles = native.descriptor?.configuration?.files;
  if (syftFiles?.selection !== 'all' || !Array.isArray(syftFiles.hashers) ||
      syftFiles.hashers.length !== 1 || syftFiles.hashers[0] !== 'sha-256' ||
      native.descriptor?.configuration?.search?.scope !== 'squashed') {
    throw new ContractError('Syft descriptor does not prove squashed all-file SHA-256 cataloging');
  }

  if (!Array.isArray(native.artifacts) || native.artifacts.length === 0) {
    throw new ContractError('Syft package inventory must not be empty');
  }
  const packageKeys = new Set();
  const packages = native.artifacts.map((entry, index) => {
    const normalized = {
      name: regularString(entry?.name, `Syft artifacts[${index}].name`),
      version: regularString(entry?.version, `Syft artifacts[${index}].version`),
      purl: regularString(entry?.purl, `Syft artifacts[${index}].purl`),
    };
    if (!normalized.purl.startsWith('pkg:')) throw new ContractError(`Syft artifacts[${index}].purl is invalid`);
    const key = `${normalized.name}\0${normalized.version}\0${normalized.purl}`;
    if (packageKeys.has(key)) throw new ContractError(`Syft artifacts[${index}] duplicates a normalized package`);
    packageKeys.add(key);
    return normalized;
  }).sort((left, right) => compareText(left.purl, right.purl) || compareText(left.name, right.name) || compareText(left.version, right.version));

  if (!Array.isArray(native.files) || native.files.length === 0) throw new ContractError('Syft file inventory must not be empty');
  const filePaths = new Set();
  const files = native.files.map((entry, index) => {
    const path = entry?.location?.path;
    if (typeof path !== 'string' || !path.startsWith('/') || filePaths.has(path)) {
      throw new ContractError(`Syft files[${index}] path is non-absolute or duplicated`);
    }
    filePaths.add(path);
    const matches = Array.isArray(entry.digests) ? entry.digests.filter((item) => item?.algorithm?.toLowerCase() === 'sha256') : [];
    if (matches.length !== 1 || !SHA256_HEX.test(matches[0]?.value || '')) {
      throw new ContractError(`Syft files[${index}] must have exactly one lowercase SHA-256 digest`);
    }
    return { path, digest: `sha256:${matches[0].value}` };
  }).sort((left, right) => compareText(left.path, right.path));

  const document = {
    schema: 'booking.image-sbom/v2', component,
    image: { name: repository, digest: immutableDigest },
    source: { gitSha },
    scanner: { name: 'syft', version: SYFT_VERSION, schemaVersion, nativeDigest, fileSelection: 'all', fileDigestAlgorithm: 'sha256' },
    packages,
    files,
  };
  validateImageSbom(document, { component, gitSha, image: repository, digest: immutableDigest });
  return document;
}

export async function generateImageSbom(args, runtime = {}) {
  for (const key of Object.keys(args)) if (!ALLOWED_ARGS.has(key)) throw new ContractError(`unsupported image SBOM argument: --${key}`);
  if (args.execute !== 'true') throw new ContractError('--execute true is required');
  const component = args.component;
  if (!COMPONENTS.has(component) || !SHA.test(args['git-sha'] || '') || !args.image || !args['image-digest'] || !args['native-output'] || !args.output) {
    throw new ContractError('--component, --git-sha, --image, --image-digest, --native-output, and --output are required');
  }
  const repository = imageRepository(args.image, '--image');
  const digest = imageDigest(args['image-digest'], '--image-digest');
  const imageRef = `${repository}@${digest}`;
  const nativeOutput = resolve(args['native-output']);
  const output = resolve(args.output);
  if (nativeOutput === output) throw new ContractError('--native-output and --output must differ');
  await Promise.all([assertUnusedOutput(nativeOutput, 'native Syft output'), assertUnusedOutput(output, 'normalized SBOM output')]);
  await Promise.all([
    assertTrustedEvidenceDirectory(dirname(nativeOutput), runtime),
    assertTrustedEvidenceDirectory(dirname(output), runtime),
  ]);
  const nativeTemp = `${nativeOutput}.${process.pid}.${randomUUID()}.tmp`;
  const normalizedTemp = `${output}.${process.pid}.${randomUUID()}.tmp`;
  const dockerExecutable = runtime.dockerExecutable || await findTrustedExecutable([
    '/var/packages/ContainerManager/target/usr/bin/docker', '/usr/bin/docker',
  ], 'Docker');
  const syftExecutable = runtime.syftExecutable || await findTrustedExecutable(['/usr/local/bin/syft'], 'Syft');
  const capture = runtime.commandRunner || runCapture;
  const scanToFile = runtime.scanRunner || (runtime.commandRunner ? async (executable, commandArgs, path, options) => {
    const result = await runtime.commandRunner(executable, commandArgs, options);
    if (result.exitCode === 0) await writeFile(path, result.stdout, { flag: 'wx', mode: 0o600 });
    return result;
  } : runToFile);
  let nativePublished = false;
  try {
    const versionResult = await capture(syftExecutable, ['version', '-o', 'json'], { timeoutMs: 30_000, env: scannerEnvironment(runtime.env) });
    let version;
    try { version = JSON.parse(versionResult.stdout)?.version; } catch { throw new ContractError('Syft version output is not JSON'); }
    if (versionResult.exitCode !== 0 || version !== SYFT_VERSION) throw new ContractError(`Syft executable must be pinned to ${SYFT_VERSION}`);
    const inspectArgs = ['image', 'inspect', '--format', '{{json .}}', imageRef];
    const beforeResult = await capture(dockerExecutable, inspectArgs, { timeoutMs: 60_000, env: runtime.env || process.env });
    if (beforeResult.exitCode !== 0) throw new ContractError('Docker could not inspect the immutable image before scanning');
    const before = parseDockerInspect(beforeResult.stdout, { imageRef, component, gitSha: args['git-sha'] });

    const scanResult = await scanToFile(syftExecutable, ['scan', imageRef, '--from', 'docker', '--output', 'syft-json'], nativeTemp, {
      timeoutMs: 1_800_000, env: scannerEnvironment(runtime.env),
    });
    if (scanResult.exitCode !== 0) throw new ContractError(`Syft image scan failed${scanResult.stderr ? `: ${scanResult.stderr.trim().slice(0, 500)}` : ''}`);
    await syncFile(nativeTemp);
    const native = await readJsonFile(nativeTemp);
    const nativeDocumentDigest = await digestFile(nativeTemp);
    const normalized = normalizeSyftImageSbom(native, {
      component, gitSha: args['git-sha'], image: repository, digest,
      nativeDigest: nativeDocumentDigest, imageId: before.imageId,
    });
    await writeFile(normalizedTemp, canonicalDocument(normalized), { flag: 'wx', mode: 0o600 });
    await syncFile(normalizedTemp);

    const afterResult = await capture(dockerExecutable, inspectArgs, { timeoutMs: 60_000, env: runtime.env || process.env });
    if (afterResult.exitCode !== 0) throw new ContractError('Docker could not inspect the immutable image after scanning');
    const after = parseDockerInspect(afterResult.stdout, { imageRef, component, gitSha: args['git-sha'] });
    if (!sameDockerIdentity(before, after)) throw new ContractError('Docker image identity changed during the Syft scan');

    await publishExclusive(nativeTemp, nativeOutput);
    nativePublished = true;
    await publishExclusive(normalizedTemp, output);
    return { document: normalized, nativeDigest: nativeDocumentDigest, normalizedDigest: await digestFile(output), imageId: after.imageId };
  } catch (error) {
    if (nativePublished) await rm(nativeOutput, { force: true });
    throw error;
  } finally {
    await Promise.all([rm(nativeTemp, { force: true }), rm(normalizedTemp, { force: true })]);
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const result = await generateImageSbom(parseImageSbomArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(gateResult({ gate: 'syft-image-sbom', checks: [{ name: result.document.component, status: 'pass', code: 'IMAGE_SBOM_GENERATED' }] }))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 10;
  }
}
