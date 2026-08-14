const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const readline = require('readline');

// 1. Load .env manually
const envPath = path.join(__dirname, '../../backend', '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  envConfig.split('\n').forEach((line) => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^['"]|['"]$/g, ''); // Remove quotes
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

// 2. Configuration
const dbConfig = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USER || 'admin',
  password: process.env.POSTGRES_PASSWORD || 'password',
  database: process.env.POSTGRES_DB || 'booking_db',
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const dryRun = process.argv.includes('--dry-run');

async function askConfirmation(query) {
    return new Promise((resolve) => {
        rl.question(query, (answer) => {
            resolve(answer.toLowerCase() === 'y');
        });
    });
}

async function resetEnvironment() {
  const mode = dryRun ? ' [Dry-run]' : '';
  console.log(`⚠️  Warning: This script will WIPE ALL NON-USER DATA from the database!${mode}`);
  
  if (!dryRun) {
      const confirmed = await askConfirmation('Are you absolutely sure? This cannot be undone. (y/N): ');
      if (!confirmed) {
          console.log('Operation cancelled.');
          process.exit(0);
      }
  }

  console.log('Connecting to database...', { ...dbConfig, password: '***' });
  const client = new Client(dbConfig);

  try {
    await client.connect();

    // 3. Find all tables except 'users' and system tables
    const res = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename NOT IN ('user', 'users', 'migrations', 'typeorm_metadata');
    `);

    const tables = res.rows.map((row) => `"${row.tablename}"`);

    if (tables.length === 0) {
      console.log('No tables found to wipe.');
      return;
    }

    console.log(`Found ${tables.length} tables to wipe:`, tables.join(', '));

    // 4. Truncate all found tables with CASCADE
    const truncateQuery = `TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE;`;
    
    if (!dryRun) {
        console.log('Executing TRUNCATE CASCADE...');
        await client.query('BEGIN');
        await client.query(truncateQuery);
        await client.query('COMMIT');
        console.log('✅ Environment reset successfully. All non-user data has been wiped.');
    } else {
        console.log(`[Dry-run] Would execute: ${truncateQuery}`);
    }

  } catch (err) {
    if (!dryRun) await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Error resetting environment:', err);
    process.exit(1);
  } finally {
    await client.end();
    rl.close();
  }
}

resetEnvironment();
