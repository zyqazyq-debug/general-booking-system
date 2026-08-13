import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsArray,
  IsEmail,
} from 'class-validator';

export class CreateUserDto {
  @IsNotEmpty()
  @IsString()
  username: string;

  @IsNotEmpty()
  @IsString()
  password: string;

  @IsOptional()
  @IsArray()
  roles?: string[];

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsString()
  referrer_id?: string;

  @IsOptional()
  @IsString()
  referral_code?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
