import type {
  PaginationDto,
  PaginatedResponseDto,
} from '../../../shared/common/dto/pagination.dto';

export interface AdminServiceDto {
  id: string;
  owner_id: string;
  title: string | null;
  description?: string | null;
  duration_minutes: number;
  base_price: number | string | null;
  provider_base_price?: number | string | null;
  cost_price?: number | string | null;
  deposit_points?: number | string | null;
  is_active?: boolean;
  created_at?: Date;
  updated_at?: Date;
}

export interface AdminServicesPort {
  findAll(
    pagination?: PaginationDto,
  ): Promise<PaginatedResponseDto<AdminServiceDto>>;
}
