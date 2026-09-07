import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { UserToken } from '../entities/user-token.entity';

@Injectable()
export class UserTokenService {
  constructor(
    @InjectRepository(UserToken)
    private readonly userTokenRepository: Repository<UserToken>,
  ) {}

  async addRefreshToken(
    userId: string,
    sessionId: string,
    tokenHash: string,
    expiresAt: Date,
    deviceInfo: Record<string, unknown> = {},
  ) {
    await this.userTokenRepository
      .createQueryBuilder()
      .delete()
      .from(UserToken)
      .where('user_id = :userId AND expires_at < :now', {
        userId,
        now: new Date(),
      })
      .execute();

    const count = await this.userTokenRepository.count({
      where: {
        user_id: userId,
        revoked_at: IsNull(),
        expires_at: MoreThan(new Date()),
      },
    });

    if (count >= 5) {
      const oldest = await this.userTokenRepository.find({
        where: {
          user_id: userId,
          revoked_at: IsNull(),
          expires_at: MoreThan(new Date()),
        },
        order: { last_active_at: 'ASC' },
        take: 1,
      });
      if (oldest.length > 0) {
        await this.userTokenRepository.delete(oldest[0].id);
      }
    }

    const newToken = this.userTokenRepository.create({
      user_id: userId,
      session_id: sessionId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      device_info: deviceInfo,
      last_active_at: new Date(),
      revoked_at: null,
    });

    return this.userTokenRepository.save(newToken);
  }

  async validateRefreshToken(
    userId: string,
    sessionId: string,
    tokenHash: string,
    authVersion: number,
  ): Promise<UserToken | null> {
    const record = await this.userTokenRepository.findOne({
      where: {
        user_id: userId,
        session_id: sessionId,
        revoked_at: IsNull(),
      },
      relations: ['user'],
    });

    if (!record) return null;

    if (
      record.token_hash !== tokenHash ||
      record.expires_at < new Date() ||
      record.user.status !== 'ACTIVE' ||
      record.user.auth_version !== authVersion
    ) {
      await this.revokeSession(record.user_id, record.session_id);
      return null;
    }

    record.last_active_at = new Date();
    await this.userTokenRepository.save(record);

    return record;
  }

  async validateAccessSession(
    userId: string,
    sessionId: string,
    authVersion: number,
  ): Promise<UserToken | null> {
    const record = await this.userTokenRepository.findOne({
      where: {
        user_id: userId,
        session_id: sessionId,
        revoked_at: IsNull(),
        expires_at: MoreThan(new Date()),
      },
      relations: ['user'],
    });
    if (!record) {
      return null;
    }
    if (
      record.user.status !== 'ACTIVE' ||
      record.user.auth_version !== authVersion
    ) {
      await this.revokeSession(userId, sessionId);
      return null;
    }
    return record;
  }

  async revokeSession(userId: string, sessionId: string) {
    return this.userTokenRepository.update(
      { user_id: userId, session_id: sessionId, revoked_at: IsNull() },
      { revoked_at: new Date() },
    );
  }

  async removeAllRefreshTokens(userId: string) {
    return this.userTokenRepository.update(
      { user_id: userId, revoked_at: IsNull() },
      { revoked_at: new Date() },
    );
  }

  async rotateRefreshToken(
    sessionId: string,
    oldTokenHash: string,
    newTokenHash: string,
    expiresAt: Date,
  ) {
    const result = await this.userTokenRepository
      .createQueryBuilder()
      .update(UserToken)
      .set({
        token_hash: newTokenHash,
        expires_at: expiresAt,
        last_active_at: new Date(),
      })
      .where('session_id = :sessionId', { sessionId })
      .andWhere('token_hash = :oldTokenHash', { oldTokenHash })
      .andWhere('revoked_at IS NULL')
      .andWhere('expires_at > :now', { now: new Date() })
      .execute();
    return result.affected === 1;
  }

  async cleanupAllExpiredTokens() {
    const result = await this.userTokenRepository
      .createQueryBuilder()
      .delete()
      .from(UserToken)
      .where('expires_at < :now', { now: new Date() })
      .execute();
    return result.affected || 0;
  }
}
