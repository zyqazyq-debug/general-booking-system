import {
  Injectable,
  OnApplicationBootstrap,
  Logger,
  Inject,
} from '@nestjs/common';
import type { InitUsersPort } from './ports/init-users.port';
import { INIT_USERS_PORT } from './ports/tokens';

@Injectable()
export class InitService implements OnApplicationBootstrap {
  private readonly logger = new Logger(InitService.name);

  constructor(
    @Inject(INIT_USERS_PORT)
    private readonly usersPort: InitUsersPort,
  ) {}

  async onApplicationBootstrap() {
    await this.seedAdminUser();
  }

  private async seedAdminUser() {
    try {
      const defaultUsername = process.env.ADMIN_USERNAME || 'admin';
      const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123';

      const admin = await this.usersPort.findForAuth(defaultUsername);

      if (!admin) {
        this.logger.log(`Seeding default admin user: ${defaultUsername}`);
        await this.usersPort.createAdminUser(defaultUsername, defaultPassword);
        this.logger.log(`Default admin created.`);
        return;
      }

      if (!admin.roles.includes('ADMIN')) {
        await this.usersPort.addRole(admin.id, 'ADMIN');
        this.logger.log(`Added ADMIN role to ${defaultUsername} user`);
      }
    } catch (error) {
      this.logger.error('Failed to seed admin user', error);
    }
  }
}
