/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return */
describe('AppModule production dependency boundary', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const databaseKeys = [
    'USE_POSTGRES',
    'POSTGRES_HOST',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_DB',
    'REDIS_HOST',
    'REDIS_PASSWORD',
    'ALLOWED_ORIGINS',
  ] as const;
  const originalDatabaseEnv = Object.fromEntries(
    databaseKeys.map((key) => [key, process.env[key]]),
  );

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    for (const key of databaseKeys) {
      const value = originalDatabaseEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.resetModules();
    jest.unmock('./shared/database/database.module');
    jest.unmock('./domains/admin/panel/admin-panel.module');
  });

  it('does not load the optional AdminJS panel in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.USE_POSTGRES = 'true';
    process.env.POSTGRES_HOST = 'postgres';
    process.env.POSTGRES_USER = 'booking';
    process.env.POSTGRES_PASSWORD = 'test-password';
    process.env.POSTGRES_DB = 'booking';
    process.env.REDIS_HOST = 'redis';
    process.env.REDIS_PASSWORD = 'test-redis-password';
    process.env.ALLOWED_ORIGINS = 'https://example.test';

    jest.isolateModules(() => {
      jest.doMock('./shared/database/database.module', () => ({
        DatabaseModule: class DatabaseModule {},
      }));
      jest.doMock('./domains/admin/panel/admin-panel.module', () => {
        throw new Error('AdminJS panel must not load in production');
      });

      expect(() => require('./app.module')).not.toThrow();
    });
  });
});
