import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceBlockType } from '../entities/service-block.entity';

export class UpdateServiceBlockDto {
  @ApiPropertyOptional({ type: 'string', enum: ServiceBlockType })
  @IsEnum(ServiceBlockType)
  @IsOptional()
  type?: ServiceBlockType;

  @ApiPropertyOptional({ type: 'string', format: 'date-time' })
  @IsDateString()
  @IsOptional()
  start_time?: string;

  @ApiPropertyOptional({ type: 'string', format: 'date-time' })
  @IsDateString()
  @IsOptional()
  end_time?: string;

  @ApiPropertyOptional({ type: 'string' })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional({ type: 'string' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ type: 'string' })
  @IsString()
  @IsOptional()
  notes?: string;
}
