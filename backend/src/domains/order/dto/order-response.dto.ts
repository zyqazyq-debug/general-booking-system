import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '../entities/order.entity';

class OrderServiceSnapshotResponseDto {
  @ApiPropertyOptional({ type: String }) title?: string;
  @ApiPropertyOptional({ type: String }) description?: string;
  @ApiProperty({ type: Number }) duration_minutes: number;
  @ApiProperty({ type: Number }) base_price: number;
  @ApiPropertyOptional({ type: Number }) provider_base_price?: number;
  @ApiPropertyOptional({ type: Number }) cost_price?: number;
  @ApiPropertyOptional({ type: Number }) sale_price?: number;
  @ApiPropertyOptional({ type: String }) owner_name?: string;
}

class OrderMetadataResponseDto {
  @ApiPropertyOptional({ type: String }) completed_by?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) completed_at?: string;
  @ApiPropertyOptional({ enum: ['PROVIDER', 'SYSTEM'] }) completed_role?: 'PROVIDER' | 'SYSTEM';
  @ApiPropertyOptional({ type: Boolean }) auto_completed?: boolean;
  @ApiPropertyOptional({ type: String }) forfeited_by?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) forfeited_at?: string;
  @ApiPropertyOptional({ type: Number }) forfeit_grace_minutes?: number;
  @ApiPropertyOptional({ type: String }) cancelled_by?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) cancelled_at?: string;
  @ApiPropertyOptional({ type: String }) cancellation_reason?: string;
  @ApiPropertyOptional({ enum: ['CONSUMER', 'PROVIDER'] }) cancelled_role?: 'CONSUMER' | 'PROVIDER';
  @ApiPropertyOptional({ type: Number }) penalty_amount?: number;
  @ApiPropertyOptional({ type: Number }) refund_amount?: number;
}

export class OrderResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ type: String }) order_no: string;
  @ApiProperty({ type: String, format: 'uuid' }) consumer_id: string;
  @ApiProperty({ type: String, format: 'uuid' }) owner_id: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) service_id: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) agency_node_id: string | null;
  @ApiPropertyOptional({ type: () => OrderServiceSnapshotResponseDto, nullable: true }) service_snapshot: OrderServiceSnapshotResponseDto | null;
  @ApiProperty({ type: String, format: 'date-time' }) start_time: string;
  @ApiProperty({ type: String, format: 'date-time' }) end_time: string;
  @ApiProperty({ enum: OrderStatus }) status: OrderStatus;
  @ApiProperty({ type: Number }) frozen_points: number;
  @ApiProperty({ type: Number }) display_price_snapshot: number;
  @ApiPropertyOptional({ type: () => OrderMetadataResponseDto, nullable: true }) metadata: OrderMetadataResponseDto | null;
  @ApiProperty({ type: String, format: 'date-time' }) created_at: string;
  @ApiProperty({ type: String, format: 'date-time' }) updated_at: string;
}

class OrderCommissionResponseDto {
  @ApiProperty({ type: Number }) cost_price: number;
  @ApiProperty({ type: Number }) markup_amount: number;
  @ApiProperty({ type: Number }) final_price: number;
  @ApiProperty({ type: Number }) level: number;
  @ApiPropertyOptional({ type: String, nullable: true }) child_agent_id: string | null;
}
class OrderCommissionByRoleResponseDto {
  @ApiPropertyOptional({ type: () => OrderCommissionResponseDto }) PROVIDER?: OrderCommissionResponseDto;
  @ApiPropertyOptional({ type: () => OrderCommissionResponseDto }) AGENT?: OrderCommissionResponseDto;
}
export class OrderWithRolesResponseDto extends OrderResponseDto {
  @ApiProperty({ enum: ['CONSUMER', 'PROVIDER', 'AGENT'], isArray: true }) roles: Array<'CONSUMER' | 'PROVIDER' | 'AGENT'>;
  @ApiProperty({ type: () => OrderCommissionByRoleResponseDto }) commission: OrderCommissionByRoleResponseDto;
}
class OrderPageMetaResponseDto {
  @ApiProperty({ type: Number }) total: number;
  @ApiProperty({ type: Number }) page: number;
  @ApiProperty({ type: Number }) limit: number;
  @ApiProperty({ type: Number }) totalPages: number;
}
export class MyOrdersResponseDto {
  @ApiProperty({ type: () => OrderWithRolesResponseDto, isArray: true }) data: OrderWithRolesResponseDto[];
  @ApiProperty({ type: () => OrderPageMetaResponseDto }) meta: OrderPageMetaResponseDto;
}
export class ManagedOrdersResponseDto {
  @ApiProperty({ type: () => OrderResponseDto, isArray: true }) data: OrderResponseDto[];
  @ApiProperty({ type: () => OrderPageMetaResponseDto }) meta: OrderPageMetaResponseDto;
}
export class CreditSummaryResponseDto {
  @ApiProperty({ type: Number }) available_credit: number;
  @ApiProperty({ type: Number }) frozen_total: number;
  @ApiProperty({ type: Number }) active_reserved_orders: number;
  @ApiProperty({ type: Number }) credit_total: number;
  @ApiProperty({ type: String }) purchase_endpoint: string;
}
export class CreditCheckResponseDto {
  @ApiProperty({ type: Boolean }) can_book: boolean;
  @ApiProperty({ type: Number }) required_credit: number;
  @ApiProperty({ type: Number }) available_credit: number;
  @ApiProperty({ type: Number }) shortfall: number;
  @ApiProperty({ type: String }) purchase_endpoint: string;
}
class OrderContextPartyResponseDto {
  @ApiProperty({ type: String }) id: string;
  @ApiProperty({ type: String }) nickname: string;
  @ApiProperty({ enum: ['CONSUMER', 'PROVIDER', 'AGENT'] }) role: 'CONSUMER' | 'PROVIDER' | 'AGENT';
}
class OrderContextCommissionResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ type: String, format: 'uuid' }) order_id: string;
  @ApiProperty({ type: String, format: 'uuid' }) agent_id: string;
  @ApiProperty({ enum: ['PROVIDER', 'AGENT'] }) role: 'PROVIDER' | 'AGENT';
  @ApiProperty({ type: Number }) cost_price: number;
  @ApiProperty({ type: Number }) markup_amount: number;
  @ApiPropertyOptional({ type: String, nullable: true }) snapshot_markup_type: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) snapshot_markup_value: number | null;
  @ApiProperty({ type: Number }) final_price: number;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) child_agent_id: string | null;
  @ApiProperty({ type: Number }) level: number;
  @ApiProperty({ type: String, format: 'date-time' }) created_at: string;
}
class OrderContextInfoResponseDto {
  @ApiPropertyOptional({ type: () => OrderContextPartyResponseDto, nullable: true }) upstream: OrderContextPartyResponseDto | null;
  @ApiPropertyOptional({ type: () => OrderContextPartyResponseDto, nullable: true }) downstream: OrderContextPartyResponseDto | null;
  @ApiPropertyOptional({ type: () => OrderContextCommissionResponseDto, nullable: true }) commission: OrderContextCommissionResponseDto | null;
}
export class OrderContextResponseDto extends OrderResponseDto {
  @ApiPropertyOptional({ enum: ['CONSUMER', 'PROVIDER', 'AGENT'], nullable: true }) context_role: 'CONSUMER' | 'PROVIDER' | 'AGENT' | null;
  @ApiProperty({ type: () => OrderContextInfoResponseDto }) context_info: OrderContextInfoResponseDto;
}

class SuccessEnvelopeDto<T> { code: number; message: string; data: T; }
export class OrderCreatedResponseEnvelopeDto extends SuccessEnvelopeDto<OrderResponseDto> {
  @ApiProperty({ type: Number, example: 0 }) declare code: number;
  @ApiProperty({ type: String, example: 'OK' }) declare message: string;
  @ApiProperty({ type: () => OrderResponseDto }) declare data: OrderResponseDto;
}
export class MyOrdersResponseEnvelopeDto extends SuccessEnvelopeDto<MyOrdersResponseDto> {
  @ApiProperty({ type: Number, example: 0 }) declare code: number;
  @ApiProperty({ type: String, example: 'OK' }) declare message: string;
  @ApiProperty({ type: () => MyOrdersResponseDto }) declare data: MyOrdersResponseDto;
}
export class ManagedOrdersResponseEnvelopeDto extends SuccessEnvelopeDto<ManagedOrdersResponseDto> {
  @ApiProperty({ type: Number, example: 0 }) declare code: number;
  @ApiProperty({ type: String, example: 'OK' }) declare message: string;
  @ApiProperty({ type: () => ManagedOrdersResponseDto }) declare data: ManagedOrdersResponseDto;
}
export class CreditSummaryResponseEnvelopeDto extends SuccessEnvelopeDto<CreditSummaryResponseDto> {
  @ApiProperty({ type: Number, example: 0 }) declare code: number;
  @ApiProperty({ type: String, example: 'OK' }) declare message: string;
  @ApiProperty({ type: () => CreditSummaryResponseDto }) declare data: CreditSummaryResponseDto;
}
export class CreditCheckResponseEnvelopeDto extends SuccessEnvelopeDto<CreditCheckResponseDto> {
  @ApiProperty({ type: Number, example: 0 }) declare code: number;
  @ApiProperty({ type: String, example: 'OK' }) declare message: string;
  @ApiProperty({ type: () => CreditCheckResponseDto }) declare data: CreditCheckResponseDto;
}
export class OrderContextResponseEnvelopeDto extends SuccessEnvelopeDto<OrderContextResponseDto> {
  @ApiProperty({ type: Number, example: 0 }) declare code: number;
  @ApiProperty({ type: String, example: 'OK' }) declare message: string;
  @ApiProperty({ type: () => OrderContextResponseDto }) declare data: OrderContextResponseDto;
}
