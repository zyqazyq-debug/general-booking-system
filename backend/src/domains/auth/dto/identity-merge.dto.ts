import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class IdentityBindDto {
  @IsString()
  @IsIn(['phone', 'wechat', 'qq', 'telegram'])
  @ApiProperty({ enum: ['phone', 'wechat', 'qq', 'telegram'] })
  provider: 'phone' | 'wechat' | 'qq' | 'telegram';

  @ValidateIf((body: IdentityBindDto) => body.provider === 'phone')
  @IsString()
  @IsNotEmpty()
  @ApiPropertyOptional({
    type: String,
    description: 'Required only when provider is phone.',
  })
  identity?: string;

  @ValidateIf((body: IdentityBindDto) => body.provider === 'phone')
  @IsString()
  @Length(4, 8)
  @ApiPropertyOptional({
    type: String,
    minLength: 4,
    maxLength: 8,
    description: 'Required only when provider is phone.',
  })
  code?: string;

  @ValidateIf((body: IdentityBindDto) => body.provider !== 'phone')
  @IsString()
  @IsNotEmpty()
  @ApiPropertyOptional({
    type: String,
    description:
      'Required only when provider is wechat, qq, or telegram; raw identity is not accepted.',
  })
  proof?: string;
}
