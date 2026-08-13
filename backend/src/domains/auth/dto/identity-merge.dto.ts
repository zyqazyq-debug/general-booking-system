import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class IdentityBindDto {
  @IsString()
  @IsIn(['phone', 'wechat', 'qq', 'telegram'])
  provider: 'phone' | 'wechat' | 'qq' | 'telegram';

  @IsString()
  identity: string;

  @IsOptional()
  @IsString()
  @Length(4, 8)
  code?: string;
}
