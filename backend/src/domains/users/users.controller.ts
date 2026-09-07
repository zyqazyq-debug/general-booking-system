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
import {
  AddUserRoleDto,
  ChangePasswordDto,
  CreateCreditPurchaseIntentDto,
} from './dto/user-account-action.dto';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Only admin should add roles or self if allowed logic (but usually admin)
  // For now, restrict to Admin role or maybe just block public access
  @Roles(...ADMIN_ROLES)
  @Post(':id/role')
  addRole(@Param('id') id: string, @Body() body: AddUserRoleDto) {
    return this.usersService.addRole(id, body.role);
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
    return this.usersService.update(id, updateUserDto);
  }

  @Post('change-password')
  changePassword(
    @Request() req: AuthenticatedRequest,
    @Body() body: ChangePasswordDto,
  ) {
    return this.usersService.changePassword(
      req.user.id,
      body.oldPassword,
      body.newPassword,
    );
  }

  @Post('me/credit/purchase-intent')
  createCreditPurchaseIntent(
    @Request() req: AuthenticatedRequest,
    @Body() body: CreateCreditPurchaseIntentDto,
  ) {
    return this.usersService.createCreditPurchaseIntent(
      req.user.id,
      body.required_credit,
    );
  }

  @Roles(...ADMIN_ROLES)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
