import { Module, Global } from '@nestjs/common';

import { AgencyModule, PlatformAgencyAdapter } from '../domains/agency/runtime';
import { AuthModule, PlatformAuthAdapter } from '../domains/auth/runtime';
import { OrderModule, PlatformOrderAdapter } from '../domains/order/runtime';
import {
  ServicesModule,
  PlatformServicesAdapter,
} from '../domains/services/runtime';
import {
  SystemConfigModule,
  PlatformSystemConfigAdapter,
} from '../domains/system-config/runtime';
import { UsersModule, PlatformUsersAdapter } from '../domains/users/runtime';

import {
  PLATFORM_AGENCY_PORT,
  PLATFORM_AUTH_PORT,
  PLATFORM_ORDER_PORT,
  PLATFORM_SERVICES_PORT,
  PLATFORM_SYSTEM_CONFIG_PORT,
  PLATFORM_USERS_PORT,
} from './platform-ports';

@Global()
@Module({
  imports: [
    UsersModule,
    AgencyModule,
    ServicesModule,
    OrderModule,
    AuthModule,
    SystemConfigModule,
  ],
  providers: [
    PlatformUsersAdapter,
    PlatformAgencyAdapter,
    PlatformOrderAdapter,
    PlatformAuthAdapter,
    PlatformServicesAdapter,
    PlatformSystemConfigAdapter,
    {
      provide: PLATFORM_USERS_PORT,
      useExisting: PlatformUsersAdapter,
    },
    {
      provide: PLATFORM_AGENCY_PORT,
      useExisting: PlatformAgencyAdapter,
    },
    {
      provide: PLATFORM_SERVICES_PORT,
      useExisting: PlatformServicesAdapter,
    },
    {
      provide: PLATFORM_ORDER_PORT,
      useExisting: PlatformOrderAdapter,
    },
    {
      provide: PLATFORM_SYSTEM_CONFIG_PORT,
      useExisting: PlatformSystemConfigAdapter,
    },
    {
      provide: PLATFORM_AUTH_PORT,
      useExisting: PlatformAuthAdapter,
    },
  ],
  exports: [
    PLATFORM_USERS_PORT,
    PLATFORM_AGENCY_PORT,
    PLATFORM_SERVICES_PORT,
    PLATFORM_ORDER_PORT,
    PLATFORM_SYSTEM_CONFIG_PORT,
    PLATFORM_AUTH_PORT,
  ],
})
export class PlatformPortsModule {}
