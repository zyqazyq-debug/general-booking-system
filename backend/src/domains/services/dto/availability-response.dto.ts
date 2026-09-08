import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceBlockType } from '../entities/service-block.entity';

export class AvailabilityRulesResponseDto {
  @ApiProperty({ type: 'number', isArray: true })
  weekdays: number[];
  @ApiPropertyOptional({ type: 'number' })
  start_hour?: number;
  @ApiPropertyOptional({ type: 'number' })
  end_hour?: number;
  @ApiProperty({ type: 'number' })
  duration_minutes: number;
  @ApiProperty({ type: 'number' })
  buffer_minutes: number;
}

export class AvailabilityWindowDto {
  @ApiProperty({ type: 'string', format: 'date-time' })
  start: string;
  @ApiProperty({ type: 'string', format: 'date-time' })
  end: string;
}

export class PublicAvailabilityResponseDto {
  @ApiProperty({ type: () => AvailabilityRulesResponseDto })
  rules: AvailabilityRulesResponseDto;
  @ApiProperty({ type: () => AvailabilityWindowDto, isArray: true })
  busy_slots: AvailabilityWindowDto[];
  @ApiProperty({ type: () => AvailabilityWindowDto, isArray: true })
  blocks: AvailabilityWindowDto[];
}

export class ManagementAvailabilityWindowDto {
  @ApiProperty({ type: 'string', format: 'date-time' })
  start: Date | string;
  @ApiProperty({ type: 'string', format: 'date-time' })
  end: Date | string;
}

export class ManagementAvailabilityBlockDto {
  @ApiProperty({ type: 'string' })
  id: string;
  @ApiProperty({ type: 'string', format: 'date-time' })
  start: Date | string;
  @ApiProperty({ type: 'string', format: 'date-time' })
  end: Date | string;
  @ApiProperty({ enum: ServiceBlockType, enumName: 'ServiceBlockType' })
  type: ServiceBlockType;
  @ApiProperty({ type: 'string', nullable: true })
  reason: string | null;
  @ApiProperty({ type: 'string', nullable: true })
  description: string | null;
  @ApiProperty({ type: 'string', nullable: true })
  notes: string | null;
}

export class ManagementAvailabilityResponseDto {
  @ApiProperty({ type: () => AvailabilityRulesResponseDto })
  rules: AvailabilityRulesResponseDto;
  @ApiProperty({ type: () => ManagementAvailabilityWindowDto, isArray: true })
  busy_slots: ManagementAvailabilityWindowDto[];
  @ApiProperty({ type: () => ManagementAvailabilityBlockDto, isArray: true })
  blocks: ManagementAvailabilityBlockDto[];
}
