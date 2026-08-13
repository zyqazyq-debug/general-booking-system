import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ForbiddenException,
  Request,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { ADMIN_ROLES } from '../auth';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth';
import { UserRole } from './entities/user.entity';
import type { AuthenticatedRequest } from '../../shared/common/types/auth-request.type';
import { PaginationDto } from '../../shared/common/dto/pagination.dto';

type ChangePasswordBody = {
  oldPassword: string;
  newPassword: string;
};

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Only admin should add roles or self if allowed logic (but usually admin)
  // For now, restrict to Admin role or maybe just block public access
  @Roles(...ADMIN_ROLES)
  @Post(':id/role')
  addRole(@Param('id') id: string, @Body('role') role: string) {
    return this.usersService.addRole(id, role);
  }

  @Roles(...ADMIN_ROLES)
  @Get()
  findAll(@Query() paginationDto: PaginationDto) {
    return this.usersService.findAll(paginationDto);
  }

  @Get('me')
  getMe(@Request() req: AuthenticatedRequest) {
    return this.usersService.findOne(req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    // Users can see themselves, Admin can see everyone
    if (req.user.id !== id && !req.user.roles.includes(UserRole.ADMIN)) {
      throw new ForbiddenException('You can only view your own profile');
    }
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Request() req: AuthenticatedRequest,
  ) {
    if (req.user.id !== id && !req.user.roles.includes(UserRole.ADMIN)) {
      throw new ForbiddenException('You can only update your own profile');
    }
    // Prevent self-role escalation
    if (updateUserDto.roles && !req.user.roles.includes(UserRole.ADMIN)) {
      throw new ForbiddenException('Cannot update roles');
    }
    return this.usersService.update(id, updateUserDto);
  }

  @Post('change-password')
  changePassword(
    @Request() req: AuthenticatedRequest,
    @Body() body: ChangePasswordBody,
  ) {
    // Body: { oldPassword, newPassword }
    if (!body.oldPassword || !body.newPassword) {
      throw new ForbiddenException('Missing parameters');
    }
    return this.usersService.changePassword(
      req.user.id,
      body.oldPassword,
      body.newPassword,
    );
  }

  @Post('me/credit/purchase-intent')
  createCreditPurchaseIntent(
    @Request() req: AuthenticatedRequest,
    @Body('required_credit') requiredCredit?: number,
  ) {
    return this.usersService.createCreditPurchaseIntent(
      req.user.id,
      Number(requiredCredit || 0),
    );
  }

  @Roles(...ADMIN_ROLES)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
