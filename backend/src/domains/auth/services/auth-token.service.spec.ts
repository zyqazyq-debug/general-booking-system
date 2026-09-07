import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { AuthTokenService } from './auth-token.service';

describe('AuthTokenService session security', () => {
  const user = {
    id: 'user-1',
    username: 'alice',
    status: 'ACTIVE',
    auth_version: 3,
    merged_into_id: null,
    roles: ['CONSUMER'],
    email: null,
    referral_code: null,
    phone: null,
    wechat_openid: null,
    qq_openid: null,
    telegram_chat_id: null,
    telegram_username: null,
    wallet_balance: 0,
    credit_balance: 0,
    frozen_credit: 0,
    is_verified: false,
    nickname: null,
    avatar: null,
  } as const;
  const usersPort = {
    addRefreshToken: jest.fn(),
    validateRefreshToken: jest.fn(),
    rotateRefreshToken: jest.fn(),
    revokeSession: jest.fn(),
  };
  const jwtService = new JwtService({ secret: 'test-secret' });

  beforeEach(() => {
    jest.clearAllMocks();
    usersPort.addRefreshToken.mockResolvedValue(undefined);
    usersPort.rotateRefreshToken.mockResolvedValue(true);
    usersPort.revokeSession.mockResolvedValue(undefined);
  });

  it('issues typed access and refresh tokens bound to one session', async () => {
    const service = new AuthTokenService(usersPort as never, jwtService);
    const result = await service.login(user as never);
    const access = jwtService.verify<Record<string, unknown>>(
      result.access_token,
    );
    const refresh = jwtService.verify<Record<string, unknown>>(
      result.refresh_token,
    );

    expect(access.token_use).toBe('access');
    expect(refresh.token_use).toBe('refresh');
    expect(access.session_id).toBe(refresh.session_id);
    expect(access.jti).not.toBe(refresh.jti);
    expect(access.auth_version).toBe(3);
    expect(usersPort.addRefreshToken).toHaveBeenCalledWith(
      'user-1',
      access.session_id,
      createHash('sha256').update(result.refresh_token).digest('hex'),
      expect.any(Date),
      {},
    );
  });

  it('rejects login for a disabled or merged account', async () => {
    const service = new AuthTokenService(usersPort as never, jwtService);

    await expect(
      service.login({ ...user, status: 'DISABLED' } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.login({ ...user, status: 'MERGED' } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails closed and revokes the session on refresh replay', async () => {
    const service = new AuthTokenService(usersPort as never, jwtService);
    const login = await service.login(user as never);
    const payload = jwtService.verify<Record<string, string | number>>(
      login.refresh_token,
    );
    usersPort.validateRefreshToken.mockResolvedValue({
      session_id: payload.session_id,
      user,
    });
    usersPort.rotateRefreshToken.mockResolvedValue(false);

    await expect(service.refresh(login.refresh_token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(usersPort.revokeSession).toHaveBeenCalledWith(
      'user-1',
      payload.session_id,
    );
  });

  it('revokes only the session owned by the authenticated actor', async () => {
    const service = new AuthTokenService(usersPort as never, jwtService);
    const login = await service.login(user as never);
    const payload = jwtService.verify<Record<string, string>>(
      login.refresh_token,
    );

    await service.logout('user-1', login.refresh_token);

    expect(usersPort.revokeSession).toHaveBeenCalledWith(
      'user-1',
      payload.session_id,
    );
  });
});
