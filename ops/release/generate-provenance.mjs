#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalDocument, cleanGitSource, digestFile, imageDigest, imageRepository } from './lib/artifacts.mjs';
import { ContractError, gateResult, parseArgs } from './lib/contracts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
try {
  const args = parseArgs(process.argv.slice(2));
  const component = args.component;
  if (!['backend', 'gateway'].includes(component) || !args.output || !args.sbom) throw new ContractError('--component, --sbom, and --output are required');
  const source = cleanGitSource(root);
  const image = imageRepository(args.image, '--image');
  const digest = imageDigest(args['image-digest'], '--image-digest');
  const sbomDigest = await digestFile(args.sbom);
  const document = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: { component, image, digest },
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: { buildType: 'booking.local-release/v1', source: { gitSha: source.gitSha }, materials: [{ uri: 'local-sbom', digest: sbomDigest }] },
  };
  await writeFile(args.output, canonicalDocument(document), 'utf8');
  process.stdout.write(`${JSON.stringify(gateResult({ gate: 'local-provenance', checks: [{ name: component, status: 'pass', code: 'PROVENANCE_GENERATED' }] }))}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 10;
}
