import { UserTokenService } from './user-token.service';

describe('UserTokenService session persistence', () => {
  const queryBuilder = {
    update: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    execute: jest.fn(),
  };
  const repository = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    for (const method of ['update', 'set', 'where', 'andWhere'] as const) {
      queryBuilder[method].mockReturnValue(queryBuilder);
    }
    repository.createQueryBuilder.mockReturnValue(queryBuilder);
  });

  it('rotates a refresh hash with one compare-and-swap update', async () => {
    queryBuilder.execute.mockResolvedValue({ affected: 1 });
    const service = new UserTokenService(repository as never);

    await expect(
      service.rotateRefreshToken(
        'session-1',
        'old-hash',
        'new-hash',
        new Date('2026-10-01T00:00:00.000Z'),
      ),
    ).resolves.toBe(true);
    expect(queryBuilder.where).toHaveBeenCalledWith('session_id = :sessionId', {
      sessionId: 'session-1',
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'token_hash = :oldTokenHash',
      { oldTokenHash: 'old-hash' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('revoked_at IS NULL');
  });

  it('reports a replay when the compare-and-swap matches no row', async () => {
    queryBuilder.execute.mockResolvedValue({ affected: 0 });
    const service = new UserTokenService(repository as never);

    await expect(
      service.rotateRefreshToken(
        'session-1',
        'replayed-hash',
        'new-hash',
        new Date('2026-10-01T00:00:00.000Z'),
      ),
    ).resolves.toBe(false);
  });

  it('rejects access when the account auth version has changed', async () => {
    repository.findOne.mockResolvedValue({
      user_id: 'user-1',
      session_id: 'session-1',
      user: { status: 'ACTIVE', auth_version: 2 },
    });
    repository.update.mockResolvedValue({ affected: 1 });
    const service = new UserTokenService(repository as never);

    await expect(
      service.validateAccessSession('user-1', 'session-1', 1),
    ).resolves.toBeNull();
    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        session_id: 'session-1',
      }),
      expect.objectContaining({ revoked_at: expect.any(Date) }),
    );
  });

  it('revokes the session family when an old refresh hash is replayed', async () => {
    repository.findOne.mockResolvedValue({
      user_id: 'user-1',
      session_id: 'session-1',
      token_hash: 'current-hash',
      expires_at: new Date('2099-01-01T00:00:00.000Z'),
      user: { status: 'ACTIVE', auth_version: 1 },
    });
    repository.update.mockResolvedValue({ affected: 1 });
    const service = new UserTokenService(repository as never);

    await expect(
      service.validateRefreshToken(
        'user-1',
        'session-1',
        'replayed-old-hash',
        1,
      ),
    ).resolves.toBeNull();
    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        session_id: 'session-1',
      }),
      expect.objectContaining({ revoked_at: expect.any(Date) }),
    );
  });
});
