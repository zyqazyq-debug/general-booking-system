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
import { PaymentChannel } from '../payment.types';

export class CreatePrepayDto {
  @IsEnum(PaymentChannel)
  channel: PaymentChannel;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  order_no: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  subject: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  return_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notify_url?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
