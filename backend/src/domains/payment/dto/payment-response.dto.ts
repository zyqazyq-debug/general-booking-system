import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentChannel, PaymentTransactionStatus } from '../payment.types';

export class PaymentChannelAvailabilityResponseDto {
  @ApiProperty({ enum: PaymentChannel, example: PaymentChannel.WECHAT }) channel: PaymentChannel;
  @ApiProperty({ example: '微信支付' }) label: string;
  @ApiProperty({ enum: ['active', 'unavailable'], example: 'active' }) status: 'active' | 'unavailable';
}
export class CreatePrepayResponseDto {
  @ApiProperty({ format: 'uuid' }) transaction_id: string;
  @ApiProperty({ maxLength: 64 }) order_no: string;
  @ApiProperty({ type: Number, format: 'int32', minimum: 1 }) amount_minor: number;
  @ApiProperty({ enum: ['CNY'], example: 'CNY' }) currency: 'CNY';
  @ApiProperty({ type: 'boolean', oneOf: [{ type: 'boolean', enum: [true] }], example: true }) success: true;
  @ApiPropertyOptional() prepay_id?: string;
  @ApiPropertyOptional() payment_url?: string;
  @ApiPropertyOptional() qr_code?: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) metadata?: Record<string, unknown>;
  @ApiPropertyOptional() error_message?: string;
}
export class PaymentStatusResponseDto {
  @ApiProperty({ maxLength: 64 }) order_no: string;
  @ApiProperty({ enum: PaymentTransactionStatus }) status: PaymentTransactionStatus;
  @ApiPropertyOptional() trade_no?: string;
  @ApiPropertyOptional({ format: 'uuid' }) payment_event_id?: string;
}
export class PaymentChannelAvailabilityResponseEnvelopeDto {
  @ApiProperty({ enum: [0], example: 0 }) code: 0;
  @ApiProperty({ enum: ['OK'], example: 'OK' }) message: 'OK';
  @ApiProperty({ type: () => PaymentChannelAvailabilityResponseDto, isArray: true }) data: PaymentChannelAvailabilityResponseDto[];
}
export class CreatePrepayResponseEnvelopeDto {
  @ApiProperty({ enum: [0], example: 0 }) code: 0;
  @ApiProperty({ enum: ['OK'], example: 'OK' }) message: 'OK';
  @ApiProperty({ type: () => CreatePrepayResponseDto }) data: CreatePrepayResponseDto;
}
export class PaymentStatusResponseEnvelopeDto {
  @ApiProperty({ enum: [0], example: 0 }) code: 0;
  @ApiProperty({ enum: ['OK'], example: 'OK' }) message: 'OK';
  @ApiProperty({ type: () => PaymentStatusResponseDto }) data: PaymentStatusResponseDto;
}
