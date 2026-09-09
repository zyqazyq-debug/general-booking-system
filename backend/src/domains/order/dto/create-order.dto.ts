import {
  IsNotEmpty,
  IsString,
  IsDateString,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Public POST /order request payload. */
export class CreateOrderDto {
  @ApiProperty({
    type: String,
    description: 'Service to book.',
  })
  @IsNotEmpty()
  @IsString()
  service_id: string; // Renamed from schedule_id

  @ApiPropertyOptional({
    type: String,
    description: 'Optional agency node used to attribute the booking source.',
  })
  @IsOptional()
  @IsString()
  agency_node_id?: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Appointment start time in ISO 8601 date-time format.',
  })
  @IsNotEmpty()
  @IsDateString()
  start_time: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Appointment end time in ISO 8601 date-time format.',
  })
  @IsNotEmpty()
  @IsDateString()
  end_time: string;
}

/** Internal command; the controller derives consumer_id from authentication. */
export type CreateOrderCommand = {
  consumer_id: string;
  service_id: string;
  agency_node_id?: string;
  /**
   * Stable key supplied by a trusted source adapter. It is deliberately not
   * part of CreateOrderDto, so public HTTP callers cannot choose another
   * platform's replay identity.
   */
  source_idempotency_key?: string;
  start_time: string;
  end_time: string;
};
