import type {
  PaginationDto,
  PaginatedResponseDto,
} from '../../../shared/common/dto/pagination.dto';

export interface AdminUserDto {
  id: string;
  username?: string | null;
  nickname?: string | null;
  telegram_chat_id?: string | null;
  credit_balance?: number | string | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface AdminUsersPort {
  findAll(
    pagination?: PaginationDto,
  ): Promise<PaginatedResponseDto<AdminUserDto>>;
  addCredit(userId: string, amount: number): Promise<unknown>;
}
