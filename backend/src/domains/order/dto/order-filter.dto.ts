import { IsOptional, IsDateString } from 'class-validator';
import { PaginationDto } from '../../../shared/common/dto/pagination.dto';

export class OrderFilterDto extends PaginationDto {
  @IsOptional()
  @IsDateString()
  start_time?: string;

  @IsOptional()
  @IsDateString()
  end_time?: string;
}
