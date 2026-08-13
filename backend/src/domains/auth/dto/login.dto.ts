import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @IsNotEmpty()
  @IsString()
  username: string;

  @IsNotEmpty()
  @IsString()
  password: string;

  @IsOptional()
  @IsObject()
  deviceInfo?: Record<string, unknown>;
}
