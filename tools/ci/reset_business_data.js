const fs = require('fs');
const path = require('path');
let runBackup = async () => {
  console.warn('[Reset] backup_db 模块不存在，跳过自动备份。');
};
try {
  runBackup = require('./backup_db');
} catch (_) {}

function loadEnv() {
  const envPath = path.join(__dirname, '../../backend', '.env');
  if (!fs.existsSync(envPath)) return;
  const envConfig = fs.readFileSync(envPath, 'utf8');
  envConfig.split('\n').forEach((line) => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (!match) return;
    const key = match[1].trim();
    const value = match[2].trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

function boolEnv(name, defaultValue = false) {
  const v = process.env[name];
  if (v == null) return defaultValue;
  return String(v).toLowerCase() === 'true';
}

function mustConfirm() {
  if (process.env.CONFIRM_RESET !== 'YES') {
    throw new Error('请先设置 CONFIRM_RESET=YES 再执行。');
  }
}

async function runPostgres() {
  const { Client } = require('pg');
  const client = new Client({
    host: process.env.POSTGRES_HOST || process.env.PGHOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || process.env.PGPORT || 5432),
    user: process.env.POSTGRES_USER || process.env.PGUSER || 'admin',
    password: process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || 'password',
    database: process.env.POSTGRES_DB || process.env.PGDATABASE || 'booking_db',
  });
  const targetTables = [
    'commission_records',
    'credit_escrow',
    'orders',
    'agency_nodes',
    'service_blocks',
    'services',
    'share_links',
    'product_listings',
  ];
  await client.connect();
  try {
    const tableRes = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
    `);
    const existing = new Set(tableRes.rows.map((r) => r.tablename));
    const toReset = targetTables.filter((t) => existing.has(t));
    if (toReset.length === 0) {
      console.log('没有找到需要清空的业务表。');
      return;
    }

    const dryRun = boolEnv('DRY_RUN', true);
    console.log('即将处理表:', toReset.join(', '));
    if (dryRun) {
      console.log('DRY_RUN=true，仅预览，不执行写操作。');
      return;
    }

    mustConfirm();
    
    // Auto-backup before destructive reset
    console.log('[Reset] Performing automated backup before reset...');
    await runBackup();
    
    await client.query('BEGIN');
    await client.query(`TRUNCATE TABLE ${toReset.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);

    if (boolEnv('RESET_USER_CREDIT', false)) {
      await client.query('UPDATE "user" SET credit_balance = 100, frozen_credit = 0');
    }
    await client.query('COMMIT');
    console.log('已清空服务、收藏、订单及订单相关数据。');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

async function runSqlite() {
  const sqlite3 = require('sqlite3').verbose();
  const dbPath = path.join(__dirname, '../../backend', 'database.sqlite');
  const targetTables = [
    'commission_records',
    'credit_escrow',
    'orders',
    'agency_nodes',
    'service_blocks',
    'services',
    'share_links',
    'product_listings',
  ];
  const resetSeqTables = ['share_links', 'product_listings'];
  const dryRun = boolEnv('DRY_RUN', true);

  const db = new sqlite3.Database(dbPath);
  const all = (sql) =>
    new Promise((resolve, reject) => {
      db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
  const run = (sql) =>
    new Promise((resolve, reject) => {
      db.run(sql, (err) => (err ? reject(err) : resolve()));
    });

  try {
    const rows = await all(`SELECT name FROM sqlite_master WHERE type='table'`);
    const existing = new Set(rows.map((r) => r.name));
    const toReset = targetTables.filter((t) => existing.has(t));
    if (toReset.length === 0) {
      console.log('没有找到需要清空的业务表。');
      return;
    }

    console.log('即将处理表:', toReset.join(', '));
    if (dryRun) {
      console.log('DRY_RUN=true，仅预览，不执行写操作。');
      return;
    }

    mustConfirm();
    
    // Auto-backup before destructive reset
    console.log('[Reset] Performing automated backup before reset...');
    await runBackup();

    await run('PRAGMA foreign_keys = ON;');
    await run('BEGIN TRANSACTION;');
    for (const table of toReset) {
      await run(`DELETE FROM "${table}";`);
    }
    for (const table of resetSeqTables) {
      if (existing.has(table) && existing.has('sqlite_sequence')) {
        await run(`DELETE FROM sqlite_sequence WHERE name='${table}';`);
      }
    }
    if (boolEnv('RESET_USER_CREDIT', false) && existing.has('user')) {
      await run('UPDATE "user" SET credit_balance = 100, frozen_credit = 0;');
    }
    await run('COMMIT;');
    console.log('已清空服务、收藏、订单及订单相关数据。');
  } catch (e) {
    await run('ROLLBACK;').catch(() => {});
    throw e;
  } finally {
    db.close();
  }
}

(async () => {
  try {
    loadEnv();
    const usePostgres = boolEnv('USE_POSTGRES', true);
    if (usePostgres) {
      await runPostgres();
    } else {
      await runSqlite();
    }
  } catch (e) {
    console.error('清空失败:', e.message || e);
    process.exit(1);
  }
})();
