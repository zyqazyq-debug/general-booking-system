import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { CreateOrderDto } from './create-order.dto';
import { OrderStatus } from '../entities/order.entity';

// Omit sensitive fields that should not be updated via DTO
// consumer_id: Prevents scalpers from transferring orders
// service_id: Prevents changing the service after booking
// start_time/end_time: Usually requires specific rescheduling logic, not direct update
export class UpdateOrderDto extends PartialType(
  OmitType(CreateOrderDto, [
    'consumer_id',
    'service_id',
    'start_time',
    'end_time',
  ] as const),
) {
  @ApiPropertyOptional({ enum: OrderStatus })
  status?: OrderStatus;
}
