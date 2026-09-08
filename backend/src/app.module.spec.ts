/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return */
describe('AppModule production dependency boundary', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.resetModules();
    jest.unmock('./shared/database/database.module');
    jest.unmock('./domains/admin/panel/admin-panel.module');
  });

  it('does not load the optional AdminJS panel in production', () => {
    process.env.NODE_ENV = 'production';

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
