const fs = require('fs');
const path = require('path');
const { join } = path;

const migrationsDir = join(process.cwd(), 'backend', 'src', 'migrations');

if (!fs.existsSync(migrationsDir)) {
  console.log('\x1b[32m[MIGRATE GUARD 02] PASS\x1b[0m migrations directory does not exist, nothing to check');
  process.exit(0);
}

const files = fs.readdirSync(migrationsDir);

const tmpFiles = files.filter(f => f.startsWith('tmp-'));
if (tmpFiles.length > 0) {
  console.error(
    '\x1b[31m[MIGRATE GUARD 02] FAIL: Found %d leftover tmp- migration file(s) in backend/src/migrations/: %s. Please clean them up before running migrations.\x1b[0m',
    tmpFiles.length,
    tmpFiles.join(', ')
  );
  process.exit(1);
}

const tsFiles = files.filter(f => f.endsWith('.ts'));
const badNameFiles = tsFiles.filter(f => {
  const baseName = path.basename(f, '.ts');
  const parts = baseName.split('-');
  if (parts.length < 2) return true;
  const timestamp = parts[0];
  if (!/^\d{17}$/.test(timestamp)) return true;
  return false;
});

if (badNameFiles.length > 0) {
  console.error(
    '\x1b[31m[MIGRATE GUARD 02] FAIL: Found %d migration file(s) with invalid naming (expected YYYYMMDDHHMMSSXXX-Name.ts): %s. All migration files must start with a 17-digit timestamp.\x1b[0m',
    badNameFiles.length,
    badNameFiles.join(', ')
  );
  process.exit(1);
}

console.log(
  '\x1b[32m[MIGRATE GUARD 02] PASS\x1b[0m migrations=%d (no tmp- leftovers, all names properly formatted)',
  tsFiles.length
);
process.exit(0);
