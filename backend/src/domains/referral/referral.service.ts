import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users';
import { ReferralLog, ReferralType } from './entities/referral-log.entity';

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);
  private readonly SYSTEM_RATIO = 0.5;
  private readonly DECAY_FACTOR = 0.5;
  private readonly MIN_REWARD_AMOUNT = 0.1;
  private readonly MAX_REFERRAL_LEVEL = 2;

  constructor(
    @InjectRepository(ReferralLog)
    private referralLogRepository: Repository<ReferralLog>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private dataSource: DataSource,
  ) {}

  async processSoftwareFeePayment(
    userId: string,
    amount: number,
  ): Promise<void> {
    if (amount <= 0) {
      this.logger.warn(`Invalid amount ${amount} for user ${userId}`);
      return;
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const payer = await queryRunner.manager.findOne(User, {
        where: { id: userId },
      });

      if (!payer) {
        throw new Error('User not found');
      }

      const pool = amount * (1 - this.SYSTEM_RATIO);
      let currentReward = pool * this.DECAY_FACTOR;
      let currentReferrerId = payer.referrer_id;
      let level = 1;

      this.logger.log(
        `Processing referral for user ${userId}, amount ${amount}, pool ${pool}`,
      );

      while (currentReferrerId && currentReward >= this.MIN_REWARD_AMOUNT) {
        const referrer = await queryRunner.manager.findOne(User, {
          where: { id: currentReferrerId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!referrer) {
          this.logger.warn(
            `Referrer ${currentReferrerId} not found, stopping chain`,
          );
          break;
        }

        if (referrer.id === payer.id) {
          this.logger.warn(
            `Self-referral detected for user ${userId}, stopping chain`,
          );
          break;
        }

        const previousBalance = Number(referrer.wallet_balance);
        const rewardAmount = Number(currentReward.toFixed(4));
        referrer.wallet_balance = previousBalance + rewardAmount;

        await queryRunner.manager.save(referrer);

        const log = new ReferralLog();
        log.sourceUser = payer;
        log.beneficiary = referrer;
        log.amount = rewardAmount;
        log.base_amount = amount;
        log.level = level;
        log.type = ReferralType.SOFTWARE_FEE;

        await queryRunner.manager.save(ReferralLog, log);

        this.logger.log(
          `Level ${level}: User ${referrer.id} gets ${rewardAmount} (Balance: ${previousBalance} -> ${referrer.wallet_balance})`,
        );

        currentReferrerId = referrer.referrer_id;
        currentReward = currentReward * this.DECAY_FACTOR;
        level++;

        if (level > this.MAX_REFERRAL_LEVEL) {
          this.logger.log(
            `Max referral level ${this.MAX_REFERRAL_LEVEL} reached, stopping chain for compliance.`,
          );
          break;
        }
      }

      await queryRunner.commitTransaction();
      this.logger.log(`Referral processing completed for user ${userId}`);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `Error processing referral for user ${userId}: ${error.message}`,
        error.stack,
      );
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getReferralLogs(userId: string) {
    return this.referralLogRepository.find({
      where: { beneficiaryId: userId },
      order: { created_at: 'DESC' },
      relations: ['sourceUser'],
    });
  }
}
