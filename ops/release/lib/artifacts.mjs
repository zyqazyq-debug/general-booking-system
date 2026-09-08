import { createHash } from 'node:crypto';
import { readdir, lstat, readFile } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

import { ContractError, canonicalJson, readJsonFile, sha256, validateReleaseManifest } from './contracts.mjs';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;
const COMPONENTS = new Set(['backend', 'gateway']);

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

export async function readArtifact(path, component, gitSha, image, digest, kind) {
  const document = await readJsonFile(path);
  const sourceSha = kind === 'provenance' ? document?.predicate?.source?.gitSha : document?.source?.gitSha;
  const artifactComponent = kind === 'provenance' ? document?.subject?.component : document?.component;
  if (!document || artifactComponent !== component || sourceSha !== gitSha) {
    throw new ContractError(`${kind} does not bind ${component} to the release Git SHA`);
  }
  if (kind === 'provenance' && (document._type !== 'https://in-toto.io/Statement/v1' || document.subject?.component !== component || document.subject?.image !== image || document.subject?.digest !== digest)) {
    throw new ContractError('provenance does not bind the requested immutable image identity');
  }
  return digestFile(path);
}

export async function releaseInputs(root, args) {
  const source = cleanGitSource(root);
  const targetPlatform = args['target-platform'];
  if (!/^linux\/(amd64|arm64)$/.test(targetPlatform || '')) throw new ContractError('--target-platform must be linux/amd64 or linux/arm64');
  const artifact = {};
  for (const component of COMPONENTS) {
    const image = imageRepository(args[`${component}-image`], `--${component}-image`);
    const digest = imageDigest(args[`${component}-digest`], `--${component}-digest`);
    const sbomPath = args[`${component}-sbom`];
    const provenancePath = args[`${component}-provenance`];
    if (!sbomPath || !provenancePath) throw new ContractError(`${component} SBOM and provenance inputs are required`);
    artifact[component] = {
      image,
      digest,
      sbomDigest: await readArtifact(sbomPath, component, source.gitSha, image, digest, 'SBOM'),
      provenanceDigest: await readArtifact(provenancePath, component, source.gitSha, image, digest, 'provenance'),
    };
  }
  const frontendDirectory = args['frontend-dir'];
  const routeContract = args['route-contract'];
  if (!frontendDirectory || !routeContract) throw new ContractError('--frontend-dir and --route-contract are required');
  artifact.gateway.frontendAssetDigest = await directoryDigest(frontendDirectory, 'H5 artifact directory');
  artifact.gateway.routeContractDigest = await digestFile(routeContract);
  const migration = await migrationCatalog(root);
  return { source, targetPlatform, artifact, migration };
}

export function createReleaseManifest({ source, targetPlatform, artifact, migration, rollbackCompatibleRelease = null }) {
  const releaseId = `booking-${source.committedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${source.gitSha.slice(0, 12)}`;
  const manifest = {
    schema: 'booking.release/v1', releaseId,
    source: { gitSha: source.gitSha, treeState: 'clean' },
    artifacts: { backend: artifact.backend, gateway: artifact.gateway },
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
