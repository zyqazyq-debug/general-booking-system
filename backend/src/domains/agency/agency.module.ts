import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencyService } from './agency.service';
import { AgencyCollectionController } from './agency-collection.controller';
import { AgencyMutationController } from './agency-mutation.controller';
import { AgencyPublicReadController } from './agency-public-read.controller';
import { AgencyOnboardingController } from './agency-onboarding.controller';
import { AgencyNode } from './entities/agency-node.entity';
import { CollectionQuotaSubscription } from './quota/entities/collection-quota-subscription.entity';
import { CollectionQuotaBill } from './quota/entities/collection-quota-bill.entity';
import { CollectionQuotaService } from './quota/collection-quota.service';
import { CollectionQuotaController } from './quota/collection-quota.controller';
import { CommissionRecord } from './entities/commission-record.entity';
import { AgencyImportService } from './services/agency-import.service';
import { AgencyTreeService } from './services/agency-tree.service';
import { AgencyValidationService } from './services/agency-validation.service';
import { AgencyPricingService } from './services/agency-pricing.service';
import { AgencyAvailabilityService } from './services/agency-availability.service';
import { AgencyCollectionMutationService } from './services/agency-collection-mutation.service';
import { AgencyQueryService } from './services/agency-query.service';
import { AgencyCreationService } from './services/agency-creation.service';
import { AgencyOrderCommissionListener } from './listeners/agency-order-commission.listener';
import { OrderAgencyAdapter } from './adapters/order-agency.adapter';
import { LinkAgencyAdapter } from './adapters/link-agency.adapter';
import { ServicesAgencyAdapter } from './adapters/services-agency.adapter';
import { AdminAgencyAdapter } from './adapters/admin-agency.adapter';
import { AgencyOnboardingFacade } from './services/agency-onboarding.facade';
import { AgencyOrderEventConsumption } from './entities/agency-order-event-consumption.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgencyNode,
      CommissionRecord,
      CollectionQuotaSubscription,
      CollectionQuotaBill,
      AgencyOrderEventConsumption,
    ]),
  ],
  providers: [
    AgencyService,
    CollectionQuotaService,
    AgencyImportService,
    AgencyTreeService,
    AgencyValidationService,
    AgencyPricingService,
    AgencyAvailabilityService,
    AgencyCollectionMutationService,
    AgencyQueryService,
    AgencyCreationService,
    AgencyOnboardingFacade,
    AgencyOrderCommissionListener,
    OrderAgencyAdapter,
    LinkAgencyAdapter,
    ServicesAgencyAdapter,
    AdminAgencyAdapter,
  ],
  controllers: [
    AgencyCollectionController,
    AgencyMutationController,
    AgencyPublicReadController,
    AgencyOnboardingController,
    CollectionQuotaController,
  ],
  exports: [
    AgencyService,
    AgencyQueryService,
    CollectionQuotaService,
    AgencyImportService,
    OrderAgencyAdapter,
    LinkAgencyAdapter,
    ServicesAgencyAdapter,
    AdminAgencyAdapter,
  ],
})
export class AgencyModule {}
