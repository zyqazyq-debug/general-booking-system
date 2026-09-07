import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEmail,
} from 'class-validator';

export class CreateAuthUserDto {
  @IsNotEmpty()
  @IsString()
  username: string;

  @IsNotEmpty()
  @IsString()
  password: string;

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsString()
  referral_code?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
