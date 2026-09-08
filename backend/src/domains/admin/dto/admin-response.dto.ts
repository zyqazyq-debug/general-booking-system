import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class AdminPageMetaResponseDto {
  @ApiProperty({ type: Number }) total: number;
  @ApiProperty({ type: Number }) page: number;
  @ApiProperty({ type: Number }) limit: number;
  @ApiProperty({ type: Number }) totalPages: number;
}
class AdminUserResponseDto {
  @ApiProperty({ type: String }) id: string;
  @ApiPropertyOptional({ type: String, nullable: true }) username?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) nickname?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) telegram_chat_id?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) credit_balance?: number | null;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) created_at?: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) updated_at?: Date;
}
class AdminServiceResponseDto {
  @ApiProperty({ type: String }) id: string;
  @ApiProperty({ type: String }) owner_id: string;
  @ApiProperty({ type: String, nullable: true }) title: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
  @ApiProperty({ type: Number }) duration_minutes: number;
  @ApiProperty({ type: Number, nullable: true }) base_price: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) provider_base_price?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) cost_price?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) deposit_points?: number | null;
  @ApiPropertyOptional({ type: Boolean }) is_active?: boolean;
}
class AdminUserSummaryResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ type: String }) username: string;
  @ApiProperty({ type: String, nullable: true }) nickname: string | null;
}
class AdminOrderServiceSummaryResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ type: String }) title: string;
}
class AdminOrderAgencyNodeSummaryResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ type: String }) share_slug: string;
  @ApiProperty({ type: () => AdminUserSummaryResponseDto, nullable: true }) agent: AdminUserSummaryResponseDto | null;
}
class AdminOrderResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ type: String }) order_no: string;
  @ApiProperty({ type: String, format: 'uuid' }) consumer_id: string;
  @ApiProperty({ type: String, format: 'uuid' }) owner_id: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) service_id: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) agency_node_id: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) start_time: Date;
  @ApiProperty({ type: String, format: 'date-time' }) end_time: Date;
  @ApiProperty({ type: String }) status: string;
  @ApiProperty({ type: Number }) frozen_points: number;
  @ApiProperty({ type: Number }) display_price_snapshot: number;
  @ApiProperty({ type: String, format: 'date-time' }) created_at: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updated_at: Date;
  @ApiProperty({ type: () => AdminOrderServiceSummaryResponseDto, nullable: true }) service: AdminOrderServiceSummaryResponseDto | null;
  @ApiProperty({ type: () => AdminUserSummaryResponseDto, nullable: true }) consumer: AdminUserSummaryResponseDto | null;
  @ApiProperty({ type: () => AdminOrderAgencyNodeSummaryResponseDto, nullable: true }) agency_node: AdminOrderAgencyNodeSummaryResponseDto | null;
}
class AdminAgencyUserSummaryResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ type: String, nullable: true }) nickname: string | null;
}
class AdminAgencyServiceSummaryResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ type: String }) title: string;
  @ApiProperty({ type: Boolean }) is_active: boolean;
}
class AdminCollectionResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['STANDARD', 'CONTRACT'] }) node_type: 'STANDARD' | 'CONTRACT';
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) parent_node_id: string | null;
  @ApiProperty({ type: String, format: 'uuid' }) service_id: string;
  @ApiProperty({ type: String, format: 'uuid' }) agent_id: string;
  @ApiProperty({ type: Number }) markup_amount: number;
  @ApiProperty({ type: Number }) cache_cost_price: number;
  @ApiProperty({ type: Number }) cache_total_price: number;
  @ApiProperty({ type: String }) markup_type: string;
  @ApiProperty({ type: Number }) markup_value: number;
  @ApiProperty({ type: String, nullable: true }) alias: string | null;
  @ApiProperty({ type: String, nullable: true }) inherited_name: string | null;
  @ApiProperty({ type: String }) share_slug: string;
  @ApiProperty({ type: String }) status: string;
  @ApiProperty({ type: String, format: 'date-time' }) created_at: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updated_at: Date;
  @ApiProperty({ type: () => AdminAgencyUserSummaryResponseDto, nullable: true }) agent: AdminAgencyUserSummaryResponseDto | null;
  @ApiProperty({ type: () => AdminAgencyServiceSummaryResponseDto, nullable: true }) service: AdminAgencyServiceSummaryResponseDto | null;
}
class AdminUsersPageResponseDto {
  @ApiProperty({ type: () => AdminUserResponseDto, isArray: true }) data: AdminUserResponseDto[];
  @ApiProperty({ type: () => AdminPageMetaResponseDto }) meta: AdminPageMetaResponseDto;
}
class AdminServicesPageResponseDto {
  @ApiProperty({ type: () => AdminServiceResponseDto, isArray: true }) data: AdminServiceResponseDto[];
  @ApiProperty({ type: () => AdminPageMetaResponseDto }) meta: AdminPageMetaResponseDto;
}
export class AdminUsersResponseEnvelopeDto {
  @ApiProperty({ type: Number, example: 0 }) code: number;
  @ApiProperty({ type: String, example: 'OK' }) message: string;
  @ApiProperty({ type: () => AdminUsersPageResponseDto }) data: AdminUsersPageResponseDto;
}
export class AdminServicesResponseEnvelopeDto {
  @ApiProperty({ type: Number, example: 0 }) code: number;
  @ApiProperty({ type: String, example: 'OK' }) message: string;
  @ApiProperty({ type: () => AdminServicesPageResponseDto }) data: AdminServicesPageResponseDto;
}
export class AdminOrdersResponseEnvelopeDto {
  @ApiProperty({ type: Number, example: 0 }) code: number;
  @ApiProperty({ type: String, example: 'OK' }) message: string;
  @ApiProperty({ type: () => AdminOrderResponseDto, isArray: true }) data: AdminOrderResponseDto[];
}
export class AdminCollectionsResponseEnvelopeDto {
  @ApiProperty({ type: Number, example: 0 }) code: number;
  @ApiProperty({ type: String, example: 'OK' }) message: string;
  @ApiProperty({ type: () => AdminCollectionResponseDto, isArray: true }) data: AdminCollectionResponseDto[];
}
export class AdminCreditAdjustmentResponseEnvelopeDto {
  @ApiProperty({ type: Number, example: 0 }) code: number;
  @ApiProperty({ type: String, example: 'OK' }) message: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) data: Record<string, unknown>;
}
