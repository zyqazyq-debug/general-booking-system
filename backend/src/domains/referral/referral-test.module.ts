import { Module } from '@nestjs/common';
import { ReferralModule } from './referral.module';
import { ReferralTestController } from './referral-test.controller';

/**
 * Explicitly opt-in test harness module. It is intentionally not imported by
 * AppModule or the referral runtime barrel used by the production application.
 */
@Module({
  imports: [ReferralModule],
  controllers: [ReferralTestController],
})
export class ReferralTestModule {}
