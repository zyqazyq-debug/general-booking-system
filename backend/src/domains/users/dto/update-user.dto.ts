import { PartialType, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

class UserProfileInputDto {
  @IsString()
  @ApiPropertyOptional({ type: String })
  username: string;

  @IsString()
  @ApiPropertyOptional({ type: String, format: 'password' })
  password: string;

  @IsString()
  @ApiPropertyOptional({ type: String })
  locale: string;

  @IsEmail()
  @ApiPropertyOptional({ type: String, format: 'email' })
  email: string;
}

export class UpdateUserDto extends PartialType(UserProfileInputDto) {}
