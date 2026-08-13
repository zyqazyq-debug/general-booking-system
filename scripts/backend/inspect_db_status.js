const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

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

async function inspectDB() {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    
    // Check key tables
    const tables = ['user', 'agency_nodes', 'schedules', 'orders'];
    
    for (const table of tables) {
        // Handle "user" keyword
        const tableName = table === 'user' ? '"user"' : table;
        try {
            const countRes = await client.query(`SELECT count(*) FROM ${tableName}`);
            console.log(`Table ${table}: ${countRes.rows[0].count} rows`);
            
            if (Number(countRes.rows[0].count) > 0) {
                const sampleRes = await client.query(`SELECT * FROM ${tableName} LIMIT 5`);
                if (table === 'agency_nodes') {
                    sampleRes.rows.forEach(row => {
                        console.log(`Node ID: ${row.id}, Alias: ${row.alias}, Parent: ${row.parent_node_id}`);
                    });
                }
            }
        } catch (e) {
            console.log(`Table ${table} might not exist or error:`, e.message);
        }
    }

  } catch (err) {
    console.error('Error inspecting DB:', err);
  } finally {
    await client.end();
  }
}

inspectDB();
