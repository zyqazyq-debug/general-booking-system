import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { UserToken } from './entities/user-token.entity';
import { RolesGuard } from '../auth';
import { UserFinancialService } from './services/user-financial.service';
import { UserCreditListener } from './listeners/user-credit.listener';
import { UserTokenService } from './services/user-token.service';
import { UsersProfileService } from './services/users-profile.service';
import { UsersIdentityService } from './services/users-identity.service';
import { UsersReferralService } from './services/users-referral.service';
import { OrderUsersAdapter } from './adapters/order-users.adapter';
import { NotificationUsersAdapter } from './adapters/notification-users.adapter';
import { PaymentUsersAdapter } from './adapters/payment-users.adapter';
import { AuthUsersAdapter } from './adapters/auth-users.adapter';
import { CleanupTasksUsersAdapter } from './adapters/cleanup-tasks-users.adapter';
import { InitUsersAdapter } from './adapters/init-users.adapter';
import { AdminUsersAdapter } from './adapters/admin-users.adapter';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserToken])],
  controllers: [UsersController],
  providers: [
    UsersService,
    RolesGuard,
    UsersProfileService,
    UsersIdentityService,
    UsersReferralService,
    UserFinancialService,
    UserTokenService,
    UserCreditListener,
    OrderUsersAdapter,
    NotificationUsersAdapter,
    PaymentUsersAdapter,
    AuthUsersAdapter,
    CleanupTasksUsersAdapter,
    InitUsersAdapter,
    AdminUsersAdapter,
  ],
  exports: [
    UsersService,
    OrderUsersAdapter,
    NotificationUsersAdapter,
    PaymentUsersAdapter,
    AuthUsersAdapter,
    CleanupTasksUsersAdapter,
    InitUsersAdapter,
    AdminUsersAdapter,
  ],
})
export class UsersModule {}
