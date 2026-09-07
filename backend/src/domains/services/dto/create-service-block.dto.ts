import {
  IsNotEmpty,
  IsEnum,
  IsDateString,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceBlockType } from '../entities/service-block.entity';

export class CreateServiceBlockDto {
  @ApiProperty({ type: 'string', enum: ServiceBlockType })
  @IsEnum(ServiceBlockType)
  @IsNotEmpty()
  type: ServiceBlockType;

  @ApiProperty({ type: 'string', format: 'date-time' })
  @IsDateString()
  @IsNotEmpty()
  start_time: string;

  @ApiProperty({ type: 'string', format: 'date-time' })
  @IsDateString()
  @IsNotEmpty()
  end_time: string;

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
