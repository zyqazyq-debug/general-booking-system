import { readPreprodBootstrapTarget } from './bootstrap-preprod-schema';

describe('readPreprodBootstrapTarget', () => {
  const base = {
    BOOKING_SCHEMA_BOOTSTRAP: 'true',
    NODE_ENV: 'preproduction',
    POSTGRES_HOST: 'postgres',
    POSTGRES_PORT: '5432',
    POSTGRES_DB: 'booking_preprod',
    POSTGRES_USER: 'booking_preprod',
    POSTGRES_PASSWORD: 'isolated-test-password',
  };

  it('accepts only the isolated preproduction target', () => {
    expect(readPreprodBootstrapTarget(base)).toMatchObject({
      host: 'postgres',
      database: 'booking_preprod',
      port: 5432,
    });
  });

  it('rejects a non-isolated database identity', () => {
    expect(() =>
      readPreprodBootstrapTarget({ ...base, POSTGRES_DB: 'booking_db' }),
    ).toThrow('booking_preprod');
  });

  it('requires an explicit bootstrap arm', () => {
    expect(() =>
      readPreprodBootstrapTarget({ ...base, BOOKING_SCHEMA_BOOTSTRAP: 'false' }),
    ).toThrow('BOOKING_SCHEMA_BOOTSTRAP=true');
  });
});
