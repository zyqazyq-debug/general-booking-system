const fs = require('node:fs');
const path = require('node:path');
const { validateTarget, MigrationSafetyError } = require('./lib/migration-safety');

try {
  const dotenvPath = path.join(process.cwd(), 'backend', '.env');
  if (fs.existsSync(dotenvPath)) require('dotenv').config({ path: dotenvPath });
  const target = validateTarget(process.env);
  console.log('[MIGRATE GUARD 01] PASS isolated target fingerprint=%s database=%s', target.fingerprint, target.database);
} catch (error) {
  const detail = error instanceof MigrationSafetyError ? error.message : 'unable to validate target';
  console.error('[MIGRATE GUARD 01] FAIL: %s', detail);
  process.exitCode = 1;
}
