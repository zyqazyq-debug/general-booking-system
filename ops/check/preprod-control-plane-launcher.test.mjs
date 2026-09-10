import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const launcher = resolve(root, 'ops/release/run-booking-preprod-control-plane');
const shell = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\sh.exe' : '/bin/sh';
const IMAGE = 'node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5';

function dryRun(argv) {
  return spawnSync(shell, [launcher, ...argv], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BOOKING_CONTROL_PLANE_DRY_RUN: 'true' },
  });
}

function mounts(argv) {
  return argv.flatMap((value, index) => value === '--mount' ? [argv[index + 1]] : []);
}

const BASE_MOUNTS = [
  'type=bind,src=/var/lib/happybooking,dst=/var/lib/happybooking',
  'type=bind,src=/volume1/happybooking/booking-preprod,dst=/volume1/happybooking/booking-preprod,readonly',
  'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock',
  'type=bind,src=/var/packages/ContainerManager/target/usr/bin/docker,dst=/var/packages/ContainerManager/target/usr/bin/docker,readonly',
  'type=bind,src=/var/packages/ContainerManager/target/usr/bin/docker-compose,dst=/root/.docker/cli-plugins/docker-compose,readonly',
  'type=bind,src=/usr/local/libexec/happybooking/control-plane,dst=/usr/local/libexec/happybooking/control-plane,readonly',
  'type=bind,src=/usr/local/bin/cosign,dst=/usr/local/bin/cosign,readonly',
  'type=bind,src=/etc/happybooking/trust/cosign-preprod.pub,dst=/etc/happybooking/trust/cosign-preprod.pub,readonly',
  'type=bind,src=/etc/happybooking/trust/cosign-preprod.pub.sha256,dst=/etc/happybooking/trust/cosign-preprod.pub.sha256,readonly',
  'type=bind,src=/etc/happybooking/secrets/booking-preprod-control-plane.env,dst=/etc/happybooking/secrets/booking-preprod-control-plane.env,readonly',
];

const INGRESS_MOUNTS = [
  'type=bind,src=/usr/local/libexec/happybooking/switch-preprod-ingress,dst=/usr/local/libexec/happybooking/switch-preprod-ingress,readonly',
  'type=bind,src=/usr/local/libexec/happybooking/switch-preprod-ingress.mjs,dst=/usr/local/libexec/happybooking/switch-preprod-ingress.mjs,readonly',
  'type=bind,src=/etc/happybooking/secrets/cloudflare-preprod-api-token,dst=/etc/happybooking/secrets/cloudflare-preprod-api-token,readonly',
];

const BACKUP_RW_MOUNTS = [
  'type=bind,src=/volume1/happybooking/booking-preprod/.g4/backups,dst=/volume1/happybooking/booking-preprod/.g4/backups',
  'type=bind,src=/volume1/happybooking/booking-preprod/.g4/receipts,dst=/volume1/happybooking/booking-preprod/.g4/receipts',
];
const RECEIPT_RW_MOUNT = 'type=bind,src=/volume1/happybooking/booking-preprod/.g4/receipts,dst=/volume1/happybooking/booking-preprod/.g4/receipts';

const common = ['--execute', 'true', '--environment', 'preprod', '--project', 'booking-preprod',
  '--approval-id', 'approval-1', '--expected-generation', '3', '--expected-fencing-epoch', '7',
  '--manifest-digest', `sha256:${'a'.repeat(64)}`];

test('control-plane launcher builds the fixed hardened Docker plan for the state manager', () => {
  const result = dryRun(['manage-deploy-state', '--action', 'renew', ...common, '--lease-id', 'lease-1', '--holder-id', 'owner-1', '--lease-duration-ms', '300000']);
  assert.equal(result.status, 0, result.stderr);
  const argv = result.stdout.trim().split(/\r?\n/);
  assert.equal(argv[0], '/var/packages/ContainerManager/target/usr/bin/docker');
  assert.ok(argv.includes(IMAGE));
  assert.ok(argv.includes('/usr/local/libexec/happybooking/control-plane/ops/release/manage-deploy-state.mjs'));
  assert.deepEqual(argv.slice(1, 6), ['run', '--rm', '--pull', 'never', '--name']);
  for (const expected of ['host', '0:0', 'ALL', 'no-new-privileges:true', '/usr/local/bin/node']) assert.ok(argv.includes(expected));
  for (const expected of ['HOME=/root', 'NODE_OPTIONS=', 'NODE_PATH=', 'LD_PRELOAD=', 'DOCKER_HOST=unix:///var/run/docker.sock', 'DOCKER_CONFIG=/root/.docker']) assert.ok(argv.includes(expected));
  assert.ok(argv.includes('type=bind,src=/var/lib/happybooking,dst=/var/lib/happybooking'));
  assert.ok(argv.includes('type=bind,src=/volume1/happybooking/booking-preprod,dst=/volume1/happybooking/booking-preprod,readonly'));
  assert.ok(argv.includes('type=bind,src=/usr/local/bin/cosign,dst=/usr/local/bin/cosign,readonly'));
  assert.ok(argv.includes('type=bind,src=/etc/happybooking/trust/cosign-preprod.pub,dst=/etc/happybooking/trust/cosign-preprod.pub,readonly'));
  assert.ok(argv.includes('type=bind,src=/etc/happybooking/trust/cosign-preprod.pub.sha256,dst=/etc/happybooking/trust/cosign-preprod.pub.sha256,readonly'));
  assert.ok(argv.includes('type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock'));
  assert.ok(argv.includes('type=bind,src=/var/packages/ContainerManager/target/usr/bin/docker,dst=/var/packages/ContainerManager/target/usr/bin/docker,readonly'));
  assert.ok(argv.includes('type=bind,src=/var/packages/ContainerManager/target/usr/bin/docker-compose,dst=/root/.docker/cli-plugins/docker-compose,readonly'));
  assert.ok(argv.includes('type=bind,src=/usr/local/libexec/happybooking/control-plane,dst=/usr/local/libexec/happybooking/control-plane,readonly'));
  assert.equal(argv.some((value) => value.includes('src=/etc/happybooking/secrets,dst=')), false);
  assert.equal(argv.some((value) => value.includes('src=/usr/local/libexec/happybooking,dst=')), false);
  assert.deepEqual(mounts(argv), BASE_MOUNTS);
  assert.equal(argv[argv.indexOf('--env-file') + 1], '/etc/happybooking/secrets/booking-preprod-control-plane.env');
});

test('control-plane launcher maps only the fenced executor and preserves argument boundaries', () => {
  const result = dryRun(['execute-fenced-action', '--action', 'preprod-stage', ...common,
    '--operation-id', 'op-1', '--lease-id', 'lease-1', '--holder-id', 'owner-1',
    '--resource-id', 'booking-preprod-edge', '--action-id', 'stage-1']);
  assert.equal(result.status, 0, result.stderr);
  const argv = result.stdout.trim().split(/\r?\n/);
  assert.ok(argv.includes('/usr/local/libexec/happybooking/control-plane/ops/release/execute-fenced-action.mjs'));
  assert.equal(argv.includes('/bin/sh'), false);
  assert.equal(argv.includes('-c'), false);
  assert.equal(argv.filter((value) => value === '--action').length, 1);
  assert.deepEqual(mounts(argv), BASE_MOUNTS, 'staging must not depend on Cloudflare helper or token files');
});

test('only forward and rollback ingress receive the self-contained helper and token mounts', () => {
  for (const action of ['preprod-switch-ingress', 'preprod-rollback-ingress']) {
    const result = dryRun(['execute-fenced-action', '--action', action, ...common,
      '--operation-id', 'op-1', '--lease-id', 'lease-1', '--holder-id', 'owner-1',
      '--resource-id', 'ingress:booking-preprod', '--action-id', 'ingress-1']);
    assert.equal(result.status, 0, result.stderr);
    const argv = result.stdout.trim().split(/\r?\n/);
    assert.deepEqual(mounts(argv), [...BASE_MOUNTS, ...INGRESS_MOUNTS]);
  }
});

test('init, baseline, migration, staging, and webhook plans have no Cloudflare token dependency', () => {
  const cases = [
    ['manage-deploy-state', '--action', 'init', ...common],
    ['execute-fenced-action', '--action', 'preprod-baseline-ledger', ...common, '--operation-id', 'op-1', '--lease-id', 'lease-1', '--holder-id', 'owner-1', '--resource-id', 'database:booking-preprod', '--action-id', 'baseline-1'],
    ['execute-fenced-action', '--action', 'preprod-expand-migrate', ...common, '--operation-id', 'op-1', '--lease-id', 'lease-1', '--holder-id', 'owner-1', '--resource-id', 'database:booking-preprod', '--action-id', 'migrate-1'],
    ['execute-fenced-action', '--action', 'preprod-stage', ...common, '--operation-id', 'op-1', '--lease-id', 'lease-1', '--holder-id', 'owner-1', '--resource-id', 'booking-preprod-edge', '--action-id', 'stage-1'],
    ['execute-fenced-action', '--action', 'preprod-transfer-singletons', ...common, '--operation-id', 'op-1', '--lease-id', 'lease-1', '--holder-id', 'owner-1', '--resource-id', 'booking-preprod-edge', '--action-id', 'singletons-1'],
    ['execute-fenced-action', '--action', 'preprod-rollback-singletons', ...common, '--operation-id', 'op-1', '--lease-id', 'lease-1', '--holder-id', 'owner-1', '--resource-id', 'booking-preprod-edge', '--action-id', 'rollback-singletons-1'],
    ['execute-fenced-action', '--action', 'preprod-set-webhook', ...common, '--operation-id', 'op-1', '--lease-id', 'lease-1', '--holder-id', 'owner-1', '--resource-id', 'telegram:booking-preprod', '--action-id', 'webhook-1'],
  ];
  for (const input of cases) {
    const result = dryRun(input);
    assert.equal(result.status, 0, result.stderr);
    const argv = result.stdout.trim().split(/\r?\n/);
    assert.deepEqual(mounts(argv), BASE_MOUNTS);
    assert.equal(argv.some((value) => value.includes('cloudflare-preprod-api-token')), false);
    assert.equal(argv.some((value) => value.includes('switch-preprod-ingress')), false);
  }
});

test('backup symbolic entrypoint constructs only canonical release/evidence paths and exact nested RW mounts', () => {
  const base = ['--execute', 'true', '--environment', 'preprod', '--project', 'booking-preprod', '--operation-id', 'g4-op-1',
    '--approval-id', 'approval-1', '--expected-generation', '3', '--expected-fencing-epoch', '1', '--manifest-digest', `sha256:${'9'.repeat(64)}`, '--lease-id', 'lease-1', '--holder-id', 'owner-1'];
  const created = dryRun(['generate-database-backup-receipt', '--action', 'create', '--identity', 'old',
    '--release-id', 'booking-20260908T202714Z-317be4dec675', ...base]);
  assert.equal(created.status, 0, created.stderr);
  const createArgv = created.stdout.trim().split(/\r?\n/);
  assert.ok(createArgv.includes('/usr/local/libexec/happybooking/control-plane/ops/release/generate-database-backup-receipt.mjs'));
  assert.ok(createArgv.includes('/volume1/happybooking/booking-preprod/releases/booking-20260908T202714Z-317be4dec675/release-manifest.json'));
  assert.ok(createArgv.includes('/volume1/happybooking/booking-preprod/.g4/backups/g4-op-1.dump'));
  assert.ok(createArgv.includes('/volume1/happybooking/booking-preprod/.g4/receipts/g4-op-1-old-backup.json'));
  assert.equal(createArgv[createArgv.indexOf('--expected-generation') + 1], '3');
  assert.deepEqual(mounts(createArgv), [...BASE_MOUNTS, ...BACKUP_RW_MOUNTS]);

  const candidate = 'booking-20260909T010203Z-acde123';
  const digest = `sha256:${'d'.repeat(64)}`;
  const bound = dryRun(['generate-database-backup-receipt', '--action', 'bind-existing', '--identity', 'candidate',
    '--release-id', candidate, '--expected-backup-digest', digest, ...base]);
  assert.equal(bound.status, 0, bound.stderr);
  const bindArgv = bound.stdout.trim().split(/\r?\n/);
  assert.ok(bindArgv.includes(`/volume1/happybooking/booking-preprod/releases/${candidate}/release-manifest.json`));
  assert.ok(bindArgv.includes(digest));
  assert.ok(bindArgv.includes('/volume1/happybooking/booking-preprod/.g4/receipts/g4-op-1-candidate-backup.json'));
  assert.deepEqual(mounts(bindArgv), [...BASE_MOUNTS, ...BACKUP_RW_MOUNTS]);
  assert.equal(bindArgv.some((value) => value.includes('cloudflare-preprod-api-token')), false);
});

test('schema-diff symbolic entrypoint fixes the legacy manifest/slot and grants only receipt RW', () => {
  const result = dryRun(['generate-schema-diff-receipt', '--action', 'generate', '--execute', 'true', '--environment', 'preprod',
    '--project', 'booking-preprod', '--operation-id', 'g4-op-2', '--approval-id', 'approval-1', '--expected-fencing-epoch', '1',
    '--expected-generation', '3',
    '--manifest-digest', `sha256:${'9'.repeat(64)}`, '--lease-id', 'lease-1', '--holder-id', 'owner-1']);
  assert.equal(result.status, 0, result.stderr);
  const argv = result.stdout.trim().split(/\r?\n/);
  assert.ok(argv.includes('/usr/local/libexec/happybooking/control-plane/ops/release/generate-schema-diff-receipt.mjs'));
  assert.equal(argv[argv.indexOf('--identity') + 1], 'old');
  assert.equal(argv[argv.indexOf('--slot') + 1], 'green');
  assert.ok(argv.includes('/volume1/happybooking/booking-preprod/releases/booking-20260908T202714Z-317be4dec675/release-manifest.json'));
  assert.ok(argv.includes('/volume1/happybooking/booking-preprod/.g4/receipts/g4-op-2-old-zero-diff.json'));
  assert.deepEqual(mounts(argv), [...BASE_MOUNTS, RECEIPT_RW_MOUNT]);
});

test('evidence symbolic entrypoints reject caller paths, wrong identities, and malformed release/digest values', () => {
  const commonEvidence = ['--execute', 'true', '--environment', 'preprod', '--project', 'booking-preprod', '--operation-id', 'g4-op-3',
    '--approval-id', 'approval-1', '--expected-generation', '3', '--expected-fencing-epoch', '1', '--manifest-digest', `sha256:${'9'.repeat(64)}`, '--lease-id', 'lease-1', '--holder-id', 'owner-1'];
  const cases = [
    ['generate-database-backup-receipt', '--action', 'create', '--identity', 'old', '--release-id', 'booking-20260909T010203Z-acde123', ...commonEvidence],
    ['generate-database-backup-receipt', '--action', 'create', '--identity', 'old', '--release-id', 'booking-20260908T202714Z-317be4dec675', '--manifest', '/tmp/manifest.json', ...commonEvidence],
    ['generate-database-backup-receipt', '--action', 'bind-existing', '--identity', 'candidate', '--release-id', 'booking-invalid', '--expected-backup-digest', `sha256:${'d'.repeat(64)}`, ...commonEvidence],
    ['generate-database-backup-receipt', '--action', 'bind-existing', '--identity', 'candidate', '--release-id', 'booking-20260909T010203Z-acde123', '--expected-backup-digest', `sha256:${'z'.repeat(64)}`, ...commonEvidence],
    ['generate-schema-diff-receipt', '--action', 'generate', '--receipt-path', 'forged.json', ...commonEvidence],
  ];
  for (const input of cases) {
    const result = dryRun(input);
    assert.notEqual(result.status, 0, `unexpectedly accepted ${input.join(' ')}`);
    assert.equal(result.stdout, '');
  }
});

test('control-plane launcher rejects commands, paths, metacharacters, duplicates, and scope escape before Docker', () => {
  const cases = [
    ['sh', ...common],
    ['../execute-fenced-action', ...common],
    ['execute-fenced-action', '--action', 'preprod-stage;id', ...common.slice(2)],
    ['execute-fenced-action', '--action', 'preprod-stage', ...common, '--resource-id', '/var/run/docker.sock'],
    ['execute-fenced-action', '--action', 'preprod-stage', ...common, '--project', 'booking-prod'],
    ['execute-fenced-action', '--action', 'preprod-stage', ...common, '--manifest-digest', `sha256:${'b'.repeat(64)}`],
    ['manage-deploy-state', '--action', 'renew', ...common, '--state', 'deploy-state.json'],
    ['manage-deploy-state', '--action', 'complete', ...common],
    ['manage-deploy-state', '--action', 'renew', ...common, '--execute', 'false'],
  ];
  for (const argv of cases) {
    const result = dryRun(argv);
    assert.notEqual(result.status, 0, `unexpectedly accepted: ${argv.join(' ')}`);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /rejected the request/);
  }
});

test('launcher source has no eval, shell command mode, mutable image, or caller-configurable host path', () => {
  const source = readFileSync(launcher, 'utf8');
  assert.doesNotMatch(source, /\beval\b/);
  assert.doesNotMatch(source, /(?:^|\s)-(?:c|lc)(?:\s|$)/m);
  assert.doesNotMatch(source, /node:(?:latest|22)(?!-)/);
  assert.doesNotMatch(source, /\$\{?(?:HOST_DOCKER|HOST_COMPOSE|STATE_ROOT|PREPROD_ROOT|CONTROL_ROOT|HELPER_ROOT|SECRETS_ROOT|CONTROL_ENV):-/);
  assert.match(source, /--read-only/);
  assert.match(source, /--cap-drop ALL/);
  assert.match(source, /--security-opt no-new-privileges:true/);
  assert.match(source, /--pull never/);
  assert.doesNotMatch(source, /docker\s+(?:container\s+)?rm|\$HOST_DOCKER"\s+rm/);
});
