import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentChannel } from '../payment.types';

export class CreatePrepayDto {
  @ApiProperty({
    enum: PaymentChannel,
    example: PaymentChannel.WECHAT,
    description: 'Payment provider channel.',
  })
  @IsEnum(PaymentChannel)
  channel: PaymentChannel;

  @ApiProperty({
    maxLength: 64,
    example: 'quota_20260907_abc123',
    description: 'Merchant order number, unique per payment transaction.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  order_no: string;

  @ApiProperty({
    type: Number,
    format: 'double',
    minimum: 0.01,
    example: 12.5,
    description: 'Positive CNY amount, with at most two decimal places.',
  })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({
    maxLength: 128,
    example: 'Collection quota expansion',
    description: 'Customer-visible payment subject.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  subject: string;

  @ApiPropertyOptional({
    format: 'uri',
    maxLength: 255,
    example: 'https://app.example.com/payment/return',
    description: 'Optional client return URL after payment.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  return_url?: string;

  @ApiPropertyOptional({
    format: 'uri',
    maxLength: 255,
    example: 'https://api.example.com/api/payment/notify/wechat',
    description: 'Optional provider callback URL.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  notify_url?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { business_type: 'collection_quota' },
    description: 'Optional opaque payment metadata.',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
