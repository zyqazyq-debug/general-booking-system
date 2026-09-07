import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class IdentityScanStartDto {
  @IsString()
  @IsIn(['wechat', 'qq', 'telegram'])
  @ApiProperty({ enum: ['wechat', 'qq', 'telegram'] })
  provider: 'wechat' | 'qq' | 'telegram';
}

export class IdentityScanStatusDto {
  @IsString()
  @ApiProperty({ type: String })
  ticket_id: string;
}
