import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Order } from '../entities/order.entity';
import type { AuthOrderPort } from '../../auth';

@Injectable()
export class AuthOrderAdapter implements AuthOrderPort {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
  ) {}

  async transferOrders(
    sourceUserId: string,
    targetUserId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(Order) : this.orderRepository;

    await repo
      .createQueryBuilder()
      .update(Order)
      .set({ consumer_id: targetUserId })
      .where('consumer_id = :sourceId', { sourceId: sourceUserId })
      .execute();

    await repo
      .createQueryBuilder()
      .update(Order)
      .set({ owner_id: targetUserId })
      .where('owner_id = :sourceId', { sourceId: sourceUserId })
      .execute();
  }
}
