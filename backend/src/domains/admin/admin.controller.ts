import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { ADMIN_ROLES, JwtAuthGuard, Roles, RolesGuard } from '../auth';
import { AdjustUserCreditDto } from './dto/adjust-user-credit.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ADMIN_ROLES)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  findAllUsers() {
    return this.adminService.findAllUsers();
  }

  @Get('services')
  findAllServices() {
    return this.adminService.findAllServices();
  }

  @Get('orders')
  findAllOrders() {
    return this.adminService.findAllOrders();
  }

  @Get('collections')
  findAllCollections() {
    return this.adminService.findAllCollections();
  }

  @Post('users/:id/credit')
  adjustCredit(@Param('id') id: string, @Body() body: AdjustUserCreditDto) {
    return this.adminService.adjustCredit(id, body.amount);
  }
}
