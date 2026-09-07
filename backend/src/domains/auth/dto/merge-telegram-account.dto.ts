import { IsMobilePhone, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MergeTelegramAccountDto {
  @IsString()
  @IsMobilePhone('zh-CN')
  @ApiProperty({
    type: String,
    format: 'phone',
    description: 'Mainland China mobile phone number',
  })
  phone: string;

  @IsString()
  @Length(4, 8)
  @ApiProperty({ type: String, minLength: 4, maxLength: 8 })
  code: string;
}
