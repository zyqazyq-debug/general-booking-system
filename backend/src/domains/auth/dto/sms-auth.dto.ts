import {
  IsMobilePhone,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendSmsCodeDto {
  @IsString()
  @IsNotEmpty()
  @IsMobilePhone('zh-CN')
  @ApiProperty({
    type: String,
    format: 'phone',
    description: 'Mainland China mobile phone number',
  })
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @ApiPropertyOptional({ type: String, maxLength: 64 })
  scene?: string;
}

export class VerifySmsLoginDto {
  @IsString()
  @IsNotEmpty()
  @IsMobilePhone('zh-CN')
  @ApiProperty({
    type: String,
    format: 'phone',
    description: 'Mainland China mobile phone number',
  })
  phone: string;

  @IsString()
  @Length(4, 8)
  @ApiProperty({ type: String, minLength: 4, maxLength: 8 })
  code: string;

  @IsOptional()
  @IsObject()
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  deviceInfo?: Record<string, unknown>;
}
