import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import * as path from 'path';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './shared/database/database.module';
import { UsersModule } from './domains/users/runtime';
import { AuthModule } from './domains/auth/runtime';
import { ServicesModule } from './domains/services/runtime';
import { OrderModule } from './domains/order/runtime';
import { PaymentModule } from './domains/payment/runtime';
import { HealthModule } from './shared/health/health.module';
import { ProductListingModule } from './domains/product-listing/runtime';
import { AgencyModule } from './domains/agency/runtime';
import { ResourcesModule } from './domains/resources/runtime';
import { ReferralModule } from './domains/referral/runtime';
import { NotificationModule } from './domains/notification/runtime';
import { PlatformsModule } from './platforms/platforms.module';
import { DomainPortsModule } from './platforms/domain-ports.module';
import { PlatformPortsModule } from './platforms/platform-ports.module';
import { CalendarSyncModule } from './domains/calendar-sync/runtime';
import { SystemConfigModule } from './domains/system-config/runtime';
import { GlobalCacheModule } from './shared/common/cache/global-cache.module';
import { TasksModule } from './platforms/tasks';
import { AdminModule } from './domains/admin/admin.module';
import { LinkModule } from './domains/link/runtime';
import { validateEnv } from './config/env.validation';
import { AppThrottlerGuard } from './shared/common/guards/app-throttler.guard';

const imports: any[] = [
  ConfigModule.forRoot({
    validate: validateEnv,
    isGlobal: true,
    cache: true,
    envFilePath: [
      path.resolve(
        process.cwd(),
        '..',
        `.env.${process.env.NODE_ENV || 'development'}`,
      ),
      path.resolve(
        process.cwd(),
        `.env.${process.env.NODE_ENV || 'development'}`,
      ),
    ],
    ignoreEnvFile: false,
  }),
  TerminusModule,
  ThrottlerModule.forRoot([
    {
      ttl: 60000,
      limit: 100,
    },
  ]),
  EventEmitterModule.forRoot(),
  DatabaseModule,
  UsersModule,
  AuthModule,
  ServicesModule,
  OrderModule,
  PaymentModule,
  HealthModule,
  ProductListingModule,
  AgencyModule,
  ResourcesModule,
  ReferralModule,
  NotificationModule,
  DomainPortsModule,
  AdminModule,
  PlatformPortsModule,
  PlatformsModule,
  CalendarSyncModule,
  SystemConfigModule,
  GlobalCacheModule,
  TasksModule,
  LinkModule,
];

if (process.env.NODE_ENV !== 'test') {
  imports.splice(1, 0, ScheduleModule.forRoot());
}

if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  // Keep the optional AdminJS panel out of the production module graph. Its
  // development-only dependencies are deliberately omitted from the runtime
  // image, while the API-facing AdminModule remains available in every mode.
  const { AdminPanelModule } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./domains/admin/panel/admin-panel.module') as typeof import('./domains/admin/panel/admin-panel.module');
  imports.push(AdminPanelModule);
}

@Module({
  imports,
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
  ],
})
export class AppModule {}
