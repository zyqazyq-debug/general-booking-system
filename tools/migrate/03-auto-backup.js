const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { join } = path;

try {
  const dotenvPath = join(process.cwd(), 'backend', '.env');
  if (fs.existsSync(dotenvPath)) {
    require('dotenv').config({ path: dotenvPath });
  }
} catch (e) {}

const NODE_ENV = process.env.NODE_ENV;
const DB_DATABASE = process.env.DB_DATABASE || 'unknown';

if (NODE_ENV !== 'production') {
  console.log(
    '\x1b[33m[MIGRATE GUARD 03] SKIP\x1b[0m NODE_ENV=%s (not production)',
    NODE_ENV
  );
  process.exit(0);
}

const checkResult = spawnSync('pg_dump', ['--version'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
});

if (checkResult.status !== 0) {
  console.error(
    '\x1b[31m[MIGRATE GUARD 03] FAIL: pg_dump not found in PATH (required for production backups)\x1b[0m'
  );
  process.exit(1);
}

const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const backupPath = `backups/${DB_DATABASE}-${timestamp}.dump`;

console.log(
  '\x1b[32m[MIGRATE GUARD 03] PASS\x1b[0m pg_dump available, would dump to %s',
  backupPath
);
process.exit(0);
