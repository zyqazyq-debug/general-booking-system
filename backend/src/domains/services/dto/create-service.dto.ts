import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { ServiceRulesDto, CancellationPolicyDto } from './service-rules.dto';

export class CreateServiceDto {
  @IsOptional()
  @IsString()
  owner_id: string;

  @IsOptional()
  @IsString()
  resource_template_id?: string; // Renamed from service_id

  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsNumber()
  base_price: number;

  @IsNotEmpty()
  @IsNumber()
  deposit_points: number;

  @IsOptional()
  @IsNumber()
  duration_minutes?: number;

  @IsOptional()
  @IsNumber()
  buffer_minutes?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  original_notes?: string;

  @IsOptional()
  rules?: ServiceRulesDto;

  @IsOptional()
  cancellation_policy?: CancellationPolicyDto;

  @IsOptional()
  location?: {
    name: string;
    address: string;
    latitude: number;
    longitude: number;
  };

  @IsOptional()
  metadata?: any;
}
