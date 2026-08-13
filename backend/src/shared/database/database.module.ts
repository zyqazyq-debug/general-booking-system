import { Module } from '@nestjs/common';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { DataSourceOptions } from 'typeorm';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = config.get<string>('NODE_ENV') === 'production';
        const usePostgres =
          config.get<string>('USE_POSTGRES', 'true') === 'true';
        const synchronizeEnabled =
          config.get<string>('TYPEORM_SYNCHRONIZE', 'false') === 'true' &&
          !isProd;

        const pgOptions: TypeOrmModuleOptions = {
          type: 'postgres',
          host: config.get<string>('POSTGRES_HOST', 'localhost'),
          port: parseInt(config.get<string>('POSTGRES_PORT', '5432')),
          username: config.get<string>('POSTGRES_USER'),
          password: config.get<string>('POSTGRES_PASSWORD'),
          database: config.get<string>('POSTGRES_DB'),
          autoLoadEntities: true,
          synchronize: synchronizeEnabled,
        };
        const sqliteOptions: TypeOrmModuleOptions = {
          type: 'sqlite',
          database:
            process.env.NODE_ENV === 'test' ? ':memory:' : 'database.sqlite',
          autoLoadEntities: true,
          synchronize: synchronizeEnabled,
        };
        const isTest = process.env.NODE_ENV === 'test';
        return usePostgres && !isTest ? pgOptions : sqliteOptions;
      },
      dataSourceFactory: async (options: DataSourceOptions) => {
        const dataSource = new DataSource(options);
        const attemptsRaw = String(process.env.DB_CONNECT_RETRY_ATTEMPTS || '');
        const delayRaw = String(process.env.DB_CONNECT_RETRY_DELAY_MS || '');
        const attempts = Math.max(1, parseInt(attemptsRaw || '10'));
        const delayMs = Math.max(0, parseInt(delayRaw || '3000'));
        let lastErr: unknown = null;
        for (let i = 0; i < attempts; i += 1) {
          try {
            await dataSource.initialize();
            return dataSource;
          } catch (err) {
            lastErr = err;
            if (dataSource.isInitialized) {
              await dataSource.destroy().catch(() => undefined);
            }
            if (i < attempts - 1 && delayMs > 0) {
              await new Promise((r) => setTimeout(r, delayMs));
            }
          }
        }
        throw lastErr;
      },
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
