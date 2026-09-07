import { Type } from 'class-transformer';
import { IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Public administrative credit adjustment request. Negative amounts are valid. */
export class AdjustUserCreditDto {
  @ApiProperty({ type: 'number', format: 'double' })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  amount: number;
}
