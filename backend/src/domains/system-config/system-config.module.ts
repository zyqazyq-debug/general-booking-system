import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemConfig } from './entities/system-config.entity';
import { SystemConfigService } from './system-config.service';
import { AgencySystemConfigAdapter } from './adapters/agency-system-config.adapter';

@Module({
  imports: [TypeOrmModule.forFeature([SystemConfig])],
  providers: [SystemConfigService, AgencySystemConfigAdapter],
  exports: [SystemConfigService, AgencySystemConfigAdapter],
})
export class SystemConfigModule {}
