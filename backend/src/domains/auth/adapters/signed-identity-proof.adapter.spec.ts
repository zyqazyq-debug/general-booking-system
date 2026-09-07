import { UnauthorizedException } from '@nestjs/common';
import { SignedIdentityProofAdapter } from './signed-identity-proof.adapter';

describe('SignedIdentityProofAdapter', () => {
  const config = { get: jest.fn() };
  const jwt = { verifyAsync: jest.fn() };
  const repository = { insert: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockReturnValue('proof-secret');
    jwt.verifyAsync.mockResolvedValue({
      token_use: 'identity_proof',
      provider: 'wechat',
      sub: 'verified-openid',
      jti: 'proof-1',
      actor_id: 'actor-1',
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    repository.insert.mockResolvedValue(undefined);
  });

  it('fails closed when the dedicated proof verifier is not configured', async () => {
    config.get.mockReturnValue(undefined);
    const adapter = new SignedIdentityProofAdapter(
      config as never,
      jwt as never,
      repository as never,
    );

    await expect(
      adapter.consume('proof', 'wechat', 'actor-1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('binds proof provider and actor and records one-time consumption', async () => {
    const adapter = new SignedIdentityProofAdapter(
      config as never,
      jwt as never,
      repository as never,
    );

    await expect(
      adapter.consume('proof', 'wechat', 'actor-1'),
    ).resolves.toEqual({
      proofId: 'proof-1',
      provider: 'wechat',
      subject: 'verified-openid',
    });
    expect(jwt.verifyAsync).toHaveBeenCalledWith('proof', {
      secret: 'proof-secret',
      audience: 'auth-identity',
      issuer: 'platform-identity-adapter',
    });
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'wechat',
        actor_id: 'actor-1',
        proof_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        subject_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it('rejects a consumed proof without falling back to its subject', async () => {
    repository.insert.mockRejectedValue({ code: '23505' });
    const adapter = new SignedIdentityProofAdapter(
      config as never,
      jwt as never,
      repository as never,
    );

    await expect(adapter.consume('proof', 'wechat', 'actor-1')).rejects.toThrow(
      'Identity proof was already consumed',
    );
  });
});
