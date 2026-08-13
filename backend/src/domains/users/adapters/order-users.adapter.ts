import { Injectable } from '@nestjs/common';
import { UsersService } from '../users.service';
import type {
  OrderUsersPort,
  OrderUserContactDto,
  OrderUserSnapshot,
} from '../../order';
import type { EntityManager } from 'typeorm';

@Injectable()
export class OrderUsersAdapter implements OrderUsersPort {
  constructor(private readonly usersService: UsersService) {}

  async findUserById(userId: string): Promise<OrderUserSnapshot | null> {
    return this.usersService.findOne(userId);
  }

  async findContactById(userId: string): Promise<OrderUserContactDto | null> {
    const user = await this.usersService.findOne(userId);
    if (!user) return null;
    return {
      id: user.id,
      username: user.username ?? '',
      nickname: user.nickname ?? '',
      telegram_chat_id: user.telegram_chat_id ?? '',
      credit_balance: Number(user.credit_balance ?? 0),
    };
  }

  async freezeCredit(
    userId: string,
    amount: number,
    manager: EntityManager,
  ): Promise<void> {
    await this.usersService.freezeCredit(userId, amount, manager);
  }

  async unfreezeCredit(
    userId: string,
    amount: number,
    manager: EntityManager,
  ): Promise<void> {
    await this.usersService.unfreezeCredit(userId, amount, manager);
  }

  async burnCredit(
    userId: string,
    amount: number,
    manager: EntityManager,
  ): Promise<void> {
    await this.usersService.burnCredit(userId, amount, manager);
  }

  async transferFrozenCredit(
    fromUserId: string,
    toUserId: string,
    amount: number,
    manager: EntityManager,
  ): Promise<void> {
    await this.usersService.transferFrozenCredit(
      fromUserId,
      toUserId,
      amount,
      manager,
    );
  }
}
