import { Injectable } from '@nestjs/common';
import { UsersService } from '../users.service';
import type {
  NotificationUsersPort,
  NotificationUserContactDto,
} from '../../notification';

@Injectable()
export class NotificationUsersAdapter implements NotificationUsersPort {
  constructor(private readonly usersService: UsersService) {}

  async findContactById(
    userId: string,
  ): Promise<NotificationUserContactDto | null> {
    const user = await this.usersService.findOne(userId);
    if (!user) return null;
    return {
      id: user.id,
      telegram_chat_id: user.telegram_chat_id ?? undefined,
    };
  }
}
