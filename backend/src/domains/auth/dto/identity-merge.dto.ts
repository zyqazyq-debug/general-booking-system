import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';

export class IdentityBindDto {
  @IsString()
  @IsIn(['phone', 'wechat', 'qq', 'telegram'])
  provider: 'phone' | 'wechat' | 'qq' | 'telegram';

  @ValidateIf((body: IdentityBindDto) => body.provider === 'phone')
  @IsString()
  @IsNotEmpty()
  identity?: string;

  @ValidateIf((body: IdentityBindDto) => body.provider === 'phone')
  @IsString()
  @Length(4, 8)
  code?: string;

  @ValidateIf((body: IdentityBindDto) => body.provider !== 'phone')
  @IsString()
  @IsNotEmpty()
  proof?: string;
}
