import { Injectable } from '@nestjs/common';
import { ServicesService } from '../services.service';
import type { AdminServiceDto, AdminServicesPort } from '../../admin';
import type {
  PaginationDto,
  PaginatedResponseDto,
} from '../../../shared/common/dto/pagination.dto';

@Injectable()
export class AdminServicesAdapter implements AdminServicesPort {
  constructor(private readonly servicesService: ServicesService) {}

  findAll(
    pagination?: PaginationDto,
  ): Promise<PaginatedResponseDto<AdminServiceDto>> {
    return this.servicesService.findAll(pagination);
  }
}
