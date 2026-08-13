import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { ServiceBlockType } from '../entities/service-block.entity';

export class UpdateServiceBlockDto {
  @IsEnum(ServiceBlockType)
  @IsOptional()
  type?: ServiceBlockType;

  @IsDateString()
  @IsOptional()
  start_time?: string;

  @IsDateString()
  @IsOptional()
  end_time?: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
