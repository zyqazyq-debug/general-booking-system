import { DataSource } from 'typeorm';
import { config } from 'dotenv';
config({ path: '../.env.development' });

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB
});

AppDataSource.initialize().then(async () => {
  console.log('DB connected.');
  
  const r1 = await AppDataSource.query(`UPDATE agency_nodes SET share_slug = CONCAT('s', share_slug) WHERE share_slug NOT LIKE 's%';`);
  console.log('agency_nodes updated:', r1);
  
  const r2 = await AppDataSource.query(`
    ALTER TABLE "user" ALTER COLUMN referral_code TYPE character varying(10);
    UPDATE "user" SET referral_code = CONCAT('R', referral_code) WHERE referral_code NOT LIKE 'R%' AND referral_code IS NOT NULL;
  `);
  console.log('users updated:', r2);
  
  await AppDataSource.destroy();
  console.log('Done.');
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});