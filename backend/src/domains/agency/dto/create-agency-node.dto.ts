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

export class CreateAgencyNodeDto {
  @IsOptional()
  @IsString()
  serviceId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  listingId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Matches(/^\d+$/, { each: true })
  listingIds?: string[];

  @IsOptional()
  @IsString()
  parentNodeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  markup_amount?: number;

  @IsOptional()
  @IsString()
  markup_type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  markup_value?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  alias?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  private_notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  public_notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  compliance_content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  compliance_signature?: string;

  @IsOptional()
  @IsObject()
  deviceInfo?: Record<string, unknown>;
}
