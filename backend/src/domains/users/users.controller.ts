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
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { ADMIN_ROLES } from '../auth';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth';
import { User, UserRole } from './entities/user.entity';
import type { AuthenticatedRequest } from '../../shared/common/types/auth-request.type';
import { PaginationDto } from '../../shared/common/dto/pagination.dto';
import {
  AddUserRoleDto,
  ChangePasswordDto,
  CreateCreditPurchaseIntentDto,
} from './dto/user-account-action.dto';
import { UserRoleAssignmentResponseDto } from './dto/user-role-assignment-response.dto';
import {
  CreditPurchaseIntentResponseDataDto,
  CreditPurchaseIntentResponseDto,
  UserDeleteResponseDataDto,
  UserDeleteResponseDto,
  UserListResponseDataDto,
  UserListResponseDto,
  UserPasswordChangeResponseDataDto,
  UserPasswordChangeResponseDto,
  UserResponseDataDto,
  UserResponseDto,
} from './dto/user-response.dto';

function toUserResponseData(user: User): UserResponseDataDto;
function toUserResponseData(user: null): null;
function toUserResponseData(user: User | null): UserResponseDataDto | null;
function toUserResponseData(user: User | null): UserResponseDataDto | null {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    status: user.status,
    auth_version: user.auth_version,
    merged_into_id: user.merged_into_id,
    locale: user.locale,
    roles: user.roles,
    referral_code: user.referral_code,
    nickname: user.nickname,
    avatar: user.avatar,
    is_verified: user.is_verified,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Only admin should add roles or self if allowed logic (but usually admin)
  // For now, restrict to Admin role or maybe just block public access
  @Roles(...ADMIN_ROLES)
  @Post(':id/role')
  @ApiCreatedResponse({ type: UserRoleAssignmentResponseDto })
  async addRole(
    @Param('id') id: string,
    @Body() body: AddUserRoleDto,
  ): Promise<UserResponseDataDto> {
    return toUserResponseData(await this.usersService.addRole(id, body.role));
  }

  @Roles(...ADMIN_ROLES)
  @Get()
  @ApiOkResponse({ type: UserListResponseDto })
  async findAll(
    @Query() paginationDto: PaginationDto,
  ): Promise<UserListResponseDataDto> {
    const users = await this.usersService.findAll(paginationDto);
    return { data: users.data.map((user) => toUserResponseData(user)), meta: users.meta };
  }

  @Get('me')
  @ApiOkResponse({ type: UserResponseDto })
  async getMe(
    @Request() req: AuthenticatedRequest,
  ): Promise<UserResponseDataDto | null> {
    return toUserResponseData(await this.usersService.findOne(req.user.id));
  }

  @Get(':id')
  @ApiOkResponse({ type: UserResponseDto })
  async findOne(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<UserResponseDataDto | null> {
    // Users can see themselves, Admin can see everyone
    if (req.user.id !== id && !req.user.roles.includes(UserRole.ADMIN)) {
      throw new ForbiddenException('You can only view your own profile');
    }
    return toUserResponseData(await this.usersService.findOne(id));
  }

  @Patch(':id')
  @ApiOkResponse({ type: UserResponseDto })
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<UserResponseDataDto> {
    if (req.user.id !== id && !req.user.roles.includes(UserRole.ADMIN)) {
      throw new ForbiddenException('You can only update your own profile');
    }
    // Prevent self-role escalation
    return toUserResponseData(await this.usersService.update(id, updateUserDto));
  }

  @Post('change-password')
  @ApiCreatedResponse({ type: UserPasswordChangeResponseDto })
  async changePassword(
    @Request() req: AuthenticatedRequest,
    @Body() body: ChangePasswordDto,
  ): Promise<UserPasswordChangeResponseDataDto> {
    await this.usersService.changePassword(
      req.user.id,
      body.oldPassword,
      body.newPassword,
    );
    return { success: true };
  }

  @Post('me/credit/purchase-intent')
  @ApiCreatedResponse({ type: CreditPurchaseIntentResponseDto })
  async createCreditPurchaseIntent(
    @Request() req: AuthenticatedRequest,
    @Body() body: CreateCreditPurchaseIntentDto,
  ): Promise<CreditPurchaseIntentResponseDataDto> {
    const intent = await this.usersService.createCreditPurchaseIntent(
      req.user.id,
      body.required_credit,
    );
    return {
      status: intent.status,
      user_id: intent.user_id,
      required_credit: intent.required_credit,
      suggested_packages: intent.suggested_packages,
      purchase_url: intent.purchase_url,
      message: intent.message,
    };
  }

  @Roles(...ADMIN_ROLES)
  @Delete(':id')
  @ApiOkResponse({ type: UserDeleteResponseDto })
  async remove(@Param('id') id: string): Promise<UserDeleteResponseDataDto> {
    const result = await this.usersService.remove(id);
    return { affected: result.affected ?? null };
  }
}
