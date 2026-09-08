import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from '../entities/user.entity';

export class UserResponseDataDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ type: String }) username: string;
  @ApiProperty({ enum: UserStatus, enumName: 'UserStatus' }) status: UserStatus;
  @ApiProperty({ type: Number, format: 'int32' }) auth_version: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) merged_into_id: string | null;
  @ApiProperty({ type: String, nullable: true }) locale: string | null;
  @ApiProperty({ type: [String] }) roles: string[];
  @ApiProperty({ type: String, nullable: true }) referral_code: string | null;
  @ApiProperty({ type: String, nullable: true }) nickname: string | null;
  @ApiProperty({ type: String, nullable: true }) avatar: string | null;
  @ApiProperty({ type: Boolean }) is_verified: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) created_at: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updated_at: Date;
}

export class UserResponseDto {
  @ApiProperty({ type: Number, enum: [0], example: 0 }) code: 0;
  @ApiProperty({ type: String, enum: ['OK'], example: 'OK' }) message: 'OK';
  @ApiProperty({ type: UserResponseDataDto, nullable: true }) data: UserResponseDataDto | null;
}

export class UserListMetaDto {
  @ApiProperty({ type: Number, format: 'int32', minimum: 0 }) total: number;
  @ApiProperty({ type: Number, format: 'int32', minimum: 1 }) page: number;
  @ApiProperty({ type: Number, format: 'int32', minimum: 1 }) limit: number;
  @ApiProperty({ type: Number, format: 'int32', minimum: 0 }) totalPages: number;
}

export class UserListResponseDataDto {
  @ApiProperty({ type: [UserResponseDataDto] }) data: UserResponseDataDto[];
  @ApiProperty({ type: UserListMetaDto }) meta: UserListMetaDto;
}

export class UserListResponseDto {
  @ApiProperty({ type: Number, enum: [0], example: 0 }) code: 0;
  @ApiProperty({ type: String, enum: ['OK'], example: 'OK' }) message: 'OK';
  @ApiProperty({ type: UserListResponseDataDto }) data: UserListResponseDataDto;
}

export class UserDeleteResponseDataDto {
  @ApiProperty({ type: Number, format: 'int32', nullable: true }) affected: number | null;
}

export class UserDeleteResponseDto {
  @ApiProperty({ type: Number, enum: [0], example: 0 }) code: 0;
  @ApiProperty({ type: String, enum: ['OK'], example: 'OK' }) message: 'OK';
  @ApiProperty({ type: UserDeleteResponseDataDto }) data: UserDeleteResponseDataDto;
}

export class UserPasswordChangeResponseDataDto {
  @ApiProperty({ type: Boolean, enum: [true], example: true }) success: true;
}

export class UserPasswordChangeResponseDto {
  @ApiProperty({ type: Number, enum: [0], example: 0 }) code: 0;
  @ApiProperty({ type: String, enum: ['OK'], example: 'OK' }) message: 'OK';
  @ApiProperty({ type: UserPasswordChangeResponseDataDto }) data: UserPasswordChangeResponseDataDto;
}

export class CreditPurchaseIntentResponseDataDto {
  @ApiProperty({ type: String, enum: ['PENDING_INTEGRATION'] }) status: string;
  @ApiProperty({ type: String, format: 'uuid' }) user_id: string;
  @ApiProperty({ type: Number, format: 'int32', minimum: 0 }) required_credit: number;
  @ApiProperty({ type: [Number], format: 'int32' }) suggested_packages: number[];
  @ApiProperty({ type: String, format: 'uri', nullable: true }) purchase_url: string | null;
  @ApiProperty({ type: String, enum: ['Credit purchase API placeholder'] }) message: string;
}

export class CreditPurchaseIntentResponseDto {
  @ApiProperty({ type: Number, enum: [0], example: 0 }) code: 0;
  @ApiProperty({ type: String, enum: ['OK'], example: 'OK' }) message: 'OK';
  @ApiProperty({ type: CreditPurchaseIntentResponseDataDto }) data: CreditPurchaseIntentResponseDataDto;
}
