import { Type, applyDecorators } from '@nestjs/common';
import { ApiCreatedResponse, ApiExtraModels, ApiOkResponse, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { SocialProvider } from './social-login.dto';

export class AuthLoginUserResponseDto {
  @ApiProperty({ type: String }) id: string;
  @ApiProperty({ type: String }) username: string;
  @ApiProperty({ type: String }) referral_code: string;
  @ApiProperty({ type: String }) email: string;
  @ApiProperty({ type: [String] }) roles: string[];
  @ApiProperty({ type: Number }) wallet_balance: number;
  @ApiProperty({ type: Number }) credit_balance: number;
  @ApiProperty({ type: Number }) frozen_credit: number;
}
export class ApiSuccessEnvelopeDto {
  @ApiProperty({ type: Number, enum: [0] }) code: number;
  @ApiProperty({ type: String, enum: ['OK'] }) message: string;
}
type SuccessResponseModel = Type<unknown>;
function schema(models: readonly SuccessResponseModel[], isArray = false) {
  const data = models.length === 1 ? (isArray ? { type: 'array', items: { $ref: getSchemaPath(models[0]) } } : { $ref: getSchemaPath(models[0]) }) : { oneOf: models.map((model) => ({ $ref: getSchemaPath(model) })) };
  return { allOf: [{ $ref: getSchemaPath(ApiSuccessEnvelopeDto) }, { type: 'object', required: ['data'], properties: { data } }] };
}
function envelope(models: readonly SuccessResponseModel[], isArray: boolean, response: (options: { schema: ReturnType<typeof schema> }) => MethodDecorator) {
  return applyDecorators(ApiExtraModels(ApiSuccessEnvelopeDto, ...models), response({ schema: schema(models, isArray) }));
}
export function ApiCreatedAuthSuccessResponse(model: SuccessResponseModel | readonly SuccessResponseModel[], options: { isArray?: boolean } = {}) {
  return envelope(Array.isArray(model) ? model : [model], options.isArray === true, ApiCreatedResponse);
}
export function ApiOkAuthSuccessResponse(model: SuccessResponseModel | readonly SuccessResponseModel[], options: { isArray?: boolean } = {}) {
  return envelope(Array.isArray(model) ? model : [model], options.isArray === true, ApiOkResponse);
}
export class AuthLoginResponseDto {
  @ApiProperty({ type: String }) access_token: string;
  @ApiProperty({ type: String }) refresh_token: string;
  @ApiProperty({ type: AuthLoginUserResponseDto }) user: AuthLoginUserResponseDto;
}
export class AuthTokenPairResponseDto { @ApiProperty({ type: String }) access_token: string; @ApiProperty({ type: String }) refresh_token: string; }
export class LogoutResponseDto { @ApiProperty({ type: Boolean, enum: [true] }) success: boolean; }
export class SocialProviderResponseDto { @ApiProperty({ enum: SocialProvider, enumName: 'SocialProvider' }) provider: SocialProvider; @ApiProperty({ enum: ['ready', 'reserved'] }) status: 'ready' | 'reserved'; }
export class ReservedSocialLoginResponseDto { @ApiProperty({ enum: ['reserved'] }) status: 'reserved'; @ApiProperty({ enum: SocialProvider, enumName: 'SocialProvider' }) provider: SocialProvider; @ApiProperty({ type: String }) auth_code: string; @ApiProperty({ type: String }) message: string; }
export class ReservedSmsCodeResponseDto { @ApiProperty({ enum: ['reserved'] }) status: 'reserved'; @ApiProperty({ type: String, format: 'phone' }) phone: string; @ApiProperty({ type: String }) scene: string; @ApiProperty({ type: String }) message: string; }
export class TelegramLoginTicketResponseDto { @ApiProperty({ type: String }) ticket_id: string; @ApiProperty({ type: String }) bot_url: string; @ApiProperty({ type: Number }) expires_in: number; }
export class IdentityBoundResponseDto extends AuthLoginResponseDto { @ApiProperty({ enum: ['bound'] }) status: 'bound'; }
export class IdentityMergeRequiredResponseDto { @ApiProperty({ enum: ['merge_required'] }) status: 'merge_required'; @ApiProperty({ enum: ['phone', 'wechat', 'qq', 'telegram'] }) provider: 'phone' | 'wechat' | 'qq' | 'telegram'; }
export class TelegramScanExtraResponseDto { @ApiProperty({ type: String }) bot_username: string; @ApiProperty({ type: String }) bot_name: string; }
export class TelegramIdentityScanStartResponseDto { @ApiProperty({ enum: ['ready'] }) status: 'ready'; @ApiProperty({ enum: ['telegram'] }) provider: 'telegram'; @ApiProperty({ type: String }) ticket_id: string; @ApiProperty({ type: String }) qr_url: string; @ApiProperty({ type: Number }) expires_in: number; @ApiProperty({ type: String }) message: string; @ApiProperty({ type: TelegramScanExtraResponseDto }) extra: TelegramScanExtraResponseDto; }
export class ReservedIdentityScanStartResponseDto { @ApiProperty({ enum: ['reserved'] }) status: 'reserved'; @ApiProperty({ type: String }) user_id: string; @ApiProperty({ enum: ['wechat', 'qq'] }) provider: 'wechat' | 'qq'; @ApiProperty({ type: String }) ticket_id: string; @ApiProperty({ type: String }) qr_url: string; @ApiProperty({ type: Number }) expires_in: number; @ApiProperty({ type: String }) message: string; }
export class IdentityScanPendingResponseDto { @ApiProperty({ enum: ['pending', 'expired'] }) status: 'pending' | 'expired'; @ApiProperty({ type: String }) ticket_id: string; @ApiProperty({ type: String }) message: string; }
export class IdentityScanSuccessResponseDto extends AuthLoginResponseDto { @ApiProperty({ enum: ['success'] }) status: 'success'; @ApiProperty({ type: String }) ticket_id: string; @ApiProperty({ type: String }) message: string; }
export class IdentityUnbindResponseDto { @ApiProperty({ enum: ['success'] }) status: 'success'; @ApiProperty({ type: String }) message: string; }
