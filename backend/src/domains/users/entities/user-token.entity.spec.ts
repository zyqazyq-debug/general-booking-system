import { DataSource } from 'typeorm';
import { User } from './user.entity';
import { UserToken } from './user-token.entity';

describe('UserToken persistence metadata', () => {
  let dataSource: DataSource | undefined;

  afterEach(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
    dataSource = undefined;
  });

  it('boots with SQLite memory storage and preserves Date metadata for revocation', async () => {
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [User, UserToken],
      synchronize: true,
    });

    await expect(dataSource.initialize()).resolves.toBe(dataSource);
    expect(
      dataSource.getMetadata(UserToken).findColumnWithPropertyName('revoked_at')
        ?.type,
    ).toBe(Date);
  });
});
