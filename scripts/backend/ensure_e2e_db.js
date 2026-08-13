const path = require('path');
const { config } = require('dotenv');
const { Client } = require(path.join(
  __dirname,
  '../../backend/node_modules/pg',
));

config({ path: path.join(__dirname, '../../backend/.env') });

function readEnv(key, fallback = '') {
  const value = process.env[key];
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.trim();
}

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function ensureE2eDatabase() {
  const host = readEnv('TEST_POSTGRES_HOST', readEnv('POSTGRES_HOST'));
  const port = Number(readEnv('TEST_POSTGRES_PORT', readEnv('POSTGRES_PORT', '5432')));
  const user = readEnv('TEST_POSTGRES_USER', readEnv('POSTGRES_USER'));
  const password = readEnv(
    'TEST_POSTGRES_PASSWORD',
    readEnv('POSTGRES_PASSWORD'),
  );
  const targetDb = readEnv('TEST_POSTGRES_DB', 'booking_e2e_test');
  const adminDb = readEnv('TEST_POSTGRES_ADMIN_DB', 'postgres');
  const resetDb = readEnv('TEST_POSTGRES_RESET', '1') === '1';

  if (!host || !user || !password || !targetDb) {
    throw new Error(
      'Missing required Postgres env. Need TEST_POSTGRES_* or POSTGRES_*.',
    );
  }

  if (!/(test|e2e)/i.test(targetDb)) {
    throw new Error(
      `Unsafe TEST_POSTGRES_DB "${targetDb}". Must contain test or e2e.`,
    );
  }

  const client = new Client({
    host,
    port,
    user,
    password,
    database: adminDb,
  });

  await client.connect();
  try {
    const exists = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [targetDb],
    );
    if (exists.rowCount > 0) {
      if (!resetDb) {
        console.log(`[ensure_e2e_db] exists: ${targetDb}`);
        return;
      }

      await client.query(
        `
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = $1
            AND pid <> pg_backend_pid()
        `,
        [targetDb],
      );
      await client.query(`DROP DATABASE ${quoteIdentifier(targetDb)}`);
      await client.query(`CREATE DATABASE ${quoteIdentifier(targetDb)}`);
      console.log(`[ensure_e2e_db] recreated: ${targetDb}`);
      return;
    }

    await client.query(`CREATE DATABASE ${quoteIdentifier(targetDb)}`);
    console.log(`[ensure_e2e_db] created: ${targetDb}`);
  } finally {
    await client.end();
  }
}

ensureE2eDatabase().catch((error) => {
  console.error(`[ensure_e2e_db] failed: ${error.message}`);
  process.exit(1);
});
