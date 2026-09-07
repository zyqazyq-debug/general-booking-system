import type { ServiceBlockType } from '../entities/service-block.entity';

export interface AvailabilityRulesResponseDto {
  weekdays: number[];
  start_hour?: number;
  end_hour?: number;
  duration_minutes: number;
  buffer_minutes: number;
}

export interface AvailabilityWindowDto {
  start: string;
  end: string;
}

export interface PublicAvailabilityResponseDto {
  rules: AvailabilityRulesResponseDto;
  busy_slots: AvailabilityWindowDto[];
  blocks: AvailabilityWindowDto[];
}

export interface ManagementAvailabilityBlockDto {
  id: string;
  start: Date | string;
  end: Date | string;
  type: ServiceBlockType;
  reason: string | null;
  description: string | null;
  notes: string | null;
}

export interface ManagementAvailabilityResponseDto {
  rules: AvailabilityRulesResponseDto;
  busy_slots: Array<{
    start: Date | string;
    end: Date | string;
  }>;
  blocks: ManagementAvailabilityBlockDto[];
}
