import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencyServicesAdapter } from './adapters/agency-services.adapter';
import { Service } from './entities/service.entity';
import { ProductListing } from '../product-listing';

@Module({
  imports: [TypeOrmModule.forFeature([Service, ProductListing])],
  providers: [AgencyServicesAdapter],
  exports: [AgencyServicesAdapter],
})
export class AgencyServicesModule {}
