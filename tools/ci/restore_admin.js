const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Load .env manually
const envPath = path.join(__dirname, '../../backend', '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  envConfig.split('\n').forEach((line) => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

const dbConfig = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USER || 'admin',
  password: process.env.POSTGRES_PASSWORD || 'password',
  database: process.env.POSTGRES_DB || 'booking_db',
};

async function restoreAdmin() {
  console.log('Starting restoreAdmin...');
  const client = new Client(dbConfig);
  try {
    console.log('Connecting to DB...');
    await client.connect();
    console.log('Connected.');
    
    // Generate a random secure password instead of hardcoding
    const randomPassword = crypto.randomBytes(8).toString('hex');
    console.log('Hashing password...');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(randomPassword, salt);

    // Check if admin exists
    const check = await client.query(`SELECT * FROM "user" WHERE username = 'admin'`);
    if (check.rowCount === 0) {
      const id = crypto.randomUUID();
      
      const query = `
        INSERT INTO "user" (
          id, username, password, roles, wallet_balance, credit_balance, frozen_credit, risk_score, is_verified, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, 0, 100, 0, 100, true, NOW(), NOW()
        ) RETURNING id, username;
      `;
      
      const values = [id, 'admin', hashedPassword, 'ADMIN,OWNER,CONSUMER,AGENT'];
      
      console.log('Inserting admin user...');
      await client.query(query, values);
      console.log(`✅ Admin user created. Password is: ${randomPassword} (SAVE THIS NOW)`);
    } else {
      console.log('Admin user exists. Updating roles and password...');
      const rolesStr = check.rows[0].roles || '';
      let rolesArray = rolesStr ? rolesStr.split(',') : [];
      if (!rolesArray.includes('ADMIN')) {
          rolesArray.push('ADMIN');
      }
      await client.query('UPDATE "user" SET roles = $1, password = $2 WHERE username = $3', [rolesArray.join(','), hashedPassword, 'admin']);
      console.log(`✅ Admin user restored. New password is: ${randomPassword} (SAVE THIS NOW)`);
    }

  } catch (err) {
    console.error('❌ Error restoring admin:', err);
  } finally {
    await client.end();
  }
}

restoreAdmin();
