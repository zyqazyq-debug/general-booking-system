import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export enum SocialProvider {
  WECHAT = 'wechat',
  QQ = 'qq',
  TELEGRAM = 'telegram',
  WEIBO = 'weibo',
  DOUYIN = 'douyin',
  XIAOHONGSHU = 'xiaohongshu',
  FACEBOOK = 'facebook',
  GOOGLE = 'google',
  APPLE = 'apple',
}

export class SocialLoginDto {
  @IsEnum(SocialProvider)
  provider: SocialProvider;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  auth_code: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  redirect_uri?: string;

  @IsOptional()
  @IsObject()
  extra?: Record<string, unknown>;
}
