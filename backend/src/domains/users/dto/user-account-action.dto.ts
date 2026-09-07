import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddUserRoleDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ type: String })
  role: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ type: String, format: 'password' })
  oldPassword: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ type: String, format: 'password' })
  newPassword: string;
}

export class CreateCreditPurchaseIntentDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({ type: Number, format: 'int32', minimum: 0 })
  required_credit?: number;
}
