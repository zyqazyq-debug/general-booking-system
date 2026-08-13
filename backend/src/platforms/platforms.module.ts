import { Module } from '@nestjs/common';
import { TelegramPlatformModule } from './telegram/runtime';

@Module({
  imports: [TelegramPlatformModule],
  exports: [TelegramPlatformModule],
})
export class PlatformsModule {}
