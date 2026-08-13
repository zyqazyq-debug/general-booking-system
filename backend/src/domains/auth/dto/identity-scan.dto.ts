import { IsIn, IsString } from 'class-validator';

export class IdentityScanStartDto {
  @IsString()
  @IsIn(['wechat', 'qq', 'telegram'])
  provider: 'wechat' | 'qq' | 'telegram';
}

export class IdentityScanStatusDto {
  @IsString()
  ticket_id: string;
}
