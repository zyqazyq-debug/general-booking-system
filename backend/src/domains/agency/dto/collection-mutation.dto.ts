import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const parseBooleanLiteral = ({ value }: { value: unknown }) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

export class SetCollectionStatusDto {
  @Transform(parseBooleanLiteral)
  @IsBoolean()
  @ApiProperty({ type: Boolean })
  is_active: boolean;
}

export class ReparentCollectionDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ type: String })
  newParentNodeId: string;
}

export class UpdateCollectionDto {
  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ type: String })
  markup_type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @ApiPropertyOptional({ type: Number })
  markup_value?: number;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ type: String })
  private_notes?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ type: String })
  public_notes?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ type: String })
  alias?: string;
}

export class ExecuteImportDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ type: String, description: 'Import code or token.' })
  token: string;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({ type: Boolean })
  force?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({ type: Boolean })
  import_as_child?: boolean;
}
