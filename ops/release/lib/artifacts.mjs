import { createHash } from 'node:crypto';
import { readdir, lstat, readFile, realpath } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

import { ContractError, canonicalJson, readJsonFile, sha256, validateReleaseManifest } from './contracts.mjs';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;
const HTTPS_APT_MIRROR = /^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?\/[A-Za-z0-9._~/-]*[A-Za-z0-9._~-]$/;
const COMPONENTS = new Set(['backend', 'gateway', 'telegram-egress']);
const LOCAL_PROVENANCE_PREDICATE_TYPE = 'urn:booking:attestation:local-provenance:v1';
const LOCAL_BUILD_TYPE = 'urn:booking:build:local-release:v1';
export const DEFAULT_TELEGRAM_EGRESS_APT_SOURCES = Object.freeze({
  debianMirror: 'https://deb.debian.org/debian',
  securityMirror: 'https://deb.debian.org/debian-security',
});
const BUILD_INPUTS = Object.freeze({
  backend: Object.freeze(['backend/Dockerfile', 'backend/package.json', 'backend/package-lock.json']),
  gateway: Object.freeze(['frontend/Dockerfile', 'frontend/nginx.release.conf.template', 'frontend/nginx.preprod.conf', 'frontend/package.json', 'frontend/package-lock.json']),
  'telegram-egress': Object.freeze(['ops/telegram-egress/Dockerfile', 'ops/telegram-egress/entrypoint.sh', 'ops/telegram-egress/healthcheck.sh', 'ops/telegram-egress/readback.sh']),
});

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    throw new ContractError(`${label} does not match its exact schema`);
  }
  return value;
}

function exactDigest(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) throw new ContractError(`${label} must be a sha256 digest`);
  return value;
}

function digestDescriptor(value) {
  return { sha256: exactDigest(value, 'descriptor digest').slice('sha256:'.length) };
}

function descriptorDigest(value, label) {
  exactObject(value, ['sha256'], label);
  if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) {
    throw new ContractError(`${label}.sha256 must be a lowercase sha256 digest`);
  }
  return `sha256:${value.sha256}`;
}

export function digestBytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export async function digestFile(path) {
  try {
    return digestBytes(await readFile(path));
  } catch {
    throw new ContractError(`cannot read artifact: ${path}`);
  }
}

export function imageRepository(value, label = 'image') {
  if (typeof value !== 'string' || !value || value.includes('@') || value.includes('registry.example.invalid')) {
    throw new ContractError(`${label} must be a non-placeholder image repository`);
  }
  const finalSegment = value.slice(value.lastIndexOf('/') + 1);
  if (finalSegment.includes(':') || finalSegment === 'latest' || value.endsWith(':latest')) {
    throw new ContractError(`${label} must not contain a mutable tag`);
  }
  return value;
}

export function imageDigest(value, label = 'image digest') {
  if (typeof value !== 'string' || !DIGEST.test(value)) throw new ContractError(`${label} must be a sha256 digest`);
  return value;
}

export function telegramEgressBaseImage(dockerfileText, requestedReference) {
  const base = /^ARG TELEGRAM_EGRESS_BASE_IMAGE=debian:bookworm-20260824-slim@(sha256:[0-9a-f]{64})$/m.exec(dockerfileText || '');
  const split = typeof requestedReference === 'string' ? requestedReference.lastIndexOf('@') : -1;
  if (!base || split < 1) throw new ContractError('--telegram-egress-base-image must be an immutable repository@sha256 reference');
  const image = requestedReference.slice(0, split);
  if (!/^[A-Za-z0-9._:/-]+$/.test(image) || image.endsWith(':latest') || image.includes('registry.example.invalid')) {
    throw new ContractError('--telegram-egress-base-image repository is invalid');
  }
  const digest = imageDigest(requestedReference.slice(split + 1), '--telegram-egress-base-image digest');
  if (digest !== base[1]) throw new ContractError('Telegram egress base image digest differs from the reviewed Dockerfile input');
  return { image, digest };
}

export function httpsAptMirror(value, label = 'APT mirror') {
  let parsed;
  try { parsed = new URL(value); } catch { throw new ContractError(`${label} must be an absolute HTTPS URL`); }
  if (!HTTPS_APT_MIRROR.test(value) || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash ||
      !parsed.hostname || parsed.pathname === '/' || parsed.pathname.endsWith('/') || parsed.href !== value) {
    throw new ContractError(`${label} must be a canonical credential-free HTTPS repository URL`);
  }
  return value;
}

function validatedTelegramEgressAptSources(requested) {
  if (!requested || typeof requested !== 'object' || Array.isArray(requested) ||
      Object.keys(requested).sort().join(',') !== ['debianMirror', 'securityMirror'].sort().join(',')) {
    throw new ContractError('Telegram egress APT sources must be explicitly recorded');
  }
  return {
    debianMirror: httpsAptMirror(requested.debianMirror, 'Telegram egress Debian mirror'),
    securityMirror: httpsAptMirror(requested.securityMirror, 'Telegram egress security mirror'),
  };
}

export function telegramEgressAptSources(dockerfileText, requested) {
  const defaultDebian = /^ARG TELEGRAM_EGRESS_DEBIAN_MIRROR=(https:\/\/[^\s]+)$/m.exec(dockerfileText || '');
  const defaultSecurity = /^ARG TELEGRAM_EGRESS_DEBIAN_SECURITY_MIRROR=(https:\/\/[^\s]+)$/m.exec(dockerfileText || '');
  if (defaultDebian?.[1] !== DEFAULT_TELEGRAM_EGRESS_APT_SOURCES.debianMirror ||
      defaultSecurity?.[1] !== DEFAULT_TELEGRAM_EGRESS_APT_SOURCES.securityMirror) {
    throw new ContractError('Telegram egress Dockerfile APT defaults differ from the reviewed official HTTPS sources');
  }
  return validatedTelegramEgressAptSources(requested);
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new ContractError(`git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

export function cleanGitSource(root) {
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status) throw new ContractError('release generation requires a clean Git worktree');
  const gitSha = git(root, ['rev-parse', 'HEAD']);
  if (!SHA.test(gitSha)) throw new ContractError('Git HEAD is not a full SHA');
  const commitEpoch = Number(git(root, ['show', '-s', '--format=%ct', 'HEAD']));
  if (!Number.isSafeInteger(commitEpoch)) throw new ContractError('Git commit timestamp is invalid');
  return { gitSha, committedAt: new Date(commitEpoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') };
}

export async function directoryDigest(root, label = 'directory') {
  const entries = [];
  async function visit(path) {
    let children;
    try {
      children = await readdir(path, { withFileTypes: true });
    } catch {
      throw new ContractError(`cannot read ${label}: ${root}`);
    }
    for (const child of children) {
      const childPath = resolve(path, child.name);
      const stat = await lstat(childPath);
      if (stat.isSymbolicLink()) throw new ContractError(`${label} must not contain symbolic links`);
      if (stat.isDirectory()) await visit(childPath);
      else if (stat.isFile()) entries.push({ path: relative(root, childPath).split(sep).join('/'), digest: await digestFile(childPath) });
      else throw new ContractError(`${label} contains an unsupported file type`);
    }
  }
  await visit(root);
  if (entries.length === 0) throw new ContractError(`${label} must not be empty`);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return sha256(entries);
}

export async function migrationCatalog(root) {
  const migrationDirectory = resolve(root, 'backend/src/migrations');
  let files;
  try {
    files = (await readdir(migrationDirectory)).filter((file) => /^[0-9]{10,}-[A-Za-z0-9][A-Za-z0-9-]*\.ts$/.test(file)).sort();
  } catch {
    throw new ContractError('migration directory is unavailable');
  }
  if (files.length === 0) throw new ContractError('migration directory is empty');
  const catalog = [];
  for (const file of files) catalog.push({ migration: basename(file, '.ts'), digest: await digestFile(resolve(migrationDirectory, file)) });
  return { expandFloor: catalog.at(-1).migration, catalogDigest: sha256(catalog) };
}

export async function expectedBuildInputFiles(root, component) {
  const inputs = BUILD_INPUTS[component];
  if (!inputs) throw new ContractError('build-input component is unsupported');
  const files = [];
  for (const path of inputs) files.push({ path, digest: await digestFile(resolve(root, path)) });
  return files;
}

export async function createBuildInputInventory(root, component, gitSha, { baseImage = null, aptSources = null } = {}) {
  if (!SHA.test(gitSha || '')) throw new ContractError('build-input Git SHA is invalid');
  if (component === 'telegram-egress' && (typeof baseImage !== 'string' || !/^[A-Za-z0-9._:/-]+@sha256:[0-9a-f]{64}$/.test(baseImage))) {
    throw new ContractError('Telegram egress build inventory must bind its actual base image');
  }
  const telegramAptSources = component === 'telegram-egress' ? validatedTelegramEgressAptSources(aptSources) : null;
  if (component !== 'telegram-egress' && aptSources !== null) throw new ContractError('APT source parameters are supported only for Telegram egress');
  return {
    schema: 'booking.build-input-inventory/v1',
    component,
    source: { gitSha },
    ...(component === 'telegram-egress' ? { parameters: { baseImage, ...telegramAptSources } } : {}),
    files: await expectedBuildInputFiles(root, component),
  };
}

export function validateBuildInputInventory(document, { component, gitSha, expectedFiles, baseImage = null, aptSources = null } = {}) {
  const telegramEgress = (component || document?.component) === 'telegram-egress';
  exactObject(document, telegramEgress ? ['schema', 'component', 'source', 'parameters', 'files'] : ['schema', 'component', 'source', 'files'], 'build-input inventory');
  if (document.schema !== 'booking.build-input-inventory/v1') throw new ContractError('build-input inventory schema is unsupported');
  if (!COMPONENTS.has(document.component) || (component && document.component !== component)) {
    throw new ContractError('build-input inventory component is invalid');
  }
  exactObject(document.source, ['gitSha'], 'build-input inventory source');
  if (!SHA.test(document.source.gitSha || '') || (gitSha && document.source.gitSha !== gitSha)) {
    throw new ContractError('build-input inventory does not bind the release Git SHA');
  }
  if (telegramEgress) {
    exactObject(document.parameters, ['baseImage', 'debianMirror', 'securityMirror'], 'build-input inventory parameters');
    if (typeof document.parameters.baseImage !== 'string' || !/^[A-Za-z0-9._:/-]+@sha256:[0-9a-f]{64}$/.test(document.parameters.baseImage) ||
        (baseImage && document.parameters.baseImage !== baseImage)) throw new ContractError('build-input base image binding is invalid');
    const observedAptSources = validatedTelegramEgressAptSources({
      debianMirror: document.parameters.debianMirror, securityMirror: document.parameters.securityMirror,
    });
    if (aptSources && JSON.stringify(observedAptSources) !== JSON.stringify(validatedTelegramEgressAptSources(aptSources))) {
      throw new ContractError('build-input APT source binding is invalid');
    }
  }
  const inventory = BUILD_INPUTS[document.component];
  if (!Array.isArray(document.files) || document.files.length === 0 || document.files.length !== inventory.length) {
    throw new ContractError('build-input file inventory is incomplete');
  }
  document.files.forEach((file, index) => {
    exactObject(file, ['path', 'digest'], `build-input files[${index}]`);
    if (file.path !== inventory[index]) throw new ContractError('build-input file inventory is not the exact expected inventory');
    exactDigest(file.digest, `build-input files[${index}].digest`);
    if (expectedFiles && (expectedFiles[index]?.path !== file.path || expectedFiles[index]?.digest !== file.digest)) {
      throw new ContractError(`build-input digest does not match the clean source: ${file.path}`);
    }
  });
  if (expectedFiles && expectedFiles.length !== document.files.length) throw new ContractError('build-input expected inventory is invalid');
  return document;
}

export function validateImageSbom(document, { component, gitSha, image, digest, baseImage = null, aptSources = null } = {}) {
  const telegramEgress = (component || document?.component) === 'telegram-egress';
  exactObject(document, telegramEgress ? ['schema', 'component', 'image', 'source', 'scanner', 'buildInputs', 'packages', 'files'] :
    ['schema', 'component', 'image', 'source', 'scanner', 'packages', 'files'], 'image SBOM');
  if (document.schema !== 'booking.image-sbom/v2') throw new ContractError('image SBOM schema is unsupported');
  if (!COMPONENTS.has(document.component) || (component && document.component !== component)) {
    throw new ContractError('image SBOM component is invalid');
  }
  exactObject(document.image, ['name', 'digest'], 'image SBOM image');
  imageRepository(document.image.name, 'image SBOM image name');
  imageDigest(document.image.digest, 'image SBOM image digest');
  if ((image && document.image.name !== image) || (digest && document.image.digest !== digest)) {
    throw new ContractError('image SBOM does not bind the requested immutable image identity');
  }
  exactObject(document.source, ['gitSha'], 'image SBOM source');
  if (!SHA.test(document.source.gitSha || '') || (gitSha && document.source.gitSha !== gitSha)) {
    throw new ContractError('image SBOM does not bind the release Git SHA');
  }
  exactObject(document.scanner, ['name', 'version', 'schemaVersion', 'nativeDigest', 'fileSelection', 'fileDigestAlgorithm'], 'image SBOM scanner');
  if (document.scanner.name !== 'syft' || document.scanner.version !== '1.51.1' ||
      !/^16\.[0-9]+\.[0-9]+$/.test(document.scanner.schemaVersion || '') ||
      document.scanner.fileSelection !== 'all' || document.scanner.fileDigestAlgorithm !== 'sha256') {
    throw new ContractError('image SBOM scanner binding is unsupported');
  }
  exactDigest(document.scanner.nativeDigest, 'image SBOM scanner native digest');
  if (telegramEgress) {
    exactObject(document.buildInputs, ['baseImage', 'debianMirror', 'securityMirror'], 'image SBOM build inputs');
    if (typeof document.buildInputs.baseImage !== 'string' || !/^[A-Za-z0-9._:/-]+@sha256:[0-9a-f]{64}$/.test(document.buildInputs.baseImage) ||
        (baseImage && document.buildInputs.baseImage !== baseImage)) throw new ContractError('image SBOM base image binding is invalid');
    const observedAptSources = validatedTelegramEgressAptSources({ debianMirror: document.buildInputs.debianMirror,
      securityMirror: document.buildInputs.securityMirror });
    if (aptSources && JSON.stringify(observedAptSources) !== JSON.stringify(validatedTelegramEgressAptSources(aptSources))) {
      throw new ContractError('image SBOM APT source binding is invalid');
    }
  }
  if (!Array.isArray(document.packages) || document.packages.length === 0) {
    throw new ContractError('image SBOM package inventory must not be empty');
  }
  document.packages.forEach((entry, index) => {
    exactObject(entry, ['name', 'version', 'purl'], `image SBOM packages[${index}]`);
    if (![entry.name, entry.version].every((value) => typeof value === 'string' && value.length > 0) ||
        typeof entry.purl !== 'string' || !entry.purl.startsWith('pkg:')) {
      throw new ContractError(`image SBOM packages[${index}] is invalid`);
    }
  });
  if (!Array.isArray(document.files) || document.files.length === 0) {
    throw new ContractError('image SBOM file inventory must not be empty');
  }
  const paths = new Set();
  document.files.forEach((entry, index) => {
    exactObject(entry, ['path', 'digest'], `image SBOM files[${index}]`);
    if (typeof entry.path !== 'string' || !entry.path.startsWith('/') || paths.has(entry.path)) {
      throw new ContractError(`image SBOM files[${index}].path is invalid or duplicated`);
    }
    paths.add(entry.path);
    exactDigest(entry.digest, `image SBOM files[${index}].digest`);
  });
  return document;
}

export function createLocalProvenance({ component, gitSha, image, digest, sbomDigest, baseImage = null, aptSources = null }) {
  if (!COMPONENTS.has(component)) throw new ContractError('provenance component is unsupported');
  if (!SHA.test(gitSha || '')) throw new ContractError('provenance Git SHA is invalid');
  imageRepository(image, 'provenance image');
  imageDigest(digest, 'provenance image digest');
  exactDigest(sbomDigest, 'provenance SBOM digest');
  if (component === 'telegram-egress' && (typeof baseImage !== 'string' || !/^[A-Za-z0-9._:/-]+@sha256:[0-9a-f]{64}$/.test(baseImage))) {
    throw new ContractError('Telegram egress provenance must bind its actual immutable base image');
  }
  const telegramAptSources = component === 'telegram-egress' ? validatedTelegramEgressAptSources(aptSources) : null;
  if (component !== 'telegram-egress' && (baseImage !== null || aptSources !== null)) {
    throw new ContractError('base image and APT materials are supported only for Telegram egress provenance');
  }
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: image, digest: digestDescriptor(digest) }],
    predicateType: LOCAL_PROVENANCE_PREDICATE_TYPE,
    predicate: {
      schema: 'booking.local-provenance-predicate/v1',
      component,
      buildType: LOCAL_BUILD_TYPE,
      source: { gitSha },
      materials: [
        { uri: `urn:booking:sbom:${component}`, digest: digestDescriptor(sbomDigest) },
        { uri: image, digest: digestDescriptor(digest) },
        ...(baseImage ? [{ uri: baseImage.slice(0, baseImage.lastIndexOf('@')), digest: digestDescriptor(baseImage.slice(baseImage.lastIndexOf('@') + 1)) }] : []),
        ...(telegramAptSources ? [
          { uri: telegramAptSources.debianMirror, digest: digestDescriptor(digestBytes(telegramAptSources.debianMirror)) },
          { uri: telegramAptSources.securityMirror, digest: digestDescriptor(digestBytes(telegramAptSources.securityMirror)) },
        ] : []),
      ],
    },
  };
}

export function validateLocalProvenance(document, { component, gitSha, image, digest, sbomDigest, baseImage = null, aptSources = null } = {}) {
  exactObject(document, ['_type', 'subject', 'predicateType', 'predicate'], 'provenance');
  if (document._type !== 'https://in-toto.io/Statement/v1') throw new ContractError('provenance statement type is unsupported');
  if (document.predicateType !== LOCAL_PROVENANCE_PREDICATE_TYPE) throw new ContractError('provenance predicateType is unsupported');
  if (!Array.isArray(document.subject) || document.subject.length !== 1) throw new ContractError('provenance must have exactly one subject');
  const subject = exactObject(document.subject[0], ['name', 'digest'], 'provenance subject');
  imageRepository(subject.name, 'provenance subject image');
  const subjectDigest = descriptorDigest(subject.digest, 'provenance subject digest');
  exactObject(document.predicate, ['schema', 'component', 'buildType', 'source', 'materials'], 'provenance predicate');
  if (document.predicate.schema !== 'booking.local-provenance-predicate/v1') throw new ContractError('provenance predicate schema is unsupported');
  if (!COMPONENTS.has(document.predicate.component) || (component && document.predicate.component !== component)) {
    throw new ContractError('provenance component is invalid');
  }
  if (document.predicate.buildType !== LOCAL_BUILD_TYPE) throw new ContractError('provenance buildType is unsupported');
  exactObject(document.predicate.source, ['gitSha'], 'provenance source');
  if (!SHA.test(document.predicate.source.gitSha || '') || (gitSha && document.predicate.source.gitSha !== gitSha)) {
    throw new ContractError('provenance does not bind the release Git SHA');
  }
  const expectedComponent = component || document.predicate.component;
  const expectedMaterialCount = expectedComponent === 'telegram-egress' ? 5 : 2;
  if (!Array.isArray(document.predicate.materials) || document.predicate.materials.length !== expectedMaterialCount) {
    throw new ContractError('provenance materials must bind the exact SBOM, image, and component-specific build inputs');
  }
  const [sbomMaterial, imageMaterial] = document.predicate.materials;
  exactObject(sbomMaterial, ['uri', 'digest'], 'provenance SBOM material');
  exactObject(imageMaterial, ['uri', 'digest'], 'provenance image material');
  const sbomMaterialDigest = descriptorDigest(sbomMaterial.digest, 'provenance SBOM material digest');
  const imageMaterialDigest = descriptorDigest(imageMaterial.digest, 'provenance image material digest');
  if (sbomMaterial.uri !== `urn:booking:sbom:${expectedComponent}` || (sbomDigest && sbomMaterialDigest !== sbomDigest)) {
    throw new ContractError('provenance does not bind the requested SBOM digest');
  }
  if (imageMaterial.uri !== subject.name || imageMaterialDigest !== subjectDigest ||
      (image && subject.name !== image) || (digest && subjectDigest !== digest)) {
    throw new ContractError('provenance does not bind one immutable image identity');
  }
  if (expectedComponent === 'telegram-egress') {
    const baseMaterial = exactObject(document.predicate.materials[2], ['uri', 'digest'], 'provenance base image material');
    const observedBase = `${baseMaterial.uri}@${descriptorDigest(baseMaterial.digest, 'provenance base image material digest')}`;
    if (!baseImage || observedBase !== baseImage) throw new ContractError('Telegram egress provenance does not bind the selected base image');
    const expectedAptSources = validatedTelegramEgressAptSources(aptSources);
    for (const [index, key] of ['debianMirror', 'securityMirror'].entries()) {
      const material = exactObject(document.predicate.materials[index + 3], ['uri', 'digest'], `provenance ${key} material`);
      if (material.uri !== expectedAptSources[key] || descriptorDigest(material.digest, `provenance ${key} material digest`) !== digestBytes(expectedAptSources[key])) {
        throw new ContractError(`Telegram egress provenance does not bind the selected ${key}`);
      }
    }
  }
  return document;
}

export async function readArtifact(path, component, gitSha, image, digest, kind, options = {}) {
  const document = await readJsonFile(path);
  if (kind === 'SBOM') {
    validateImageSbom(document, { component, gitSha, image, digest, baseImage: options.baseImage || null, aptSources: options.aptSources || null });
    if (!options.nativePath) throw new ContractError('native Syft document is required to verify the normalized SBOM');
    if (await digestFile(options.nativePath) !== document.scanner.nativeDigest) {
      throw new ContractError('normalized SBOM does not bind the supplied native Syft document');
    }
  } else if (kind === 'provenance') {
    validateLocalProvenance(document, { component, gitSha, image, digest, sbomDigest: options.sbomDigest,
      baseImage: options.baseImage || null, aptSources: options.aptSources || null });
  } else {
    throw new ContractError(`unsupported artifact kind: ${kind}`);
  }
  return digestFile(path);
}

export async function canonicalSourceFile(root, callerPath, relativePath, argument) {
  if (!callerPath) throw new ContractError(`${argument} is required`);
  const expected = resolve(root, relativePath);
  const canonicalExpected = await realpath(expected).catch(() => { throw new ContractError(`${argument} canonical project file is unavailable`); });
  const canonicalCaller = await realpath(callerPath).catch(() => { throw new ContractError(`${argument} cannot be resolved`); });
  const metadata = await lstat(expected);
  if (canonicalExpected !== expected || canonicalCaller !== expected || !metadata.isFile() || metadata.isSymbolicLink()) {
    throw new ContractError(`${argument} must be the exact regular file from the clean Git source`);
  }
  return expected;
}

export async function releaseInputs(root, args) {
  const source = cleanGitSource(root);
  const targetPlatform = args['target-platform'];
  if (!/^linux\/(amd64|arm64)$/.test(targetPlatform || '')) throw new ContractError('--target-platform must be linux/amd64 or linux/arm64');
  const artifact = {};
  const egressBaseReference = args['telegram-egress-base-image'];
  if (typeof egressBaseReference !== 'string' || !/^[A-Za-z0-9._:/-]+@sha256:[0-9a-f]{64}$/.test(egressBaseReference)) {
    throw new ContractError('--telegram-egress-base-image must be an immutable repository@sha256 reference');
  }
  const egressAptSources = validatedTelegramEgressAptSources({
    debianMirror: args['telegram-egress-debian-mirror'],
    securityMirror: args['telegram-egress-security-mirror'],
  });
  const egressBuildInputPath = args['telegram-egress-build-input-inventory'];
  if (!egressBuildInputPath) throw new ContractError('--telegram-egress-build-input-inventory is required');
  const egressBuildInputDocument = await readJsonFile(egressBuildInputPath);
  validateBuildInputInventory(egressBuildInputDocument, { component: 'telegram-egress', gitSha: source.gitSha,
    expectedFiles: await expectedBuildInputFiles(root, 'telegram-egress'), baseImage: egressBaseReference, aptSources: egressAptSources });
  const egressBuildInputDigest = await digestFile(egressBuildInputPath);
  for (const component of COMPONENTS) {
    const image = imageRepository(args[`${component}-image`], `--${component}-image`);
    const digest = imageDigest(args[`${component}-digest`], `--${component}-digest`);
    const sbomPath = args[`${component}-sbom`];
    const nativeSbomPath = args[`${component}-native-sbom`];
    const provenancePath = args[`${component}-provenance`];
    if (!sbomPath || !nativeSbomPath || !provenancePath) throw new ContractError(`${component} native/normalized SBOM and provenance inputs are required`);
    const sbomDigest = await readArtifact(sbomPath, component, source.gitSha, image, digest, 'SBOM', {
      root, nativePath: nativeSbomPath,
      ...(component === 'telegram-egress' ? { baseImage: egressBaseReference, aptSources: egressAptSources } : {}),
    });
    const artifactKey = component === 'telegram-egress' ? 'telegramEgress' : component;
    artifact[artifactKey] = {
      image,
      digest,
      sbomDigest,
      provenanceDigest: await readArtifact(provenancePath, component, source.gitSha, image, digest, 'provenance', {
        sbomDigest, ...(component === 'telegram-egress' ? { baseImage: egressBaseReference, aptSources: egressAptSources } : {}),
      }),
    };
  }
  const frontendDirectory = args['frontend-dir'];
  if (!frontendDirectory) throw new ContractError('--frontend-dir is required');
  const routeContract = await canonicalSourceFile(root, args['route-contract'], 'frontend/nginx.preprod.conf', '--route-contract');
  artifact.gateway.frontendAssetDigest = await directoryDigest(frontendDirectory, 'H5 artifact directory');
  artifact.gateway.routeContractDigest = await digestFile(routeContract);
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(args['telegram-bot-username'] || '')) {
    throw new ContractError('--telegram-bot-username is invalid');
  }
  if (typeof args['telegram-bot-display-name'] !== 'string' || args['telegram-bot-display-name'] !== args['telegram-bot-display-name'].trim() ||
      !/^(?=.{1,64}$)[^\r\n]+$/.test(args['telegram-bot-display-name'])) {
    throw new ContractError('--telegram-bot-display-name is invalid');
  }
  artifact.gateway.telegramBotUsername = args['telegram-bot-username'];
  artifact.gateway.telegramBotDisplayName = args['telegram-bot-display-name'];
  const egressDockerfile = await canonicalSourceFile(root, args['telegram-egress-dockerfile'], 'ops/telegram-egress/Dockerfile', '--telegram-egress-dockerfile');
  const egressDockerfileText = await readFile(egressDockerfile, 'utf8');
  const version = /^ARG CLOUDFLARE_WARP_VERSION=([0-9]{4}\.[0-9]+\.[0-9]+\.[0-9]+)$/m.exec(egressDockerfileText);
  const packageSha = /^ARG CLOUDFLARE_WARP_DEB_SHA256=([0-9a-f]{64})$/m.exec(egressDockerfileText);
  if (!version || !packageSha) throw new ContractError('Telegram egress Dockerfile package identity is invalid');
  const baseReference = egressBaseReference;
  const { image: baseImage, digest: baseImageDigest } = telegramEgressBaseImage(egressDockerfileText, baseReference);
  const aptSources = telegramEgressAptSources(egressDockerfileText, egressAptSources);
  Object.assign(artifact.telegramEgress, {
    baseImage, baseImageDigest, buildInputDigest: egressBuildInputDigest,
    aptSources,
    warpPackage: { version: version[1], sha256: packageSha[1] },
  });
  const composeFile = await canonicalSourceFile(root, args['compose-file'], 'ops/compose/compose.preprod.yml', '--compose-file');
  const egressComposeFile = await canonicalSourceFile(root, args['telegram-egress-compose-file'], 'ops/compose/compose.preprod-telegram-egress.yml', '--telegram-egress-compose-file');
  artifact.deployment = { composeDigest: await composeBundleDigest(composeFile, egressComposeFile) };
  const migration = await migrationCatalog(root);
  return { source, targetPlatform, artifact, migration };
}

export async function composeBundleDigest(composeFile, egressComposeFile) {
  return sha256([await digestFile(composeFile), await digestFile(egressComposeFile)]);
}

export function createReleaseManifest({ source, targetPlatform, artifact, migration, rollbackCompatibleRelease = null }) {
  const releaseId = `booking-${source.committedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${source.gitSha.slice(0, 12)}`;
  const manifest = {
    schema: 'booking.release/v2', releaseId,
    source: { gitSha: source.gitSha, treeState: 'clean' },
    artifacts: { backend: structuredClone(artifact.backend), gateway: structuredClone(artifact.gateway), telegramEgress: structuredClone(artifact.telegramEgress), deployment: structuredClone(artifact.deployment) },
    contracts: {
      configSchema: 'booking.config/v1', apiVersion: 'v1', frontendCompatibleApi: 'v1',
      migration: { ...migration, compatibility: 'expand-contract' }, rollbackCompatibleRelease,
    },
    runtime: { nodeMajor: 20, targetPlatform },
    probes: { live: '/livez', ready: '/readyz', version: '/__ops/version' },
  };
  validateReleaseManifest(manifest);
  return manifest;
}

export function canonicalDocument(value) {
  return `${canonicalJson(value)}\n`;
}
