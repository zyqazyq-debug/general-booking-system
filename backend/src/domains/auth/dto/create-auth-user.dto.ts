import { IsNotEmpty, IsString, IsOptional, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAuthUserDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({ type: String })
  username: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({ type: String, format: 'password' })
  password: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ type: String })
  locale?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ type: String })
  referral_code?: string;

  @IsOptional()
  @IsEmail()
  @ApiPropertyOptional({ type: String, format: 'email' })
  email?: string;
}
