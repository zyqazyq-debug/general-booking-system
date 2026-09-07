import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthPublicController } from './auth-public.controller';
import { AuthSessionController } from './auth-session.controller';
import { AuthIdentityController } from './auth-identity.controller';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { TelegramCoreModule } from '../../platforms/telegram';
import { AuthTokenService } from './services/auth-token.service';
import { RegistrationService } from './services/registration.service';
import { SocialAuthService } from './services/social-auth.service';
import { SocialLoginListener } from './listeners/social-login.listener';
import { AccountMergeService } from './services/account-merge.service';
import { AuthTelegramLoginService } from './services/auth-telegram-login.service';
import { AuthIdentityService } from './services/auth-identity.service';
import { ConsumedIdentityProof } from './entities/consumed-identity-proof.entity';
import { SignedIdentityProofAdapter } from './adapters/signed-identity-proof.adapter';
import { AUTH_IDENTITY_PROOF_PORT } from './ports/tokens';

import { AgencyAuthAdapter } from './adapters/agency-auth.adapter';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConsumedIdentityProof]),
    PassportModule,
    ConfigModule,
    TelegramCoreModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const activeIndex =
          configService.get<string>('JWT_SECRET_ACTIVE_INDEX') || '1';
        const secret1 = configService.get<string>('JWT_SECRET1');
        const secret2 = configService.get<string>('JWT_SECRET2');

        const secret =
          activeIndex === '2'
            ? secret2
            : secret1 || configService.get<string>('JWT_SECRET');

        if (!secret) {
          throw new Error(
            'JWT_SECRET is not defined. Set JWT_SECRET1/2 (+JWT_SECRET_ACTIVE_INDEX) or JWT_SECRET',
          );
        }

        return {
          secret,
          signOptions: { expiresIn: '1h' }, // Access token expires in 1h
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [
    AuthPublicController,
    AuthSessionController,
    AuthIdentityController,
  ],
  providers: [
    AuthService,
    JwtStrategy,
    AuthTokenService,
    RegistrationService,
    SocialAuthService,
    AccountMergeService,
    AuthTelegramLoginService,
    AuthIdentityService,
    SignedIdentityProofAdapter,
    {
      provide: AUTH_IDENTITY_PROOF_PORT,
      useExisting: SignedIdentityProofAdapter,
    },
    SocialLoginListener,
    AgencyAuthAdapter,
  ],
  exports: [AuthService, AgencyAuthAdapter],
})
export class AuthModule {}
