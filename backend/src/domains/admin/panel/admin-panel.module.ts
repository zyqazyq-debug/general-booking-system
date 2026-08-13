import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AdminModule } from '@adminjs/nestjs';
import type { AuthUsersPort } from '../../auth';
import { AUTH_USERS_PORT } from '../../auth';
import * as bcrypt from 'bcrypt';
import AdminJS from 'adminjs';
import * as AdminJSTypeORM from '@adminjs/typeorm';
import { RedisStore } from 'connect-redis';
import { Redis } from 'ioredis';

AdminJS.registerAdapter({
  Database: AdminJSTypeORM.Database,
  Resource: AdminJSTypeORM.Resource,
});

@Module({
  imports: [
    ConfigModule,
    AdminModule.createAdminAsync({
      imports: [ConfigModule],
      inject: [AUTH_USERS_PORT, ConfigService],
      useFactory: (usersPort: AuthUsersPort, config: ConfigService) => {
        const rootPath = config.get<string>(
          'ADMIN_PANEL_ROOT_PATH',
          '/admin-panel',
        );

        // Redis Session Store (Optional)
        let store: InstanceType<typeof RedisStore> | undefined;
        const redisHost = config.get<string>('REDIS_HOST');
        if (redisHost) {
          try {
            const redisClient = new Redis({
              host: redisHost,
              port: config.get<number>('REDIS_PORT', 6379),
              connectTimeout: 2000,
              lazyConnect: true, // Don't connect on init to avoid crash if down
            });

            // Note: If Redis is down, RedisStore might not work well or crash depending on version.
            // But we want to support optional redis.
            // connect-redis usually needs a client.
            // We can wrap it.
            store = new RedisStore({
              client: redisClient,
              prefix: 'admin_sess:',
            });
            console.log('[AdminPanel] Redis Session Store configured.');
          } catch (e) {
            console.warn(
              '[AdminPanel] Failed to configure Redis Store, falling back to MemoryStore.',
              e,
            );
          }
        }

        return {
          adminJsOptions: {
            rootPath,
            loginPath: `${rootPath}/login`,
            logoutPath: `${rootPath}/logout`,
            resources: [],
          },
          auth: {
            authenticate: async (usernameOrPhone, password) => {
              const user = await usersPort.findForAuth(usernameOrPhone);
              if (
                user &&
                user.password &&
                (await bcrypt.compare(password, user.password)) &&
                user.roles.includes('ADMIN')
              ) {
                return { ...user, email: user.username };
              }
              return null;
            },
            cookieName: config.get<string>(
              'ADMIN_PANEL_COOKIE_NAME',
              'adminjs',
            ),
            cookiePassword:
              config.get<string>('ADMIN_PANEL_COOKIE_PASSWORD') ||
              (process.env.NODE_ENV === 'production'
                ? (() => {
                    throw new Error(
                      'ADMIN_PANEL_COOKIE_PASSWORD must be set in production',
                    );
                  })()
                : 'change-me-for-dev-only'),
          },
          sessionOptions: {
            store, // If undefined, defaults to MemoryStore
            resave: false, // Recommended false for most stores
            saveUninitialized: false,
            secret:
              config.get<string>('ADMIN_PANEL_SESSION_SECRET') ||
              (process.env.NODE_ENV === 'production'
                ? (() => {
                    throw new Error(
                      'ADMIN_PANEL_SESSION_SECRET must be set in production',
                    );
                  })()
                : 'change-me-for-dev-only'),
          },
        };
      },
    }),
  ],
})
export class AdminPanelModule {}
