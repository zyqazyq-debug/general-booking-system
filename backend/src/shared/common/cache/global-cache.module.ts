import { Module, Global, Logger } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-yet';

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const logger = new Logger('GlobalCacheModule');
        const redisHost = config.get<string>('REDIS_HOST');
        const redisPort = config.get<number>('REDIS_PORT', 6379);

        if (!redisHost) {
          logger.warn('REDIS_HOST not defined, falling back to memory cache.');
          return { ttl: 60000 }; // Default memory cache
        }

        try {
          // Attempt to create Redis store
          // Note: cache-manager-redis-yet handles connection internally.
          // We can configure it with a timeout to detect failure quickly.
          const store = await redisStore({
            socket: {
              host: redisHost,
              port: redisPort,
              connectTimeout: 2000, // Fail fast
            },
            ttl: 60000,
          });
          logger.log(`Redis connected: ${redisHost}:${redisPort}`);
          return {
            store,
            ttl: 60000,
          };
        } catch (error) {
          logger.error(
            `Failed to connect to Redis at ${redisHost}:${redisPort}. Falling back to memory cache.`,
            error,
          );
          return { ttl: 60000 };
        }
      },
    }),
  ],
  exports: [CacheModule],
})
export class GlobalCacheModule {}
