
import 'dotenv/config';
import { Client } from 'pg';
import * as readline from 'readline';

const client = new Client({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB || 'booking_db',
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const dryRun = process.argv.includes('--dry-run');

async function askConfirmation(query: string): Promise<boolean> {
    return new Promise((resolve) => {
        rl.question(query, (answer) => {
            resolve(answer.toLowerCase() === 'y');
        });
    });
}

async function clear() {
  try {
    const mode = dryRun ? ' [Dry-run]' : '';
    console.log(`⚠️  Warning: This script will clear orders and commission records!${mode}`);
    
    if (!dryRun) {
        const confirmed = await askConfirmation('Are you sure you want to proceed? (y/N): ');
        if (!confirmed) {
            console.log('Operation cancelled.');
            process.exit(0);
        }
    }

    await client.connect();
    console.log('Connected to DB.');
    
    // List tables
    const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    const tables = res.rows.map(r => r.table_name);
    console.log('Tables found:', tables);

    if (tables.includes('commission_records')) {
        console.log('Clearing commission_records...');
        if (!dryRun) await client.query('DELETE FROM commission_records');
    } else {
        console.log('Table commission_records not found. Creating it manually...');
        if (!dryRun) {
            // Create table
            await client.query(`
                CREATE TABLE IF NOT EXISTS commission_records (
                    id uuid NOT NULL DEFAULT uuid_generate_v4(),
                    order_id uuid NOT NULL,
                    agent_id uuid NOT NULL,
                    role character varying NOT NULL,
                    cost_price numeric(10,2) NOT NULL,
                    markup_amount numeric(10,2) NOT NULL,
                    final_price numeric(10,2) NOT NULL,
                    child_agent_id character varying,
                    level integer NOT NULL,
                    created_at timestamp without time zone NOT NULL DEFAULT now(),
                    CONSTRAINT "PK_commission_records" PRIMARY KEY (id),
                    CONSTRAINT "FK_commission_records_order" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
                    CONSTRAINT "FK_commission_records_agent" FOREIGN KEY (agent_id) REFERENCES "user"(id)
                );
            `);
            console.log('Table commission_records created.');
        }
    }
    
    if (tables.includes('orders')) {
        console.log('Clearing orders...');
        if (!dryRun) await client.query('DELETE FROM orders');
    } else {
         console.log('Table orders not found, skipping.');
    }

    console.log(`Done.${mode}`);
  } catch (err) {
    console.error('Error clearing/creating DB:', err);
  } finally {
    await client.end();
    rl.close();
  }
}

clear();
