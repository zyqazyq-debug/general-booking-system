import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsOptional,
  IsBoolean,
  IsObject,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceRulesDto, CancellationPolicyDto } from './service-rules.dto';

export class CreateServiceDto {
  @ApiPropertyOptional({ type: 'string' })
  @IsOptional()
  @IsString()
  resource_template_id?: string; // Renamed from service_id

  @ApiProperty({ type: 'string' })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiProperty({ type: 'number' })
  @IsNotEmpty()
  @IsNumber()
  base_price: number;

  @ApiProperty({ type: 'number' })
  @IsNotEmpty()
  @IsNumber()
  deposit_points: number;

  @ApiPropertyOptional({ type: 'number' })
  @IsOptional()
  @IsNumber()
  duration_minutes?: number;

  @ApiPropertyOptional({ type: 'number' })
  @IsOptional()
  @IsNumber()
  buffer_minutes?: number;

  @ApiPropertyOptional({ type: 'boolean' })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ type: 'string' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: 'string' })
  @IsOptional()
  @IsString()
  original_notes?: string;

  @ApiPropertyOptional({ type: () => ServiceRulesDto })
  @IsOptional()
  rules?: ServiceRulesDto;

  @ApiPropertyOptional({ type: () => CancellationPolicyDto })
  @IsOptional()
  cancellation_policy?: CancellationPolicyDto;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  location?: {
    name: string;
    address: string;
    latitude: number;
    longitude: number;
  };

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Optional service metadata. Values must be supplied as a JSON object; arbitrary keys are supported.',
  })
  // Validate undefined as an omitted optional field, but reject null, arrays, and scalars.
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  metadata?: Record<string, unknown>;
}
