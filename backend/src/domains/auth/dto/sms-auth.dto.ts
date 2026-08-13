import {
  IsMobilePhone,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class SendSmsCodeDto {
  @IsString()
  @IsNotEmpty()
  @IsMobilePhone('zh-CN')
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  scene?: string;
}

export class VerifySmsLoginDto {
  @IsString()
  @IsNotEmpty()
  @IsMobilePhone('zh-CN')
  phone: string;

  @IsString()
  @Length(4, 8)
  code: string;

  @IsOptional()
  @IsObject()
  deviceInfo?: Record<string, unknown>;
}
