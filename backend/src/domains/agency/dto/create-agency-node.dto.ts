import {
  IsOptional,
  IsString,
  IsArray,
  Matches,
  IsNumber,
  IsObject,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAgencyNodeDto {
  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ type: String })
  serviceId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  @ApiPropertyOptional({ type: String, pattern: '^\\d+$' })
  listingId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Matches(/^\d+$/, { each: true })
  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'string', pattern: '^\\d+$' },
  })
  listingIds?: string[];

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ type: String })
  parentNodeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ApiPropertyOptional({ type: Number, minimum: 0 })
  markup_amount?: number;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ type: String })
  markup_type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ApiPropertyOptional({ type: Number, minimum: 0 })
  markup_value?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @ApiPropertyOptional({ type: String, maxLength: 200 })
  alias?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @ApiPropertyOptional({ type: String, maxLength: 2000 })
  private_notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @ApiPropertyOptional({ type: String, maxLength: 2000 })
  public_notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  @ApiPropertyOptional({ type: String, maxLength: 20000 })
  compliance_content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  @ApiPropertyOptional({ type: String, maxLength: 4096 })
  compliance_signature?: string;

  @IsOptional()
  @IsObject()
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  deviceInfo?: Record<string, unknown>;
}
