
import 'dotenv/config';
import { Client } from 'pg';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const client = new Client({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB || 'booking_db',
});

async function run() {
  await client.connect();
  
  // Generate a random secure password instead of hardcoding 'testpass'
  const randomPassword = crypto.randomBytes(8).toString('hex');
  const salt = await bcrypt.genSalt();
  const hash = await bcrypt.hash(randomPassword, salt);

  // Check if testuser exists
  const res = await client.query("SELECT * FROM \"user\" WHERE username = 'testuser'");
  if (res.rows.length === 0) {
      console.log('Creating testuser...');
      await client.query(
          'INSERT INTO "user" (id, username, password, roles, wallet_balance, credit_balance, created_at, updated_at) VALUES (uuid_generate_v4(), $1, $2, $3, 0, 0, now(), now())',
          ['testuser', hash, JSON.stringify(['USER'])]
      );
      console.log(`testuser created. Password is: ${randomPassword} (SAVE THIS NOW, it won't be shown again)`);
  } else {
      console.log('testuser already exists, updating with new random password...');
      await client.query('UPDATE "user" SET password = $1 WHERE username = $2', [hash, 'testuser']);
      console.log(`Password updated. New password is: ${randomPassword} (SAVE THIS NOW)`);
  }

  await client.end();
}
run();
