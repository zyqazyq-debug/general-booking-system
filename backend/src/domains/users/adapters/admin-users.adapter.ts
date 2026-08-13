import { Injectable } from '@nestjs/common';
import { UsersService } from '../users.service';
import type { AdminUserDto, AdminUsersPort } from '../../admin';
import type {
  PaginationDto,
  PaginatedResponseDto,
} from '../../../shared/common/dto/pagination.dto';

@Injectable()
export class AdminUsersAdapter implements AdminUsersPort {
  constructor(private readonly usersService: UsersService) {}

  findAll(
    pagination?: PaginationDto,
  ): Promise<PaginatedResponseDto<AdminUserDto>> {
    return this.usersService.findAll(pagination);
  }

  addCredit(userId: string, amount: number): Promise<unknown> {
    return this.usersService.addCredit(userId, amount);
  }
}
