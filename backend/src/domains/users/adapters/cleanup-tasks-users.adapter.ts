import { Injectable } from '@nestjs/common';
import { UsersService } from '../users.service';
import type { CleanupTasksUsersPort } from '../../../platforms/tasks/ports/cleanup-tasks-users.port';

@Injectable()
export class CleanupTasksUsersAdapter implements CleanupTasksUsersPort {
  constructor(private readonly usersService: UsersService) {}

  cleanupAllExpiredTokens(): Promise<number> {
    return this.usersService.cleanupAllExpiredTokens();
  }
}
