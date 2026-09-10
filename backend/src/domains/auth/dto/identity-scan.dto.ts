import { IsIn, IsString, Matches } from 'class-validator';
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

export class TelegramLoginTicketStatusDto {
  @IsString()
  @Matches(/^lt_[0-9a-f]{32}$/)
  @ApiProperty({ type: String, pattern: '^lt_[0-9a-f]{32}$' })
  ticket_id: string;
}
