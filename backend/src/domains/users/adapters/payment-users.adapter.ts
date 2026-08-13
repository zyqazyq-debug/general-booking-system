import { Injectable } from '@nestjs/common';
import { UsersService } from '../users.service';
import type { PaymentUsersPort } from '../../payment';

@Injectable()
export class PaymentUsersAdapter implements PaymentUsersPort {
  constructor(private readonly usersService: UsersService) {}

  async addCredit(userId: string, amount: number): Promise<void> {
    await this.usersService.addCredit(userId, amount);
  }
}
