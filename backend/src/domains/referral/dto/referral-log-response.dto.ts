import { ApiProperty } from '@nestjs/swagger';
import { ReferralStatus, ReferralType } from '../entities/referral-log.entity';

/**
 * Referral's transport-level view of the status for a source user.
 *
 * Keep this value set local to this response contract: Referral must not
 * depend on the Users persistence entity merely to document an HTTP field.
 */
export enum ReferralLogSourceUserStatus {
  ACTIVE = 'ACTIVE',
  MERGED = 'MERGED',
  DISABLED = 'DISABLED',
}

/** Public fields retained when a referral log includes its source user. */
export class ReferralLogSourceUserResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: String })
  username: string;

  // Keep the published enum component name stable for existing API consumers.
  @ApiProperty({ enum: ReferralLogSourceUserStatus, enumName: 'UserStatus' })
  status: ReferralLogSourceUserStatus;

  @ApiProperty({ type: Number, format: 'int32' })
  auth_version: number;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  merged_into_id: string | null;

  @ApiProperty({ type: String, nullable: true })
  locale: string | null;

  @ApiProperty({ type: [String] })
  roles: string[];

  @ApiProperty({ type: String, nullable: true })
  referral_code: string | null;

  @ApiProperty({ type: String, nullable: true })
  nickname: string | null;

  @ApiProperty({ type: String, nullable: true })
  avatar: string | null;

  @ApiProperty({ type: Boolean })
  is_verified: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at: Date;
}

/** The JSON shape returned by GET /referral/logs. */
export class ReferralLogResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, format: 'uuid' })
  sourceUserId: string;

  @ApiProperty({ type: () => ReferralLogSourceUserResponseDto })
  sourceUser: ReferralLogSourceUserResponseDto;

  @ApiProperty({ type: String, format: 'uuid' })
  beneficiaryId: string;

  @ApiProperty({ type: Number })
  amount: number;

  @ApiProperty({ type: Number })
  base_amount: number;

  @ApiProperty({ type: Number, format: 'int32' })
  level: number;

  @ApiProperty({ enum: ReferralType, enumName: 'ReferralType' })
  type: ReferralType;

  @ApiProperty({ enum: ReferralStatus, enumName: 'ReferralStatus' })
  status: ReferralStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: Date;
}

/** The standard HTTP success envelope around referral log data. */
export class ReferralLogListResponseDto {
  @ApiProperty({ type: Number, example: 0 })
  code: number;

  @ApiProperty({ type: String, example: 'OK' })
  message: string;

  @ApiProperty({ type: () => ReferralLogResponseDto, isArray: true })
  data: ReferralLogResponseDto[];
}
