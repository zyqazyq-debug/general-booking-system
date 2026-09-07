#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const node = process.execPath;

const gates = [
  {
    name: 'release manifest',
    args: [
      resolve(root, 'ops/release/validate-release.mjs'),
      '--manifest', resolve(root, 'ops/contracts/examples/release-manifest.example.json'),
    ],
  },
  {
    name: 'compose and ingress contracts',
    args: [
      resolve(root, 'ops/release/validate-compose.mjs'),
      '--dev', resolve(root, 'ops/compose/compose.dev.yml'),
      '--data', resolve(root, 'ops/compose/compose.data.yml'),
      '--edge', resolve(root, 'ops/compose/compose.edge.yml'),
      '--release', resolve(root, 'ops/compose/compose.release.yml'),
      '--network', resolve(root, 'ops/network/edge/nginx.conf.template'),
      '--ingress', resolve(root, 'ops/contracts/examples/ingress-contract.example.json'),
      '--edge-bind-address', '127.0.0.1',
      '--trusted-proxy-cidr', '172.31.0.0/24',
    ],
  },
  {
    name: 'candidate transition',
    args: [
      resolve(root, 'ops/release/validate-transition.mjs'),
      '--state', resolve(root, 'ops/contracts/examples/deploy-state.example.json'),
      '--to', 'SINGLETON_TRANSFERRED',
      '--expected-generation', '18',
    ],
  },
  {
    name: 'R1 tests',
    args: ['--test', resolve(root, 'ops/check/r1-contracts.test.mjs')],
  },
];

let failed = false;
for (const gate of gates) {
  process.stdout.write(`\n[R1 gate] ${gate.name}\n`);
  const result = spawnSync(node, gate.args, { cwd: root, encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`[R1 gate] ${gate.name} failed with exit ${result.status}\n`);
    break;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  process.stdout.write('\n[R1 gate] PASS: contracts and read-only checks are internally consistent.\n');
}
