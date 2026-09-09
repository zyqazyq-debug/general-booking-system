import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';
import { extname, join } from 'path';

config({ quiet: true });

const migrationGlobs = extname(__filename) === '.js'
  ? [join(__dirname, 'src/migrations/*.js')]
  : [join(__dirname, 'src/migrations/*.ts')];

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  entities: [__dirname + '/src/**/*.entity{.ts,.js}'],
  migrations: migrationGlobs,
  synchronize: false,
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
