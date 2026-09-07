import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
  @ApiProperty({ enum: SocialProvider, enumName: 'SocialProvider' })
  provider: SocialProvider;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @ApiProperty({ type: String, maxLength: 255 })
  auth_code: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @ApiPropertyOptional({ type: String, maxLength: 255 })
  redirect_uri?: string;

  @IsOptional()
  @IsObject()
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  extra?: Record<string, unknown>;
}
