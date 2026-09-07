const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const targetedBackendTestGroups = [
  {
    name: 'backend order R1 tests',
    files: [
      'src/domains/order/order.controller.spec.ts',
      'src/domains/order/domain/order-lifecycle-policies.spec.ts',
      'src/domains/order/services/order-context-query.service.spec.ts',
      'src/domains/order/services/order-lifecycle.service.spec.ts',
      'src/domains/order/services/order-financial.service.spec.ts',
    ],
  },
  {
    name: 'backend auth agency and services R1 tests',
    files: [
      'src/domains/auth/services/registration.service.spec.ts',
      'src/domains/agency/services/agency-ownership.spec.ts',
      'src/domains/agency/services/agency-query.security.spec.ts',
      'src/domains/agency/services/agency-pricing.service.spec.ts',
      'src/domains/services/service-availability.service.spec.ts',
      'src/domains/services/service-block.service.spec.ts',
    ],
  },
  {
    name: 'backend telegram and env R1 tests',
    files: [
      'src/config/env.validation.spec.ts',
      'src/platforms/telegram/telegram-webhook.controller.spec.ts',
      'src/shared/common/setup-telegram.spec.ts',
    ],
  },
];

const targetedBackendTests = targetedBackendTestGroups.flatMap(
  (group) => group.files,
);

const gates = [
  {
    name: 'shared build',
    command: npmCommand,
    args: ['--prefix', 'packages/shared', 'run', 'build'],
  },
  {
    name: 'shared package tests',
    command: npmCommand,
    args: ['--prefix', 'packages/shared', 'run', 'test'],
  },
  {
    name: 'shared boundary tests',
    command: process.execPath,
    args: ['--test', 'tools/ci/shared-contracts.test.js'],
  },
  {
    name: 'backend build',
    command: npmCommand,
    args: ['--prefix', 'backend', 'run', 'build'],
  },
  ...targetedBackendTestGroups.map((group) => ({
    name: group.name,
    command: npmCommand,
    args: [
      '--prefix',
      'backend',
      'test',
      '--',
      '--runInBand',
      '--runTestsByPath',
      ...group.files,
    ],
  })),
  {
    name: 'backend dependency boundaries',
    command: npmCommand,
    args: ['--prefix', 'backend', 'run', 'lint:arch'],
  },
  {
    name: 'frontend typecheck',
    command: npmCommand,
    args: ['--prefix', 'frontend', 'run', 'type-check'],
  },
  {
    name: 'frontend dependency boundaries',
    command: npmCommand,
    args: ['--prefix', 'frontend', 'run', 'depcruise'],
  },
  {
    name: 'frontend build',
    command: npmCommand,
    args: ['--prefix', 'frontend', 'run', 'build:h5'],
  },
  {
    name: 'generated API is current and non-empty',
    command: process.execPath,
    args: ['tools/ci/verify-generated-api.js'],
  },
  {
    name: 'ops entrypoints and PowerShell syntax',
    command: process.execPath,
    args: ['tools/ci/check-ops-entrypoints.js'],
  },
];

function assertInputsExist() {
  const required = [
    'packages/shared/package.json',
    'backend/package.json',
    'frontend/package.json',
    ...targetedBackendTests.map((file) => path.join('backend', file)),
  ];
  const missing = required.filter(
    (file) => !fs.existsSync(path.join(repoRoot, file)),
  );
  if (missing.length) {
    throw new Error(`quality gate inputs missing:\n${missing.join('\n')}`);
  }
}

function run() {
  assertInputsExist();
  const failures = [];
  for (const gate of gates) {
    console.log(`\n[quality-gate] START ${gate.name}`);
    const result = spawnSync(gate.command, gate.args, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });
    if (result.error) {
      failures.push(`${gate.name}: ${result.error.message}`);
      console.error(`[quality-gate] FAIL ${gate.name}: ${result.error.message}`);
      continue;
    }
    if (result.status === 0) {
      console.log(`[quality-gate] PASS ${gate.name}`);
      continue;
    }
    failures.push(`${gate.name}: exit=${String(result.status)}`);
    console.error(
      `[quality-gate] FAIL ${gate.name} (exit=${String(result.status)})`,
    );
  }
  if (failures.length) {
    throw new Error(
      `[quality-gate] ${failures.length} gate(s) failed:\n${failures.join('\n')}`,
    );
  }
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  gates,
  targetedBackendTestGroups,
  targetedBackendTests,
  assertInputsExist,
};
