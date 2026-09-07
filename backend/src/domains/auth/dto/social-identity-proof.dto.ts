import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class SocialIdentityProofDto {
  @IsString()
  @IsNotEmpty()
  proof: string;

  @IsOptional()
  @IsObject()
  deviceInfo?: Record<string, unknown>;
}
