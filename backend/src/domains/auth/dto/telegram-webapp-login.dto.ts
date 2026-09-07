import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TelegramWebAppLoginDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    type: String,
    description: 'Signed initData payload supplied by Telegram Web Apps.',
  })
  initData: string;
}
