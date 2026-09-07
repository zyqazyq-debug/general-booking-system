import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SocialIdentityProofDto } from '../dto/social-identity-proof.dto';
import { SocialAuthService } from './social-auth.service';

describe('SocialAuthService verified proof boundary', () => {
  const usersPort = {
    findByWechat: jest.fn(),
    findByWechatAny: jest.fn(),
    findByQQ: jest.fn(),
    findByQQAny: jest.fn(),
    createWithProvider: jest.fn(),
    save: jest.fn(),
  };
  const authTokenService = { login: jest.fn() };
  const proofPort = { consume: jest.fn() };
  const events = { emit: jest.fn() } as unknown as EventEmitter2;

  beforeEach(() => {
    jest.clearAllMocks();
    proofPort.consume.mockResolvedValue({
      proofId: 'proof-1',
      provider: 'wechat',
      subject: 'verified-openid',
    });
    usersPort.findByWechat.mockResolvedValue({
      id: 'user-1',
      username: 'alice',
      status: 'ACTIVE',
    });
    authTokenService.login.mockResolvedValue({ access_token: 'access' });
  });

  it('rejects raw openid at the transport contract', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });

    await expect(
      pipe.transform(
        { openid: 'attacker-controlled' },
        { type: 'body', metatype: SocialIdentityProofDto },
      ),
    ).rejects.toThrow();
  });

  it('uses only the subject from a consumed one-time proof', async () => {
    const service = new (
      SocialAuthService as unknown as new (
        usersPort: unknown,
        tokens: unknown,
        events: EventEmitter2,
        proofPort: unknown,
      ) => SocialAuthService
    )(usersPort, authTokenService, events, proofPort);

    await (
      service as unknown as {
        loginWithVerifiedProof(
          provider: 'wechat',
          proof: string,
          deviceInfo?: Record<string, unknown>,
        ): Promise<unknown>;
      }
    ).loginWithVerifiedProof('wechat', 'signed-proof');

    expect(proofPort.consume).toHaveBeenCalledWith('signed-proof', 'wechat');
    expect(usersPort.findByWechat).toHaveBeenCalledWith('verified-openid');
  });

  it('never reactivates an inactive identity after a uniqueness race', async () => {
    const service = new (
      SocialAuthService as unknown as new (
        usersPort: unknown,
        tokens: unknown,
        events: EventEmitter2,
        proofPort: unknown,
      ) => SocialAuthService
    )(usersPort, authTokenService, events, proofPort);
    usersPort.findByWechat.mockResolvedValue(null);
    usersPort.createWithProvider.mockRejectedValue({ code: '23505' });
    usersPort.findByWechatAny.mockResolvedValue({
      id: 'merged-user',
      username: 'merged',
      status: 'MERGED',
    });

    await expect(
      (
        service as unknown as {
          loginWithVerifiedProof(
            provider: 'wechat',
            proof: string,
          ): Promise<unknown>;
        }
      ).loginWithVerifiedProof('wechat', 'signed-proof'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(usersPort.save).not.toHaveBeenCalled();
  });
});
