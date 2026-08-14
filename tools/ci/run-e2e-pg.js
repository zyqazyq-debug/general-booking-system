const path = require('path');
const { spawnSync } = require('child_process');

const backendDir = path.join(__dirname, '../../backend');
const jestBin = path.join(backendDir, 'node_modules/jest/bin/jest.js');
const ensureDbScript = path.join(__dirname, 'ensure_e2e_db.js');

const env = {
  ...process.env,
  USE_POSTGRES: 'true',
  NODE_ENV: 'test',
  TYPEORM_SYNCHRONIZE: 'true',
  JWT_SECRET: 'test_secret_for_e2e_testing_only',
  JWT_SECRET1: 'test_secret_for_e2e_testing_only',
  JWT_SECRET_ACTIVE_INDEX: '1',
  TELEGRAM_BOT_TOKEN: 'DUMMY',
  TELEGRAM_WEBAPP_URL: 'http://localhost:3000',
  H5_URL: 'http://localhost:3000',
  TEST_POSTGRES_DB: process.env.TEST_POSTGRES_DB || 'booking_e2e_test',
  TEST_POSTGRES_RESET: process.env.TEST_POSTGRES_RESET || '1',
};

function runNode(scriptPath, args = []) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: backendDir,
    stdio: 'inherit',
    env,
  });
}

const ensureResult = runNode(ensureDbScript);
if (typeof ensureResult.status === 'number' && ensureResult.status !== 0) {
  process.exit(ensureResult.status);
}
if (ensureResult.error) {
  process.exit(1);
}

const jestResult = runNode(jestBin, [
  '--config',
  './test/jest-e2e.json',
  '--runTestsByPath',
  './test/booking-flow.e2e-spec.ts',
  '--runInBand',
  '--forceExit',
]);
if (jestResult.error) {
  process.exit(1);
}
if (typeof jestResult.status === 'number') {
  process.exit(jestResult.status);
}
process.exit(0);
