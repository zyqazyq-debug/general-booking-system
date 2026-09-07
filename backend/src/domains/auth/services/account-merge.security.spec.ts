import type { EntityManager } from 'typeorm';
import { AccountMergeService } from './account-merge.service';

describe('AccountMergeService security policy', () => {
  const manager = {} as EntityManager;
  const dataSource = { transaction: jest.fn() };
  const usersPort = {
    saveTx: jest.fn(),
    revokeAllSessionsTx: jest.fn(),
    findOne: jest.fn(),
    findByWechat: jest.fn(),
    save: jest.fn(),
  };
  const orderPort = { transferOrders: jest.fn() };
  const proofPort = { consume: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    usersPort.saveTx.mockImplementation(
      async (_manager: EntityManager, user: unknown) => user,
    );
    usersPort.revokeAllSessionsTx.mockResolvedValue(undefined);
    orderPort.transferOrders.mockResolvedValue(undefined);
    proofPort.consume.mockResolvedValue({
      proofId: 'proof-1',
      provider: 'wechat',
      subject: 'verified-openid',
    });
  });

  it('does not inherit privileged roles and revokes both account sessions', async () => {
    const service = new (
      AccountMergeService as unknown as new (
        dataSource: unknown,
        usersPort: unknown,
        orderPort: unknown,
        proofPort: unknown,
      ) => AccountMergeService
    )(dataSource, usersPort, orderPort, proofPort);
    const source = {
      id: 'source',
      roles: ['ADMIN'],
      status: 'ACTIVE',
      auth_version: 1,
      wallet_balance: 0,
      credit_balance: 0,
      frozen_credit: 0,
      is_verified: true,
    };
    const target = {
      id: 'target',
      roles: ['CONSUMER'],
      status: 'ACTIVE',
      auth_version: 4,
      wallet_balance: 0,
      credit_balance: 0,
      frozen_credit: 0,
      is_verified: true,
    };

    const result = await service.performAccountMerge(
      manager,
      source as never,
      target as never,
    );

    expect(result.roles).toEqual(['CONSUMER']);
    expect(usersPort.revokeAllSessionsTx).toHaveBeenCalledWith(
      manager,
      'source',
    );
    expect(usersPort.revokeAllSessionsTx).toHaveBeenCalledWith(
      manager,
      'target',
    );
    expect(source.auth_version).toBe(2);
    expect(target.auth_version).toBe(5);
  });

  it('rejects a raw social identity before consulting account data', async () => {
    const service = new (
      AccountMergeService as unknown as new (
        dataSource: unknown,
        usersPort: unknown,
        orderPort: unknown,
        proofPort: unknown,
      ) => AccountMergeService
    )(dataSource, usersPort, orderPort, proofPort);

    await expect(
      service.bindIdentityOrRequireMerge(
        'actor-1',
        'wechat',
        'attacker-openid',
        undefined,
        'signed-proof',
      ),
    ).rejects.toThrow('Raw identity is not accepted');
    expect(proofPort.consume).not.toHaveBeenCalled();
    expect(usersPort.findOne).not.toHaveBeenCalled();
  });

  it('binds only the actor-bound subject returned by proof verification', async () => {
    const service = new (
      AccountMergeService as unknown as new (
        dataSource: unknown,
        usersPort: unknown,
        orderPort: unknown,
        proofPort: unknown,
      ) => AccountMergeService
    )(dataSource, usersPort, orderPort, proofPort);
    const current = {
      id: 'actor-1',
      status: 'ACTIVE',
      wechat_openid: null,
      is_verified: false,
    };
    usersPort.findOne.mockResolvedValue(current);
    usersPort.findByWechat.mockResolvedValue(null);
    usersPort.save.mockImplementation(async (value: unknown) => value);

    await expect(
      service.bindIdentityOrRequireMerge(
        'actor-1',
        'wechat',
        undefined,
        undefined,
        'signed-proof',
      ),
    ).resolves.toMatchObject({ status: 'bound' });
    expect(proofPort.consume).toHaveBeenCalledWith(
      'signed-proof',
      'wechat',
      'actor-1',
    );
    expect(usersPort.findByWechat).toHaveBeenCalledWith('verified-openid');
    expect(current.wechat_openid).toBe('verified-openid');
  });
});
