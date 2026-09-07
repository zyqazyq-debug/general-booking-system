import { IsOptional, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../shared/common/dto/pagination.dto';

export class OrderFilterDto extends PaginationDto {
  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    default: 1,
    description: 'One-based page number.',
  })
  page?: number = 1;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: 500,
    default: 10,
    description: 'Maximum number of orders to return.',
  })
  limit?: number = 10;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description:
      'Optional inclusive order start-time filter in ISO 8601 format.',
  })
  @IsOptional()
  @IsDateString()
  start_time?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Optional inclusive order end-time filter in ISO 8601 format.',
  })
  @IsOptional()
  @IsDateString()
  end_time?: string;
}
