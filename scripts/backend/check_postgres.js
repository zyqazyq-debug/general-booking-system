
const { Client } = require('pg');
require('dotenv').config();

async function check() {
  if (!process.env.POSTGRES_PASSWORD) {
    throw new Error('POSTGRES_PASSWORD is not defined in environment variables');
  }
  const client = new Client({
    user: process.env.POSTGRES_USER || 'postgres',
    host: process.env.POSTGRES_HOST || 'localhost',
    database: 'postgres', // connect to default db first
    password: process.env.POSTGRES_PASSWORD,
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
  });

  try {
    await client.connect();
    console.log('Connected to Postgres successfully.');
    
    const dbName = process.env.POSTGRES_DB || 'booking_db';
    const res = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );
    
    if (res.rowCount === 0) {
      console.log(`Database ${dbName} does not exist. Creating...`);
      await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
      console.log(`Database ${dbName} created.`);
    } else {
      console.log(`Database ${dbName} exists.`);
    }
  } catch (err) {
    console.error('Connection error', err.stack);
  } finally {
    await client.end();
  }
}

check();
