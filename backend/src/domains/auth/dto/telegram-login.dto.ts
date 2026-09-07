import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TelegramLoginDto {
  @Type(() => Number)
  @IsNumber()
  @IsInt()
  @ApiProperty({ type: Number, format: 'int64' })
  id: number;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ type: String })
  first_name: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ type: String })
  last_name?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ type: String })
  username?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ type: String })
  photo_url?: string;

  @Type(() => Number)
  @IsNumber()
  @IsInt()
  @ApiProperty({
    type: Number,
    format: 'int64',
    description: 'Unix timestamp supplied by Telegram.',
  })
  auth_date: number;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ type: String, description: 'Telegram login signature.' })
  hash: string;

  @IsOptional()
  @IsObject()
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  deviceInfo?: Record<string, unknown>;
}
