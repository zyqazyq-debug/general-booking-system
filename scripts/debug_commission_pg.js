const { Client } = require('pg');

const client = new Client({
  host: '127.0.0.1',
  port: 5432,
  user: 'postgres',
  password: 'zyqa1985',
  database: 'booking_db',
});

async function run() {
  try {
    await client.connect();
    console.log('Connected to PostgreSQL');

    // 1. Get latest commission records
    const res = await client.query(`
      SELECT id, order_id, agent_id, role, markup_amount, created_at 
      FROM commission_records 
      ORDER BY created_at DESC 
      LIMIT 10
    `);

    console.log(`Found ${res.rows.length} commission records:`);
    res.rows.forEach(r => {
      console.log(`- ID: ${r.id}, Order: ${r.order_id}, Agent: ${r.agent_id}, Role: ${r.role}, Created: ${r.created_at}`);
    });

    // 2. Get latest orders to compare
    const orders = await client.query(`
        SELECT id, consumer_id, schedule_id, status, created_at 
        FROM "order" 
        ORDER BY created_at DESC 
        LIMIT 5
    `); // Note: "order" table name needs quotes in Postgres if reserved keyword, but here it is 'order' in entity? Check table name. Usually 'order' is reserved.
    
    // Check entity: @Entity('order') -> usually TypeORM escapes it or creates 'order'. 
    // Wait, TypeORM usually creates "order" table.

    console.log(`\nFound ${orders.rows.length} latest orders:`);
    orders.rows.forEach(o => {
        console.log(`- ID: ${o.id}, Consumer: ${o.consumer_id}, Status: ${o.status}, Created: ${o.created_at}`);
    });

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
