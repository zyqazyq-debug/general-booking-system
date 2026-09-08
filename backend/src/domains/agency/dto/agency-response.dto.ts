import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';

class AgencyEnvelopeDto {
  @ApiProperty({ example: 0 })
  code: number;

  @ApiProperty({ example: 'OK' })
  message: string;
}

export class AgencyUserResponseDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  nickname?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  avatar?: string | null;
}

export class AgencyServiceOwnerResponseDto extends AgencyUserResponseDto {}

export class AgencyServiceSnapshotResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: Number })
  base_price: number;

  @ApiPropertyOptional({ type: Number })
  provider_base_price?: number;

  @ApiPropertyOptional({ type: Number })
  cost_price?: number;

  @ApiPropertyOptional({ type: Number })
  sale_price?: number;

  @ApiProperty()
  is_active: boolean;

  @ApiProperty()
  duration_minutes: number;

  @ApiPropertyOptional({ type: Number })
  deposit_points?: number;

  @ApiPropertyOptional({ type: Number })
  buffer_minutes?: number;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  rules?: Record<string, unknown>;

  @ApiPropertyOptional()
  original_notes?: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional({ type: () => AgencyServiceOwnerResponseDto })
  owner?: AgencyServiceOwnerResponseDto;
}

export class AgencyParentNodeResponseDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  alias?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  inherited_name?: string | null;

  @ApiProperty()
  status: string;
}

/**
 * The entity shape emitted by collection creation and mutation services. Relations
 * are optional because each service query loads only the relations it needs.
 */
export class AgencyNodeResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  node_type: string;

  @ApiProperty({ type: String, nullable: true })
  parent_node_id: string | null;

  @ApiProperty()
  service_id: string;

  @ApiProperty()
  agent_id: string;

  @ApiProperty({ type: Number })
  markup_amount: number;

  @ApiProperty({ type: Number })
  cache_cost_price: number;

  @ApiProperty({ type: Number })
  cache_total_price: number;

  @ApiProperty()
  markup_type: string;

  @ApiProperty({ type: Number })
  markup_value: number;

  @ApiProperty({ type: String, nullable: true })
  alias: string | null;

  @ApiProperty({ type: String, nullable: true })
  inherited_name: string | null;

  @ApiProperty({ type: String, nullable: true })
  private_notes: string | null;

  @ApiProperty({ type: String, nullable: true })
  public_notes: string | null;

  @ApiProperty({ type: String, nullable: true })
  compliance_content: string | null;

  @ApiProperty({ type: String, nullable: true })
  compliance_signature: string | null;

  @ApiProperty()
  share_slug: string;

  @ApiProperty()
  status: string;

  @ApiProperty({ format: 'date-time' })
  created_at: Date;

  @ApiProperty({ format: 'date-time' })
  updated_at: Date;

  @ApiPropertyOptional({ type: () => AgencyServiceSnapshotResponseDto })
  service?: AgencyServiceSnapshotResponseDto;

  @ApiPropertyOptional({ type: () => AgencyUserResponseDto })
  agent?: AgencyUserResponseDto;

  @ApiPropertyOptional({ type: () => AgencyParentNodeResponseDto })
  parent_node?: AgencyParentNodeResponseDto;
}

export class AgencyNodeViewServiceResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  duration_minutes: number;

  @ApiPropertyOptional({ type: Number })
  deposit_points?: number;

  @ApiPropertyOptional({ type: Number })
  buffer_minutes?: number;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  rules?: Record<string, unknown>;

  @ApiProperty({ type: Number })
  base_price: number;

  @ApiProperty()
  description: string;

  @ApiProperty()
  is_active: boolean;
}

export class AgencyNodeViewAgentResponseDto extends AgencyUserResponseDto {}

export class AgencyNodeViewResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  status: string;

  @ApiProperty({ type: String, nullable: true })
  alias: string | null;

  @ApiProperty({ type: String, nullable: true })
  inherited_name: string | null;

  @ApiProperty({ type: String, nullable: true })
  parent_node_id: string | null;

  @ApiProperty()
  service_id: string;

  @ApiProperty()
  share_slug: string;

  @ApiProperty({ format: 'date-time' })
  created_at: Date;

  @ApiProperty({ format: 'date-time' })
  updated_at: Date;

  @ApiProperty({ type: () => AgencyNodeViewServiceResponseDto })
  service: AgencyNodeViewServiceResponseDto;

  @ApiProperty({ type: () => AgencyNodeViewAgentResponseDto })
  agent: AgencyNodeViewAgentResponseDto;

  @ApiProperty()
  is_unavailable: boolean;
}

export class PublicAgencyNodeViewResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: String, nullable: true })
  alias: string | null;

  @ApiProperty({ type: String, nullable: true })
  inherited_name: string | null;

  @ApiProperty({ type: String, nullable: true })
  parent_node_id: string | null;

  @ApiProperty()
  service_id: string;

  @ApiProperty()
  share_slug: string;

  @ApiProperty({ type: () => AgencyNodeViewServiceResponseDto })
  service: AgencyNodeViewServiceResponseDto;

  @ApiProperty({ type: () => AgencyNodeViewAgentResponseDto })
  agent: AgencyNodeViewAgentResponseDto;

  @ApiProperty()
  is_unavailable: boolean;

  @ApiProperty()
  node_status: string;

  @ApiProperty({
    type: 'object',
    required: ['parentNodeId', 'serviceId'],
    properties: {
      parentNodeId: { type: 'string' },
      serviceId: { type: 'string' },
    },
  })
  importInfo: { parentNodeId: string; serviceId: string };
}

export class PreCheckImportDataDto {
  @ApiProperty({
    enum: ['DEPTH_BLOCKED', 'SAME_PARENT', 'SELF_IN_UPSTREAM', 'NORMAL'],
  })
  action_type: string;

  @ApiPropertyOptional()
  prompt_msg?: string;

  @ApiPropertyOptional()
  parent_id?: string;

  @ApiPropertyOptional()
  service_id?: string;
}

export class AgencyCreationDataDto {
  @ApiProperty({ type: () => AgencyNodeResponseDto })
  node: AgencyNodeResponseDto;

  @ApiProperty()
  isNew: boolean;
}

export class RemoveCollectionDataDto {
  @ApiProperty({ example: true })
  success: boolean;
}

export class LightweightRegistrationUserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  username: string;

  @ApiProperty()
  referral_code: string;

  @ApiProperty({ type: String, nullable: true })
  email: string | null;

  @ApiProperty({ type: [String] })
  roles: string[];

  @ApiProperty({ type: Number })
  wallet_balance: number;

  @ApiProperty({ type: Number })
  credit_balance: number;

  @ApiProperty({ type: Number })
  frozen_credit: number;
}

export class LightweightRegistrationResponseDto {
  @ApiProperty()
  access_token: string;

  @ApiProperty()
  refresh_token: string;

  @ApiProperty({ type: () => LightweightRegistrationUserResponseDto })
  user: LightweightRegistrationUserResponseDto;
}

export class BatchImportResultResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  success: boolean;

  @ApiPropertyOptional({ type: () => AgencyNodeResponseDto })
  data?: AgencyNodeResponseDto;

  @ApiPropertyOptional()
  error?: string;
}

export class AuthenticatedCollectionResponseDataDto {
  @ApiProperty({ type: () => LightweightRegistrationResponseDto })
  auth: LightweightRegistrationResponseDto;

  @ApiProperty({ type: () => AgencyNodeResponseDto })
  collection: AgencyNodeResponseDto;
}

export class AuthenticatedBatchImportResponseDataDto {
  @ApiProperty({ type: () => LightweightRegistrationResponseDto })
  auth: LightweightRegistrationResponseDto;

  @ApiProperty({ type: () => [BatchImportResultResponseDto] })
  results: BatchImportResultResponseDto[];
}

export class AgencyOnboardingEnvelopeDto extends AgencyEnvelopeDto {
  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(AgencyNodeResponseDto) },
      {
        type: 'array',
        items: { $ref: getSchemaPath(BatchImportResultResponseDto) },
      },
      { $ref: getSchemaPath(AuthenticatedCollectionResponseDataDto) },
      { $ref: getSchemaPath(AuthenticatedBatchImportResponseDataDto) },
    ],
  })
  data: unknown;
}

export class AgencyCollectionEnvelopeDto extends AgencyEnvelopeDto {
  @ApiProperty({ type: () => [AgencyNodeResponseDto] })
  data: AgencyNodeResponseDto[];
}

export class CollectionAvailabilityEnvelopeDto extends AgencyEnvelopeDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  data: Record<string, string>;
}

export class AgencyNodeViewEnvelopeDto extends AgencyEnvelopeDto {
  @ApiProperty({ type: () => AgencyNodeViewResponseDto })
  data: AgencyNodeViewResponseDto;
}

export class PreCheckImportEnvelopeDto extends AgencyEnvelopeDto {
  @ApiProperty({ type: () => PreCheckImportDataDto })
  data: PreCheckImportDataDto;
}

export class AgencyCreationEnvelopeDto extends AgencyEnvelopeDto {
  @ApiProperty({ type: () => AgencyCreationDataDto })
  data: AgencyCreationDataDto;
}

export class RemoveCollectionEnvelopeDto extends AgencyEnvelopeDto {
  @ApiProperty({ type: () => RemoveCollectionDataDto })
  data: RemoveCollectionDataDto;
}

export class AgencyNodeEnvelopeDto extends AgencyEnvelopeDto {
  @ApiProperty({ type: () => AgencyNodeResponseDto, nullable: true })
  data: AgencyNodeResponseDto | null;
}

export class PublicAgencyNodeViewEnvelopeDto extends AgencyEnvelopeDto {
  @ApiProperty({ type: () => PublicAgencyNodeViewResponseDto })
  data: PublicAgencyNodeViewResponseDto;
}

export class CollectionQuotaDataDto {
  @ApiProperty({ type: Number })
  base_limit: number;

  @ApiProperty({ type: Number })
  extra_slots: number;

  @ApiProperty({ type: Number })
  active_limit: number;

  @ApiProperty({ type: Number })
  active_count: number;

  @ApiProperty({ type: Number })
  remaining_slots: number;

  @ApiProperty({ type: Number })
  unit_price_monthly: number;

  @ApiProperty()
  purchase_endpoint: string;
}

export class CollectionQuotaEnvelopeDto extends AgencyEnvelopeDto {
  @ApiProperty({ type: () => CollectionQuotaDataDto })
  data: CollectionQuotaDataDto;
}

export class CollectionQuotaPaymentPayloadDto {
  @ApiProperty()
  channel: string;

  @ApiProperty()
  order_no: string;

  @ApiProperty({ type: Number })
  amount: number;

  @ApiProperty()
  subject: string;

  @ApiProperty({
    type: 'object',
    required: ['business_type', 'user_id', 'extra_slots', 'months'],
    properties: {
      business_type: { type: 'string', enum: ['collection_quota'] },
      user_id: { type: 'string' },
      extra_slots: { type: 'number' },
      months: { type: 'number' },
    },
  })
  metadata: {
    business_type: 'collection_quota';
    user_id: string;
    extra_slots: number;
    months: number;
  };
}

export class CollectionQuotaPurchaseIntentDataDto {
  @ApiProperty({ enum: ['PENDING_INTEGRATION'] })
  status: string;

  @ApiProperty()
  order_no: string;

  @ApiProperty()
  user_id: string;

  @ApiProperty({ type: Number })
  extra_slots: number;

  @ApiProperty({ type: Number })
  months: number;

  @ApiProperty({ type: Number })
  unit_price_monthly: number;

  @ApiProperty({ type: Number })
  amount: number;

  @ApiProperty()
  subject: string;

  @ApiProperty()
  channel: string;

  @ApiProperty()
  purchase_endpoint: string;

  @ApiProperty({ type: () => CollectionQuotaPaymentPayloadDto })
  payment_payload: CollectionQuotaPaymentPayloadDto;

  @ApiProperty()
  message: string;
}

export class CollectionQuotaPurchaseIntentEnvelopeDto extends AgencyEnvelopeDto {
  @ApiProperty({ type: () => CollectionQuotaPurchaseIntentDataDto })
  data: CollectionQuotaPurchaseIntentDataDto;
}
