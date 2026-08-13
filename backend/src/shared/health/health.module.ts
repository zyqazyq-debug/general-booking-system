import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PlatformsModule } from '../../platforms/platforms.module';

@Module({
  imports: [TerminusModule, PlatformsModule],
  controllers: [HealthController],
})
export class HealthModule {}
