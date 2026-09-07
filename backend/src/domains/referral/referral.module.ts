import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReferralController } from './referral.controller';
import { ReferralService } from './referral.service';
import { ReferralLog } from './entities/referral-log.entity';
import { ReferralPaymentSettledListener } from './listeners/referral-payment-settled.listener';

/** Controllers that are allowed in the standard production module. */
export const REFERRAL_PRODUCTION_CONTROLLERS = [ReferralController];

@Module({
  imports: [TypeOrmModule.forFeature([ReferralLog])],
  controllers: REFERRAL_PRODUCTION_CONTROLLERS,
  providers: [ReferralService, ReferralPaymentSettledListener],
  exports: [ReferralService],
})
export class ReferralModule {}
