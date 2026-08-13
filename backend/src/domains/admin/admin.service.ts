import { Injectable, Inject } from '@nestjs/common';
import type { AdminUsersPort } from './ports/admin-users.port';
import type { AdminServicesPort } from './ports/admin-services.port';
import type { AdminOrderPort } from './ports/admin-order.port';
import type { AdminAgencyPort } from './ports/admin-agency.port';
import {
  ADMIN_USERS_PORT,
  ADMIN_SERVICES_PORT,
  ADMIN_ORDER_PORT,
  ADMIN_AGENCY_PORT,
} from './ports/tokens';

@Injectable()
export class AdminService {
  constructor(
    @Inject(ADMIN_USERS_PORT)
    private readonly usersPort: AdminUsersPort,
    @Inject(ADMIN_SERVICES_PORT)
    private readonly servicesPort: AdminServicesPort,
    @Inject(ADMIN_ORDER_PORT)
    private readonly orderPort: AdminOrderPort,
    @Inject(ADMIN_AGENCY_PORT)
    private readonly agencyPort: AdminAgencyPort,
  ) {}

  findAllUsers() {
    return this.usersPort.findAll();
  }

  findAllServices() {
    return this.servicesPort.findAll();
  }

  findAllOrders() {
    return this.orderPort.findAllForAdmin();
  }

  findAllCollections() {
    return this.agencyPort.findAll();
  }

  async adjustCredit(userId: string, amount: number) {
    return this.usersPort.addCredit(userId, amount);
  }
}
