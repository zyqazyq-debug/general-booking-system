import { IsNumber, IsOptional, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ServiceRulesDto {
  [key: string]: unknown;

  @ApiProperty({ type: 'number' })
  @IsNumber()
  start_hour: number;

  @ApiProperty({ type: 'number' })
  @IsNumber()
  end_hour: number;

  @ApiPropertyOptional({ type: 'number', isArray: true })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  weekdays?: number[];
}

export class CancellationPolicyDto {
  @ApiProperty({ type: 'number' })
  @IsNumber()
  penalty_percent: number;

  @ApiProperty({ type: 'number' })
  @IsNumber()
  window_minutes: number;
}
