import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

const ENV_PATH = path.join(__dirname, '../../backend/.env');
console.log('Loading env from:', ENV_PATH);
dotenv.config({ path: ENV_PATH });

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  username: process.env.POSTGRES_USER || 'admin',
  password: process.env.POSTGRES_PASSWORD || 'password',
  database: process.env.POSTGRES_DB || 'booking_db',
  synchronize: false,
  logging: true,
});

async function run() {
  try {
    await AppDataSource.initialize();
    console.log('Data Source has been initialized!');

    const migrationPaths = [
      path.join(__dirname, '../../database/migration_v2_schedule_to_service.sql'),
      path.join(__dirname, '../../database/migration_v3_user_email.sql'),
    ];

    for (const sqlPath of migrationPaths) {
      console.log('Reading SQL from:', sqlPath);
      if (!fs.existsSync(sqlPath)) {
        throw new Error(`SQL file not found at ${sqlPath}`);
      }
      const sql = fs.readFileSync(sqlPath, 'utf8');
      console.log('Executing migration SQL...');
      await AppDataSource.query(sql);
    }
    console.log('Migration executed successfully.');

    await AppDataSource.destroy();
  } catch (err) {
    console.error('Error during migration:', err);
    process.exit(1);
  }
}

void run();

