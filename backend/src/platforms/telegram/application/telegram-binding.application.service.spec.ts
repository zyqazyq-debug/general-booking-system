import { TelegramBindingApplicationService } from './telegram-binding.application.service';
import { TelegramBindingService } from '../bot/services/telegram-binding.service';

describe('TelegramBindingApplicationService recoverable login ticket', () => {
  it('replays the persisted login result after a crash before ticket completion', async () => {
    const loginResult = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      user: { id: 'user-1' },
    };
    const authPort = {
      loginByChatId: jest.fn().mockResolvedValue(loginResult),
    };
    const binding = {
      peekTokenStatus: jest.fn().mockReturnValue({ status: 'pending' }),
      completeToken: jest
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('simulated crash before ticket completion');
        })
        .mockImplementationOnce(() => undefined),
    };
    let persistedResult: unknown;
    const fence = {
      executeOnceRecoverable: jest.fn(
        async (
          _operation: string,
          _resource: string,
          work: () => Promise<unknown>,
        ) => {
          if (persistedResult) {
            return { result: persistedResult, replayed: true };
          }
          persistedResult = await work();
          return { result: persistedResult, replayed: false };
        },
      ),
    };
    const service = new TelegramBindingApplicationService(
      {} as any,
      binding as any,
      authPort as any,
      {} as any,
      fence as any,
    );

    await expect(
      service.loginByDeepLinkToken('lt_ticket', '10001'),
    ).rejects.toThrow('simulated crash');
    await expect(
      service.loginByDeepLinkToken('lt_ticket', '10001'),
    ).resolves.toBe('success');

    expect(authPort.loginByChatId).toHaveBeenCalledTimes(1);
    expect(binding.completeToken).toHaveBeenCalledTimes(2);
    expect(binding.completeToken).toHaveBeenLastCalledWith(
      'lt_ticket',
      loginResult,
    );
  });

  it('fails closed instead of restoring a missing login ticket result', async () => {
    const loginResult = {
      access_token: 'a',
      refresh_token: 'r',
      user: { id: 'u' },
    };
    const binding = {
      peekTokenStatus: jest.fn().mockReturnValue({ status: 'not_found' }),
      completeToken: jest.fn(),
    };
    const fence = {
      recoverCompletedResult: jest.fn().mockResolvedValue(loginResult),
    };
    const authPort = { loginByChatId: jest.fn() };
    const service = new TelegramBindingApplicationService(
      {} as any,
      binding as any,
      authPort as any,
      {} as any,
      fence as any,
    );

    await expect(
      service.loginByDeepLinkToken('lt_ticket', '10001'),
    ).resolves.toBe('invalid');
    expect(authPort.loginByChatId).not.toHaveBeenCalled();
    expect(binding.completeToken).not.toHaveBeenCalled();
    expect(fence.recoverCompletedResult).not.toHaveBeenCalled();
  });

  it('does not recreate a consumed ticket in an empty in-memory store', async () => {
    const loginResult = {
      access_token: 'persisted-access',
      refresh_token: 'persisted-refresh',
      user: { id: 'u' },
    };
    const restartedBinding = new TelegramBindingService(
      { get: jest.fn() } as any,
      {} as any,
    );
    await expect(
      restartedBinding.getTokenStatus('lt_restarted'),
    ).resolves.toEqual({
      status: 'not_found',
    });
    const fence = {
      recoverCompletedResult: jest.fn().mockResolvedValue(loginResult),
    };
    const authPort = { loginByChatId: jest.fn() };
    const service = new TelegramBindingApplicationService(
      {} as any,
      restartedBinding,
      authPort as any,
      {} as any,
      fence as any,
    );

    await expect(
      service.loginByDeepLinkToken('lt_restarted', '10001'),
    ).resolves.toBe('invalid');
    expect(authPort.loginByChatId).not.toHaveBeenCalled();
    await expect(
      restartedBinding.getTokenStatus('lt_restarted'),
    ).resolves.toEqual({
      status: 'not_found',
    });
    expect(fence.recoverCompletedResult).not.toHaveBeenCalled();
  });
});
