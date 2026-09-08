import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  Max,
  Min,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The browser-only diagnostics endpoint is intentionally public.  Keep its
 * envelope explicit so the published contract describes the fields emitted by
 * the client, while refusing undeclared payload keys at the global validation
 * boundary.
 */
export class ClientDebugLogDto {
  @ApiProperty({ type: 'string', minLength: 1 })
  @IsString()
  @IsNotEmpty()
  event: string;

  @ApiPropertyOptional({ type: 'string' })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({ type: 'boolean' })
  @IsOptional()
  @IsBoolean()
  hasToken?: boolean;

  @ApiPropertyOptional({ type: 'boolean' })
  @IsOptional()
  @IsBoolean()
  isWaiting?: boolean;

  @ApiPropertyOptional({ type: 'string' })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional({ type: 'string' })
  @IsOptional()
  @IsString()
  stack?: string;

  @ApiPropertyOptional({ type: 'string' })
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lineno?: number;

  @ApiPropertyOptional({ type: 'integer', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  colno?: number;

  @ApiPropertyOptional({ type: 'number', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  total_reads?: number;

  @ApiPropertyOptional({ type: 'number', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  new_field_reads?: number;

  @ApiPropertyOptional({ type: 'number', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  legacy_field_reads?: number;

  @ApiPropertyOptional({ type: 'number', minimum: 0, maximum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  legacy_ratio?: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: {
      type: 'object',
      required: ['newFieldRead', 'legacyFieldRead'],
      properties: {
        newFieldRead: { type: 'number', minimum: 0 },
        legacyFieldRead: { type: 'number', minimum: 0 },
      },
    },
  })
  @IsOptional()
  @IsObject()
  by_scene?: Record<string, { newFieldRead: number; legacyFieldRead: number }>;

  @ApiPropertyOptional({ type: 'string' })
  @IsOptional()
  @IsString()
  scene?: string;

  @ApiPropertyOptional({ type: 'boolean' })
  @IsOptional()
  @IsBoolean()
  hasBotDeepLink?: boolean;

  @ApiPropertyOptional({ type: 'number', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shareLinkLength?: number;

  @ApiPropertyOptional({ type: 'string' })
  @IsOptional()
  @IsString()
  runtimeHost?: string;

  @ApiPropertyOptional({ type: 'string' })
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional({ type: 'boolean' })
  @IsOptional()
  @IsBoolean()
  fallbackToWebApp?: boolean;

  @ApiPropertyOptional({ type: 'boolean' })
  @IsOptional()
  @IsBoolean()
  fallbackToWindowOpen?: boolean;
}

/**
 * The diagnostics endpoint acknowledges accepted client telemetry with this
 * exact envelope. Keep this separate from the request DTO so Swagger records
 * the 201 body the controller actually emits.
 */
export class ClientDebugLogResponseDto {
  @ApiProperty({ type: 'boolean', example: true })
  success: boolean;
}
