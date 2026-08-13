import { Global, Module } from '@nestjs/common';

import {
  UsersModule,
  AuthUsersAdapter,
  InitUsersAdapter,
  CleanupTasksUsersAdapter,
  OrderUsersAdapter,
  AdminUsersAdapter,
  NotificationUsersAdapter,
  PaymentUsersAdapter,
} from '../domains/users/runtime';

import { AuthModule, AgencyAuthAdapter } from '../domains/auth/runtime';
import { AUTH_ORDER_PORT, AUTH_USERS_PORT } from '../domains/auth';

import {
  OrderModule,
  AuthOrderAdapter,
  AdminOrderAdapter,
} from '../domains/order/runtime';
import {
  ORDER_AGENCY_PORT,
  ORDER_AVAILABILITY_PORT,
  ORDER_NOTIFICATION_PORT,
  ORDER_SERVICES_PORT,
  ORDER_USERS_PORT,
} from '../domains/order';

import {
  ServicesModule,
  AgencyServicesModule,
  CleanupTasksServicesAdapter,
  OrderServicesAdapter,
  OrderAvailabilityAdapter,
  AdminServicesAdapter,
  AgencyServicesAdapter,
} from '../domains/services/runtime';
import { SERVICES_AGENCY_PORT } from '../domains/services';

import {
  AgencyModule,
  OrderAgencyAdapter,
  LinkAgencyAdapter,
  ServicesAgencyAdapter,
  AdminAgencyAdapter,
} from '../domains/agency/runtime';
import {
  AGENCY_AUTH_PORT,
  AGENCY_LINK_QUERY_PORT,
  AGENCY_SYSTEM_CONFIG_PORT,
  AGENCY_SERVICES_PORT,
} from '../domains/agency';

import {
  NotificationModule,
  OrderNotificationAdapter,
} from '../domains/notification/runtime';
import { NOTIFICATION_USERS_PORT } from '../domains/notification';

import { PaymentModule } from '../domains/payment/runtime';
import { PAYMENT_USERS_PORT } from '../domains/payment';

import {
  SystemConfigModule,
  AgencySystemConfigAdapter,
} from '../domains/system-config/runtime';

import {
  ADMIN_AGENCY_PORT,
  ADMIN_ORDER_PORT,
  ADMIN_SERVICES_PORT,
  ADMIN_USERS_PORT,
} from '../domains/admin';

// Shared Tokens
import { INIT_USERS_PORT } from '../shared/init/ports/tokens';
import {
  CLEANUP_TASKS_SERVICES_PORT,
  CLEANUP_TASKS_USERS_PORT,
} from './tasks/ports/tokens';

@Global()
@Module({
  imports: [
    UsersModule,
    AuthModule,
    OrderModule,
    ServicesModule,
    AgencyServicesModule,
    AgencyModule,
    NotificationModule,
    PaymentModule,
    SystemConfigModule,
  ],
  providers: [
    {
      provide: AUTH_USERS_PORT,
      useExisting: AuthUsersAdapter,
    },
    {
      provide: AUTH_ORDER_PORT,
      useExisting: AuthOrderAdapter,
    },
    {
      provide: INIT_USERS_PORT,
      useExisting: InitUsersAdapter,
    },
    {
      provide: CLEANUP_TASKS_USERS_PORT,
      useExisting: CleanupTasksUsersAdapter,
    },
    {
      provide: CLEANUP_TASKS_SERVICES_PORT,
      useExisting: CleanupTasksServicesAdapter,
    },
    // Order module dependencies
    {
      provide: ORDER_AGENCY_PORT,
      useExisting: OrderAgencyAdapter,
    },
    {
      provide: ORDER_USERS_PORT,
      useExisting: OrderUsersAdapter,
    },
    {
      provide: ORDER_SERVICES_PORT,
      useExisting: OrderServicesAdapter,
    },
    {
      provide: ORDER_AVAILABILITY_PORT,
      useExisting: OrderAvailabilityAdapter,
    },
    {
      provide: ORDER_NOTIFICATION_PORT,
      useExisting: OrderNotificationAdapter,
    },
    // Agency module dependencies
    {
      provide: AGENCY_AUTH_PORT,
      useExisting: AgencyAuthAdapter,
    },
    {
      provide: AGENCY_SYSTEM_CONFIG_PORT,
      useExisting: AgencySystemConfigAdapter,
    },
    {
      provide: AGENCY_LINK_QUERY_PORT,
      useExisting: LinkAgencyAdapter,
    },
    {
      provide: AGENCY_SERVICES_PORT,
      useExisting: AgencyServicesAdapter,
    },
    // Services module dependencies
    {
      provide: SERVICES_AGENCY_PORT,
      useExisting: ServicesAgencyAdapter,
    },
    // Admin module dependencies
    {
      provide: ADMIN_USERS_PORT,
      useExisting: AdminUsersAdapter,
    },
    {
      provide: ADMIN_SERVICES_PORT,
      useExisting: AdminServicesAdapter,
    },
    {
      provide: ADMIN_ORDER_PORT,
      useExisting: AdminOrderAdapter,
    },
    {
      provide: ADMIN_AGENCY_PORT,
      useExisting: AdminAgencyAdapter,
    },
    // Notification module dependencies
    {
      provide: NOTIFICATION_USERS_PORT,
      useExisting: NotificationUsersAdapter,
    },
    // Payment module dependencies
    {
      provide: PAYMENT_USERS_PORT,
      useExisting: PaymentUsersAdapter,
    },
  ],
  exports: [
    AUTH_USERS_PORT,
    AUTH_ORDER_PORT,
    INIT_USERS_PORT,
    CLEANUP_TASKS_USERS_PORT,
    CLEANUP_TASKS_SERVICES_PORT,
    ORDER_AGENCY_PORT,
    ORDER_USERS_PORT,
    ORDER_SERVICES_PORT,
    ORDER_AVAILABILITY_PORT,
    ORDER_NOTIFICATION_PORT,
    AGENCY_AUTH_PORT,
    AGENCY_SYSTEM_CONFIG_PORT,
    AGENCY_LINK_QUERY_PORT,
    AGENCY_SERVICES_PORT,
    SERVICES_AGENCY_PORT,
    ADMIN_USERS_PORT,
    ADMIN_SERVICES_PORT,
    ADMIN_ORDER_PORT,
    ADMIN_AGENCY_PORT,
    NOTIFICATION_USERS_PORT,
    PAYMENT_USERS_PORT,
  ],
})
export class DomainPortsModule {}
