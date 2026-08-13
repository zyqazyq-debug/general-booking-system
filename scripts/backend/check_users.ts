
import 'dotenv/config';
import { Client } from 'pg';

const client = new Client({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB || 'booking_db',
});

async function run() {
  await client.connect();
  // EXCLUDE password hashes from the output for security reasons
  const res = await client.query('SELECT id, username, roles, status, created_at FROM "user"');
  console.table(res.rows);
  await client.end();
}
run();
