import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({ type: String })
  username: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({ type: String, format: 'password' })
  password: string;

  @IsOptional()
  @IsObject()
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  deviceInfo?: Record<string, unknown>;
}
