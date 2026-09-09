#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalDocument, cleanGitSource, createLocalProvenance, imageDigest, imageRepository, readArtifact } from './lib/artifacts.mjs';
import { ContractError, gateResult, parseArgs } from './lib/contracts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
try {
  const args = parseArgs(process.argv.slice(2));
  const component = args.component;
  if (!['backend', 'gateway', 'telegram-egress'].includes(component) || !args.output || !args.sbom || !args['native-sbom']) {
    throw new ContractError('--component, --native-sbom, --sbom, and --output are required');
  }
  const source = cleanGitSource(root);
  const image = imageRepository(args.image, '--image');
  const digest = imageDigest(args['image-digest'], '--image-digest');
  const sbomDigest = await readArtifact(args.sbom, component, source.gitSha, image, digest, 'SBOM', { root, nativePath: args['native-sbom'] });
  const baseImage = args['base-image'] || null;
  const document = createLocalProvenance({ component, gitSha: source.gitSha, image, digest, sbomDigest, baseImage });
  await writeFile(args.output, canonicalDocument(document), 'utf8');
  process.stdout.write(`${JSON.stringify(gateResult({ gate: 'local-provenance', checks: [{ name: component, status: 'pass', code: 'LOCAL_PROVENANCE_GENERATED' }] }))}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 10;
}
