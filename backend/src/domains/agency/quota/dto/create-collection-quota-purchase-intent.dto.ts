import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentChannel } from '../../../payment';

export class CreateCollectionQuotaPurchaseIntentDto {
  @ApiProperty({
    type: Number,
    format: 'int32',
    minimum: 1,
    example: 10,
    description: 'Number of additional collection slots to purchase.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  extra_slots: number;

  @ApiPropertyOptional({
    type: Number,
    format: 'int32',
    minimum: 1,
    default: 1,
    example: 3,
    description: 'Subscription duration in months. Defaults to one month.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  months?: number;

  @ApiPropertyOptional({
    enum: PaymentChannel,
    default: PaymentChannel.WECHAT,
    example: PaymentChannel.WECHAT,
    description: 'Payment channel. Defaults to WeChat Pay.',
  })
  @IsOptional()
  @IsEnum(PaymentChannel)
  channel?: PaymentChannel;
}
