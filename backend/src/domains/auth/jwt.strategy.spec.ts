import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const config = {
    get: jest.fn((key: string) =>
      key === 'JWT_SECRET1' ? 'test-secret' : undefined,
    ),
  } as unknown as ConfigService;
  const usersPort = { validateAccessSession: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('rejects a refresh token at the bearer boundary', async () => {
    const strategy = new (
      JwtStrategy as unknown as new (
        config: ConfigService,
        usersPort: unknown,
      ) => JwtStrategy
    )(config, usersPort);

    await expect(
      strategy.validate({
        sub: 'user-1',
        username: 'alice',
        roles: ['CONSUMER'],
        token_use: 'refresh',
        session_id: 'session-1',
        jti: 'refresh-jti',
        auth_version: 1,
      } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(usersPort.validateAccessSession).not.toHaveBeenCalled();
  });

  it('rejects a revoked session and uses current server-side roles', async () => {
    const strategy = new (
      JwtStrategy as unknown as new (
        config: ConfigService,
        usersPort: unknown,
      ) => JwtStrategy
    )(config, usersPort);
    const payload = {
      sub: 'user-1',
      username: 'stale-name',
      roles: ['ADMIN'],
      token_use: 'access',
      session_id: 'session-1',
      jti: 'access-jti',
      auth_version: 1,
    };

    usersPort.validateAccessSession.mockResolvedValue(null);
    await expect(strategy.validate(payload as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    usersPort.validateAccessSession.mockResolvedValue({
      id: 'user-1',
      username: 'alice',
      roles: ['CONSUMER'],
    });
    await expect(strategy.validate(payload as never)).resolves.toEqual({
      id: 'user-1',
      username: 'alice',
      roles: ['CONSUMER'],
    });
  });
});
