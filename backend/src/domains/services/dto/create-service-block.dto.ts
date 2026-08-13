import {
  IsNotEmpty,
  IsEnum,
  IsDateString,
  IsOptional,
  IsString,
} from 'class-validator';
import { ServiceBlockType } from '../entities/service-block.entity';

export class CreateServiceBlockDto {
  @IsEnum(ServiceBlockType)
  @IsNotEmpty()
  type: ServiceBlockType;

  @IsDateString()
  @IsNotEmpty()
  start_time: string;

  @IsDateString()
  @IsNotEmpty()
  end_time: string;

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
