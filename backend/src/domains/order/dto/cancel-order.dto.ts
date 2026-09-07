import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Public POST /order/:id/cancel request payload. */
export class CancelOrderDto {
  @ApiPropertyOptional({
    type: String,
    description: 'Optional reason supplied by the consumer or provider.',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
