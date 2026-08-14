const fs = require('fs');
const path = require('path');
const { join } = path;

try {
  const dotenvPath = join(process.cwd(), 'backend', '.env');
  if (fs.existsSync(dotenvPath)) {
    require('dotenv').config({ path: dotenvPath });
  }
} catch (e) {}

const DB_HOST = process.env.DB_HOST;
const DB_PORT = process.env.DB_PORT;
const DB_USERNAME = process.env.DB_USERNAME;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_DATABASE = process.env.DB_DATABASE;
const NODE_ENV = process.env.NODE_ENV;
const USE_POSTGRES = process.env.USE_POSTGRES;

if (USE_POSTGRES !== 'true' && (!DB_DATABASE || DB_DATABASE === '')) {
  console.log('\x1b[32m[MIGRATE GUARD 01] PASS\x1b[0m SQLite mode, DB_DATABASE check skipped');
  process.exit(0);
}

if (NODE_ENV === 'production') {
  const prodRegex = /-(prod|production|staging|preprod|release)$/;
  if (!prodRegex.test(DB_DATABASE || '')) {
    console.error(
      '\x1b[31m[MIGRATE GUARD 01] FAIL: NODE_ENV=production but DB_DATABASE="%s" does not match /-(prod|production|staging|preprod|release)$/. Refusing to run migration on potentially wrong database.\x1b[0m',
      DB_DATABASE
    );
    process.exit(1);
  }
} else {
  const devRegex = /(test|e2e|dev|staging|local)/;
  const isAllowedDefault = DB_DATABASE === 'postgres';
  if (!devRegex.test(DB_DATABASE || '') && !isAllowedDefault) {
    console.error(
      '\x1b[31m[MIGRATE GUARD 01] FAIL: Non-production NODE_ENV="%s" but DB_DATABASE="%s" does not contain (test|e2e|dev|staging|local) and is not default "postgres". Refusing to run migration on potentially wrong database.\x1b[0m',
      NODE_ENV,
      DB_DATABASE
    );
    process.exit(1);
  }
}

console.log(
  '\x1b[32m[MIGRATE GUARD 01] PASS\x1b[0m DB_DATABASE=%s NODE_ENV=%s',
  DB_DATABASE,
  NODE_ENV
);
process.exit(0);
