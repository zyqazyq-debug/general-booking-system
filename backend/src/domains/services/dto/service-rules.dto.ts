import { IsNumber, IsOptional, IsArray } from 'class-validator';

export class ServiceRulesDto {
  [key: string]: unknown;

  @IsNumber()
  start_hour: number;

  @IsNumber()
  end_hour: number;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  weekdays?: number[];
}

export class CancellationPolicyDto {
  @IsNumber()
  penalty_percent: number;

  @IsNumber()
  window_minutes: number;
}
