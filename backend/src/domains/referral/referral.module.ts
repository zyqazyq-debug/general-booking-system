import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReferralController } from './referral.controller';
import { ReferralService } from './referral.service';
import { ReferralLog } from './entities/referral-log.entity';
import { ReferralPaymentSettledListener } from './listeners/referral-payment-settled.listener';
import { ReferralTestController } from './referral-test.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ReferralLog])],
  controllers: [
    ReferralController,
    ...(process.env.NODE_ENV === 'test' ? [ReferralTestController] : []),
  ],
  providers: [ReferralService, ReferralPaymentSettledListener],
  exports: [ReferralService],
})
export class ReferralModule {}
