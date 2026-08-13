import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../entities/order.entity';

@Injectable()
export class OrderAdminQueryService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
  ) {}

  findAllForAdmin() {
    return this.orderRepository.find({
      relations: ['service', 'consumer', 'agency_node', 'agency_node.agent'],
      order: { created_at: 'DESC' },
    });
  }
}
