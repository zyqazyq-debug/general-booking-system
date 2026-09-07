import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { ServiceRulesDto, CancellationPolicyDto } from './service-rules.dto';

export class CreateServiceDto {
  @ApiHideProperty()
  @IsOptional()
  @IsString()
  owner_id: string;

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
    description: 'Arbitrary JSON metadata; this DTO does not impose a runtime shape.',
    nullable: true,
    oneOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'array', items: {} },
      { type: 'object', additionalProperties: true },
    ],
  })
  @IsOptional()
  metadata?: any;
}
