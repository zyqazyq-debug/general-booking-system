#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalDocument, cleanGitSource, createLocalProvenance, imageDigest, imageRepository, readArtifact } from './lib/artifacts.mjs';
import { ContractError, gateResult, parseArgs } from './lib/contracts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const component = args.component;
  if (!['backend', 'gateway', 'telegram-egress'].includes(component) || !args.output || !args.sbom || !args['native-sbom']) {
    throw new ContractError('--component, --native-sbom, --sbom, and --output are required');
  }
  const source = cleanGitSource(root);
  const image = imageRepository(args.image, '--image');
  const digest = imageDigest(args['image-digest'], '--image-digest');
  const baseImage = args['base-image'] || null;
  const aptSources = component === 'telegram-egress' ? {
    debianMirror: args['debian-mirror'], securityMirror: args['security-mirror'],
  } : null;
  if (component !== 'telegram-egress' && (baseImage || args['debian-mirror'] || args['security-mirror'])) {
    throw new ContractError('base image and APT source parameters are valid only for telegram-egress');
  }
  const sbomDigest = await readArtifact(args.sbom, component, source.gitSha, image, digest, 'SBOM', {
    root, nativePath: args['native-sbom'], ...(component === 'telegram-egress' ? { baseImage, aptSources } : {}),
  });
  const document = createLocalProvenance({ component, gitSha: source.gitSha, image, digest, sbomDigest, baseImage, aptSources });
  await writeFile(args.output, canonicalDocument(document), 'utf8');
  process.stdout.write(`${JSON.stringify(gateResult({ gate: 'local-provenance', checks: [{ name: component, status: 'pass', code: 'LOCAL_PROVENANCE_GENERATED' }] }))}\n`);
}

export async function run(argv = process.argv.slice(2)) {
  try { await main(argv); }
  catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 10;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
