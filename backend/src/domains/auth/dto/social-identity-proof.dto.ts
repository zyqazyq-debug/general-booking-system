import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SocialIdentityProofDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ type: String })
  proof: string;

  @IsOptional()
  @IsObject()
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  deviceInfo?: Record<string, unknown>;
}
