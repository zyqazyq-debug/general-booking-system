import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { Order } from './entities/order.entity';
import { OrderCreatedNotificationListener } from './listeners/order-created-notification.listener';
import { OrderStatusNotificationListener } from './listeners/order-status-notification.listener';
import { OrderAvailabilityCacheListener } from './listeners/order-availability-cache.listener';
import { OrderNotificationService } from './services/order-notification.service';
import { OrderTaskService } from './services/order-task.service';
import { OrderFinancialService } from './services/order-financial.service';
import { OrderQueryService } from './services/order-query.service';
import { OrderLifecycleService } from './services/order-lifecycle.service';
import { OrderCreationService } from './services/order-creation.service';
import { OrderManagementService } from './services/order-management.service';
import { OrderContextQueryService } from './services/order-context-query.service';
import { OrderAdminQueryService } from './services/order-admin-query.service';
import { OrderRelatedQueryService } from './services/order-related-query.service';
import { OrderOwnerQueryService } from './services/order-owner-query.service';
import { OrderStatusNotifierService } from './services/order-status-notifier.service';
import { OrderSourceResolverService } from './services/order-source-resolver.service';
import { AuthOrderAdapter } from './adapters/auth-order.adapter';
import { AdminOrderAdapter } from './adapters/admin-order.adapter';

@Module({
  imports: [TypeOrmModule.forFeature([Order])],
  controllers: [OrderController],
  providers: [
    OrderService,
    OrderCreatedNotificationListener,
    OrderStatusNotificationListener,
    OrderAvailabilityCacheListener,
    OrderNotificationService,
    OrderTaskService,
    OrderFinancialService,
    OrderQueryService,
    OrderLifecycleService,
    OrderCreationService,
    OrderSourceResolverService,
    OrderManagementService,
    OrderContextQueryService,
    OrderAdminQueryService,
    OrderRelatedQueryService,
    OrderOwnerQueryService,
    OrderStatusNotifierService,
    AuthOrderAdapter,
    AdminOrderAdapter,
  ],
  exports: [OrderService, AuthOrderAdapter, AdminOrderAdapter],
})
export class OrderModule {}
