import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { PaymentChannel } from '../../../payment';

export class CreateCollectionQuotaPurchaseIntentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  extra_slots: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  months?: number;

  @IsOptional()
  @IsEnum(PaymentChannel)
  channel?: PaymentChannel;
}
