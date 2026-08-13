import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { Service } from './entities/service.entity';
import { ServiceBlockService } from './service-block.service';
import { ServiceAvailabilityService } from './service-availability.service';
import { ServiceBlock } from './entities/service-block.entity';
import { OrderServicesAdapter } from './adapters/order-services.adapter';
import { CleanupTasksServicesAdapter } from './adapters/cleanup-tasks-services.adapter';
import { OrderAvailabilityAdapter } from './adapters/order-availability.adapter';
import { AdminServicesAdapter } from './adapters/admin-services.adapter';
import { ServiceBlockSupportService } from './services/service-block-support.service';
import { ServiceBlockSingleService } from './services/service-block-single.service';
import { ServiceBlockGlobalService } from './services/service-block-global.service';
import { ServiceBlockMaintenanceService } from './services/service-block-maintenance.service';
import { ServiceBlockQueryService } from './services/service-block-query.service';
import { ServiceBlockRemovalService } from './services/service-block-removal.service';

@Module({
  imports: [TypeOrmModule.forFeature([Service, ServiceBlock])],
  controllers: [ServicesController],
  providers: [
    ServicesService,
    ServiceBlockService,
    ServiceAvailabilityService,
    ServiceBlockSupportService,
    ServiceBlockSingleService,
    ServiceBlockGlobalService,
    ServiceBlockMaintenanceService,
    ServiceBlockQueryService,
    ServiceBlockRemovalService,
    OrderServicesAdapter,
    CleanupTasksServicesAdapter,
    OrderAvailabilityAdapter,
    AdminServicesAdapter,
  ],
  exports: [
    ServicesService,
    ServiceAvailabilityService,
    OrderServicesAdapter,
    CleanupTasksServicesAdapter,
    OrderAvailabilityAdapter,
    AdminServicesAdapter,
  ],
})
export class ServicesModule {}
