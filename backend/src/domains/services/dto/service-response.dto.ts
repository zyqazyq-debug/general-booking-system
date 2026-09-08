import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceBlockType } from '../entities/service-block.entity';
import { ServiceRulesDto } from './service-rules.dto';

export class ServiceLocationResponseDto {
  @ApiProperty({ type: 'string' }) name: string;
  @ApiProperty({ type: 'string' }) address: string;
  @ApiProperty({ type: 'number' }) latitude: number;
  @ApiProperty({ type: 'number' }) longitude: number;
}

export class ServiceCancellationPolicyResponseDto {
  @ApiProperty({ enum: ['flexible', 'moderate', 'strict', 'custom'] }) type: 'flexible' | 'moderate' | 'strict' | 'custom';
  @ApiProperty({ type: 'number' }) window_minutes: number;
  @ApiProperty({ type: 'number' }) penalty_percent: number;
}

export class ServiceOwnerResponseDto {
  @ApiProperty({ type: 'string' }) id: string;
  @ApiProperty({ type: 'string' }) username: string;
  @ApiProperty({ type: 'string' }) status: string;
  @ApiProperty({ type: 'number' }) auth_version: number;
  @ApiProperty({ type: 'string', nullable: true }) merged_into_id: string | null;
  @ApiProperty({ type: 'string', nullable: true }) locale: string | null;
  @ApiProperty({ type: 'string', isArray: true }) roles: string[];
  @ApiProperty({ type: 'string', nullable: true }) referral_code: string | null;
  @ApiProperty({ type: 'string', nullable: true }) nickname: string | null;
  @ApiProperty({ type: 'string', nullable: true }) avatar: string | null;
  @ApiProperty({ type: 'boolean' }) is_verified: boolean;
  @ApiProperty({ type: 'string', format: 'date-time' }) created_at: string;
  @ApiProperty({ type: 'string', format: 'date-time' }) updated_at: string;
}

export class ServiceResponseDto {
  @ApiProperty({ type: 'string' }) id: string;
  @ApiProperty({ type: 'string' }) owner_id: string;
  @ApiProperty({ type: 'string', nullable: true }) resource_template_id: string | null;
  @ApiPropertyOptional({ type: () => ServiceOwnerResponseDto }) owner?: ServiceOwnerResponseDto;
  @ApiProperty({ type: 'string' }) title: string;
  @ApiProperty({ type: 'number' }) base_price: number;
  @ApiProperty({ type: 'number' }) deposit_points: number;
  @ApiProperty({ type: 'number' }) duration_minutes: number;
  @ApiProperty({ type: 'number' }) buffer_minutes: number;
  @ApiProperty({ type: 'boolean' }) is_active: boolean;
  @ApiProperty({ type: 'boolean' }) is_deleted: boolean;
  @ApiProperty({ type: 'string', nullable: true }) description: string | null;
  @ApiProperty({ type: 'string', nullable: true }) original_notes: string | null;
  @ApiProperty({ type: () => ServiceRulesDto, nullable: true }) rules: ServiceRulesDto | null;
  @ApiProperty({ type: () => ServiceCancellationPolicyResponseDto, nullable: true }) cancellation_policy: ServiceCancellationPolicyResponseDto | null;
  @ApiProperty({ type: 'number', isArray: true, nullable: true }) index_weekdays: number[] | null;
  @ApiProperty({ type: 'number', nullable: true }) index_start_hour: number | null;
  @ApiProperty({ type: 'number', nullable: true }) index_end_hour: number | null;
  @ApiProperty({ type: () => ServiceLocationResponseDto, nullable: true }) location: ServiceLocationResponseDto | null;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) metadata: Record<string, unknown> | null;
  @ApiProperty({ type: 'string', format: 'date-time' }) created_at: string;
  @ApiProperty({ type: 'string', format: 'date-time' }) updated_at: string;
}

export class MyServiceResponseDto {
  @ApiProperty({ type: 'string' }) id: string;
  @ApiProperty({ type: 'string' }) title: string;
  @ApiProperty({ type: 'number' }) base_price: number;
  @ApiProperty({ type: 'number' }) deposit_points: number;
  @ApiProperty({ type: 'number' }) duration_minutes: number;
  @ApiProperty({ type: 'boolean' }) is_active: boolean;
  @ApiProperty({ type: 'string', format: 'date-time' }) created_at: string;
  @ApiProperty({ type: 'string', nullable: true }) description: string | null;
  @ApiProperty({ type: 'string' }) share_slug: string;
}

export class PaginationMetaResponseDto {
  @ApiProperty({ type: 'number' }) total: number;
  @ApiProperty({ type: 'number' }) page: number;
  @ApiProperty({ type: 'number' }) limit: number;
  @ApiProperty({ type: 'number' }) totalPages: number;
}

export class MyServicesPageResponseDto {
  @ApiProperty({ type: () => MyServiceResponseDto, isArray: true }) data: MyServiceResponseDto[];
  @ApiProperty({ type: () => PaginationMetaResponseDto }) meta: PaginationMetaResponseDto;
}

export class ServiceShareResponseDto {
  @ApiProperty({ type: 'string' }) share_slug: string;
  @ApiProperty({ type: 'string' }) agency_node_id: string;
}

export class TimeSlotResponseDto {
  @ApiProperty({ type: 'string', format: 'date-time' }) start_time: string;
  @ApiProperty({ type: 'string', format: 'date-time' }) end_time: string;
  @ApiProperty({ enum: ['available', 'booked'] }) status: 'available' | 'booked';
}

export class DeactivateCheckResponseDto {
  @ApiProperty({ type: 'boolean' }) allow: boolean;
  @ApiProperty({ type: 'string' }) message: string;
  @ApiProperty({ type: 'number' }) pending_orders: number;
}

export class ServiceBlockResponseDto {
  @ApiProperty({ type: 'string' }) id: string;
  @ApiProperty({ type: 'string' }) service_id: string;
  @ApiProperty({ enum: ServiceBlockType, enumName: 'ServiceBlockType' }) type: ServiceBlockType;
  @ApiProperty({ type: 'string', format: 'date-time' }) start_time: string;
  @ApiProperty({ type: 'string', format: 'date-time' }) end_time: string;
  @ApiProperty({ type: 'string', nullable: true }) reason: string | null;
  @ApiProperty({ type: 'string', nullable: true }) description: string | null;
  @ApiProperty({ type: 'string', nullable: true }) notes: string | null;
  @ApiProperty({ type: 'string', format: 'date-time' }) created_at: string;
}

export class GlobalServiceBlockResponseDto {
  @ApiProperty({ type: 'string' }) id: string;
  @ApiProperty({ enum: ServiceBlockType, enumName: 'ServiceBlockType' }) type: ServiceBlockType;
  @ApiProperty({ type: 'string', format: 'date-time' }) start_time: string;
  @ApiProperty({ type: 'string', format: 'date-time' }) end_time: string;
  @ApiProperty({ type: 'string', nullable: true }) reason: string | null;
  @ApiProperty({ type: 'string', nullable: true }) description: string | null;
  @ApiProperty({ type: 'string', nullable: true }) notes: string | null;
  @ApiProperty({ type: 'number' }) block_count: number;
  @ApiProperty({ type: 'number' }) service_count: number;
  @ApiProperty({ type: 'number' }) total_service_count: number;
  @ApiProperty({ type: 'boolean' }) is_global: boolean;
}

export class UpdatedCountResponseDto { @ApiProperty({ type: 'number' }) updated_count: number; }
export class DeletedCountResponseDto { @ApiProperty({ type: 'number' }) deleted_count: number; }
