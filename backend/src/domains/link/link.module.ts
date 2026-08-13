import { Module } from '@nestjs/common';
import { LinkController } from './link.controller';

@Module({
  controllers: [LinkController],
})
export class LinkModule {}
