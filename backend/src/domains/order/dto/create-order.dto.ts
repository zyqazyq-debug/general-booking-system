import {
  IsNotEmpty,
  IsString,
  IsDateString,
  IsOptional,
} from 'class-validator';

export class CreateOrderDto {
  @IsOptional()
  @IsString()
  consumer_id?: string;

  @IsNotEmpty()
  @IsString()
  service_id: string; // Renamed from schedule_id

  @IsOptional()
  @IsString()
  agency_node_id?: string;

  @IsNotEmpty()
  @IsDateString()
  start_time: string;

  @IsNotEmpty()
  @IsDateString()
  end_time: string;
}
