import { Injectable } from '@nestjs/common';
import { OrderService } from '../order.service';
import type { AdminOrderPort } from '../../admin';

@Injectable()
export class AdminOrderAdapter implements AdminOrderPort {
  constructor(private readonly orderService: OrderService) {}

  findAllForAdmin(): Promise<unknown> {
    return this.orderService.findAllForAdmin();
  }
}
