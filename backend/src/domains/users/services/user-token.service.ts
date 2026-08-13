import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserToken } from '../entities/user-token.entity';

@Injectable()
export class UserTokenService {
  constructor(
    @InjectRepository(UserToken)
    private readonly userTokenRepository: Repository<UserToken>,
  ) {}

  async addRefreshToken(
    userId: string,
    token: string,
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
      where: { user_id: userId },
    });

    if (count >= 5) {
      const oldest = await this.userTokenRepository.find({
        where: { user_id: userId },
        order: { last_active_at: 'ASC' },
        take: 1,
      });
      if (oldest.length > 0) {
        await this.userTokenRepository.delete(oldest[0].id);
      }
    }

    const newToken = this.userTokenRepository.create({
      user_id: userId,
      token,
      expires_at: expiresAt,
      device_info: deviceInfo,
      last_active_at: new Date(),
    });

    return this.userTokenRepository.save(newToken);
  }

  async validateRefreshToken(token: string): Promise<UserToken | null> {
    const record = await this.userTokenRepository.findOne({
      where: { token },
      relations: ['user'],
    });

    if (!record) return null;

    if (record.expires_at < new Date()) {
      await this.userTokenRepository.delete(record.id);
      return null;
    }

    record.last_active_at = new Date();
    await this.userTokenRepository.save(record);

    return record;
  }

  async removeRefreshToken(token: string) {
    return this.userTokenRepository.delete({ token });
  }

  async removeAllRefreshTokens(userId: string) {
    return this.userTokenRepository.delete({ user_id: userId });
  }

  async rotateRefreshToken(
    oldToken: string,
    newToken: string,
    expiresAt: Date,
  ) {
    const record = await this.userTokenRepository.findOneBy({
      token: oldToken,
    });
    if (!record) return;

    record.token = newToken;
    record.expires_at = expiresAt;
    record.last_active_at = new Date();
    return this.userTokenRepository.save(record);
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
