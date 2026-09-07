import { Body, Controller, Module, Post } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { CreateAgencyNodeDto } from '../../agency/dto/create-agency-node.dto';
import {
  ExecuteImportDto,
  ReparentCollectionDto,
  SetCollectionStatusDto,
  UpdateCollectionDto,
} from '../../agency/dto/collection-mutation.dto';
import { UpdateUserDto } from '../../users/dto/update-user.dto';
import {
  AddUserRoleDto,
  ChangePasswordDto,
  CreateCreditPurchaseIntentDto,
} from '../../users/dto/user-account-action.dto';
import { CreateAuthUserDto } from './create-auth-user.dto';
import { IdentityBindDto } from './identity-merge.dto';
import { IdentityUnbindDto } from './identity-unbind.dto';
import {
  IdentityScanStartDto,
  IdentityScanStatusDto,
} from './identity-scan.dto';
import { LoginDto } from './login.dto';
import { MergeTelegramAccountDto } from './merge-telegram-account.dto';
import { SendSmsCodeDto, VerifySmsLoginDto } from './sms-auth.dto';
import { SocialIdentityProofDto } from './social-identity-proof.dto';
import { SocialLoginDto } from './social-login.dto';
import { RefreshTokenDto } from './session-token.dto';
import { TelegramLoginDto } from './telegram-login.dto';
import { TelegramWebAppLoginDto } from './telegram-webapp-login.dto';

@Controller('swagger-dto-probe')
class SwaggerDtoProbeController {
  @Post('register')
  register(@Body() _body: CreateAuthUserDto) {}

  @Post('social-proof')
  socialProof(@Body() _body: SocialIdentityProofDto) {}

  @Post('social-login')
  socialLogin(@Body() _body: SocialLoginDto) {}

  @Post('login')
  login(@Body() _body: LoginDto) {}

  @Post('sms-verify')
  smsVerify(@Body() _body: VerifySmsLoginDto) {}

  @Post('sms-send')
  smsSend(@Body() _body: SendSmsCodeDto) {}

  @Post('telegram-merge')
  telegramMerge(@Body() _body: MergeTelegramAccountDto) {}

  @Post('identity-bind')
  identityBind(@Body() _body: IdentityBindDto) {}

  @Post('identity-scan-start')
  identityScanStart(@Body() _body: IdentityScanStartDto) {}

  @Post('identity-scan-status')
  identityScanStatus(@Body() _body: IdentityScanStatusDto) {}

  @Post('user-update')
  userUpdate(@Body() _body: UpdateUserDto) {}

  @Post('agency-node')
  agencyNode(@Body() _body: CreateAgencyNodeDto) {}

  @Post('refresh-token')
  refreshToken(@Body() _body: RefreshTokenDto) {}

  @Post('telegram-login')
  telegramLogin(@Body() _body: TelegramLoginDto) {}

  @Post('telegram-webapp-login')
  telegramWebAppLogin(@Body() _body: TelegramWebAppLoginDto) {}

  @Post('identity-unbind')
  identityUnbind(@Body() _body: IdentityUnbindDto) {}

  @Post('collection-status')
  collectionStatus(@Body() _body: SetCollectionStatusDto) {}

  @Post('collection-reparent')
  collectionReparent(@Body() _body: ReparentCollectionDto) {}

  @Post('collection-update')
  collectionUpdate(@Body() _body: UpdateCollectionDto) {}

  @Post('collection-import')
  collectionImport(@Body() _body: ExecuteImportDto) {}

  @Post('user-role')
  userRole(@Body() _body: AddUserRoleDto) {}

  @Post('change-password')
  changePassword(@Body() _body: ChangePasswordDto) {}

  @Post('credit-purchase-intent')
  creditPurchaseIntent(@Body() _body: CreateCreditPurchaseIntentDto) {}
}

@Module({ controllers: [SwaggerDtoProbeController] })
class SwaggerDtoProbeModule {}

type ProbeSchema = {
  properties?: Record<string, Record<string, unknown>>;
  required?: string[];
};

describe('Swagger request DTO contracts', () => {
  it('emits non-empty schemas with transport constraints', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SwaggerDtoProbeModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('DTO contract probe').build(),
      );
      const schemas = (document.components?.schemas || {}) as Record<
        string,
        ProbeSchema
      >;

      const expectedProperties: Record<string, string[]> = {
        CreateAuthUserDto: [
          'username',
          'password',
          'locale',
          'referral_code',
          'email',
        ],
        SocialIdentityProofDto: ['proof', 'deviceInfo'],
        SocialLoginDto: ['provider', 'auth_code', 'redirect_uri', 'extra'],
        LoginDto: ['username', 'password', 'deviceInfo'],
        VerifySmsLoginDto: ['phone', 'code', 'deviceInfo'],
        SendSmsCodeDto: ['phone', 'scene'],
        MergeTelegramAccountDto: ['phone', 'code'],
        IdentityBindDto: ['provider', 'identity', 'code', 'proof'],
        IdentityScanStartDto: ['provider'],
        IdentityScanStatusDto: ['ticket_id'],
        UpdateUserDto: ['username', 'password', 'locale', 'email'],
        CreateAgencyNodeDto: [
          'serviceId',
          'listingId',
          'listingIds',
          'parentNodeId',
          'markup_type',
          'markup_value',
          'alias',
          'private_notes',
          'public_notes',
          'compliance_content',
          'compliance_signature',
          'deviceInfo',
        ],
        RefreshTokenDto: ['refresh_token'],
        TelegramLoginDto: [
          'id',
          'first_name',
          'last_name',
          'username',
          'photo_url',
          'auth_date',
          'hash',
          'deviceInfo',
        ],
        TelegramWebAppLoginDto: ['initData'],
        IdentityUnbindDto: ['provider'],
        SetCollectionStatusDto: ['is_active'],
        ReparentCollectionDto: ['newParentNodeId'],
        UpdateCollectionDto: [
          'markup_type',
          'markup_value',
          'private_notes',
          'public_notes',
          'alias',
        ],
        ExecuteImportDto: ['token', 'force', 'import_as_child'],
        AddUserRoleDto: ['role'],
        ChangePasswordDto: ['oldPassword', 'newPassword'],
        CreateCreditPurchaseIntentDto: ['required_credit'],
      };

      for (const [name, properties] of Object.entries(expectedProperties)) {
        const schema = schemas[name];
        expect(schema).toBeDefined();
        expect(schema.properties).toEqual(expect.any(Object));
        expect(Object.keys(schema.properties || {})).toEqual(
          expect.arrayContaining(properties),
        );
      }

      expect(schemas.CreateAuthUserDto.required).toEqual(
        expect.arrayContaining(['username', 'password']),
      );
      expect(schemas.SocialLoginDto.properties?.provider.enum).toEqual(
        expect.arrayContaining(['wechat', 'qq', 'telegram']),
      );
      expect(schemas.VerifySmsLoginDto.properties?.code).toMatchObject({
        type: 'string',
        minLength: 4,
        maxLength: 8,
      });
      expect(schemas.UpdateUserDto.required || []).not.toEqual(
        expect.arrayContaining(['username', 'password']),
      );
      expect(schemas.UpdateUserDto.properties).not.toMatchObject({
        roles: expect.anything(),
        referrer_id: expect.anything(),
        referral_code: expect.anything(),
      });
      expect(schemas.CreateAgencyNodeDto.properties?.listingIds).toMatchObject({
        type: 'array',
        items: { type: 'string', pattern: '^\\d+$' },
      });
      expect(
        schemas.SocialIdentityProofDto.properties?.deviceInfo,
      ).toMatchObject({ type: 'object', additionalProperties: true });
    } finally {
      await app.close();
    }
  });
});
