import { Injectable } from '@nestjs/common';
import { UsersService } from '../users.service';
import type {
  InitUsersPort,
  InitUserForAuthDto,
} from '../../../shared/init/ports/init-users.port';

@Injectable()
export class InitUsersAdapter implements InitUsersPort {
  constructor(private readonly usersService: UsersService) {}

  async findForAuth(
    usernameOrPhone: string,
  ): Promise<InitUserForAuthDto | null> {
    const user = await this.usersService.findForAuth(usernameOrPhone);
    if (!user) return null;
    return { id: user.id, roles: user.roles };
  }

  async createAdminUser(username: string, password: string): Promise<void> {
    await this.usersService.create({
      username,
      password,
      roles: ['ADMIN', 'USER'],
    });
  }

  async addRole(userId: string, role: string): Promise<void> {
    await this.usersService.addRole(userId, role);
  }
}
