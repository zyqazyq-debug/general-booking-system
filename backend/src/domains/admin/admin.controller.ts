import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { ADMIN_ROLES, JwtAuthGuard, Roles, RolesGuard } from '../auth';
import { AdjustUserCreditDto } from './dto/adjust-user-credit.dto';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { AdminCollectionsResponseEnvelopeDto, AdminCreditAdjustmentResponseEnvelopeDto, AdminOrdersResponseEnvelopeDto, AdminServicesResponseEnvelopeDto, AdminUsersResponseEnvelopeDto } from './dto/admin-response.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ADMIN_ROLES)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  @ApiOkResponse({ type: AdminUsersResponseEnvelopeDto })
  findAllUsers() {
    return this.adminService.findAllUsers();
  }

  @Get('services')
  @ApiOkResponse({ type: AdminServicesResponseEnvelopeDto })
  findAllServices() {
    return this.adminService.findAllServices();
  }

  @Get('orders')
  @ApiOkResponse({ type: AdminOrdersResponseEnvelopeDto })
  findAllOrders() {
    return this.adminService.findAllOrders();
  }

  @Get('collections')
  @ApiOkResponse({ type: AdminCollectionsResponseEnvelopeDto })
  findAllCollections() {
    return this.adminService.findAllCollections();
  }

  @Post('users/:id/credit')
  @ApiCreatedResponse({ type: AdminCreditAdjustmentResponseEnvelopeDto })
  adjustCredit(@Param('id') id: string, @Body() body: AdjustUserCreditDto) {
    return this.adminService.adjustCredit(id, body.amount);
  }
}
