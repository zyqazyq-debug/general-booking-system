import {
  IsNotEmpty,
  IsString,
  IsDateString,
  IsOptional,
} from 'class-validator';
import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';

export class CreateOrderDto {
  // Set from the authenticated request in OrderController; never client-owned.
  @ApiHideProperty()
  @IsOptional()
  @IsString()
  consumer_id?: string;

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
