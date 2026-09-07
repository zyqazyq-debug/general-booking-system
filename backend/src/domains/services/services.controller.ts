import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UsePipes,
  ValidationPipe,
  Inject,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { CreateServiceBlockDto } from './dto/create-service-block.dto';
import { UpdateServiceBlockDto } from './dto/update-service-block.dto';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../auth';
import type { ServicesAgencyPort } from './ports/services-agency.port';
import { SERVICES_AGENCY_PORT } from './ports/tokens';
import type {
  AuthenticatedRequest,
  OptionalAuthenticatedRequest,
} from '../../shared/common/types/auth-request.type';
import { PaginationDto } from '../../shared/common/dto/pagination.dto';
import { ServiceAvailabilityService } from './service-availability.service';

@Controller('services')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ServicesController {
  constructor(
    private readonly servicesService: ServicesService,
    @Inject(SERVICES_AGENCY_PORT)
    private readonly agencyPort: ServicesAgencyPort,
    private readonly availabilityService: ServiceAvailabilityService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Body() createServiceDto: CreateServiceDto,
    @Request() req: AuthenticatedRequest,
  ) {
    createServiceDto.owner_id = req.user.id;
    return this.servicesService.create(createServiceDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('my')
  async findMyServices(
    @Request() req: AuthenticatedRequest,
    @Query() paginationDto: PaginationDto,
  ) {
    return this.servicesService.findAllByOwner(req.user.id, paginationDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/share')
  async ensureShareSlug(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    const node = await this.agencyPort.ensureOwnerRootNode(req.user.id, id);
    return {
      share_slug: node.share_slug,
      agency_node_id: node.id,
    };
  }

  @Get(':id/slots')
  async getAvailableSlots(
    @Param('id') id: string,
    @Query('date') dateStr: string,
    @Query('node') nodeId?: string,
  ) {
    if (!dateStr) {
      throw new BadRequestException('Date is required (YYYY-MM-DD)');
    }

    if (nodeId) {
      const node = await this.agencyPort.findNodeById(nodeId);
      if (!node || node.service_id !== id) {
        throw new NotFoundException('Agency node not found or invalid');
      }
      // nodeId 仅用于校验该 node 是否属于该 service；slots 计算仍以 service 为准
      return this.availabilityService.getAvailableSlots(id, dateStr);
    }
    // 交由 ServiceAvailabilityService 统一处理：
    // - 不存在：404
    // - is_deleted 或 is_active=false：400（SERVICE_UNAVAILABLE）
    return this.availabilityService.getAvailableSlots(id, dateStr);
  }

  @Get(':id/available-slots')
  async getAvailableSlotsAlias(
    @Param('id') id: string,
    @Query('date') dateStr: string,
    @Query('node') nodeId?: string,
  ) {
    if (!dateStr) {
      throw new BadRequestException('Date is required (YYYY-MM-DD)');
    }
    if (nodeId) {
      const node = await this.agencyPort.findNodeById(nodeId);
      if (!node || node.service_id !== id) {
        throw new NotFoundException('Agency node not found or invalid');
      }
    }
    return this.availabilityService.getAvailableSlots(id, dateStr);
  }

  @Get(':id/availability')
  getAvailability(
    @Param('id') id: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    this.assertAvailabilityDateRange(startDate, endDate);
    return this.servicesService.getPublicAvailability(id, startDate, endDate);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/availability/manage')
  async getManagementAvailability(
    @Param('id') id: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Request() req: AuthenticatedRequest,
  ) {
    this.assertAvailabilityDateRange(startDate, endDate);
    const service = await this.servicesService.findOne(id);
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    if (service.owner_id !== req.user.id) {
      throw new ForbiddenException(
        'You can only inspect availability for your own services',
      );
    }
    return this.servicesService.getManagementAvailability(
      id,
      startDate,
      endDate,
    );
  }

  @Get()
  findAll() {
    // Public endpoint: Only show active services, and potentially limit/paginate
    // Actually, "all services" shouldn't be public.
    // Public should only see services they have a direct link to (via agent/share), or maybe a curated list.
    // For now, let's RESTRICT this endpoint to Authenticated users (Provider looking for templates? No, that's different).
    // Or, if it's for "Marketplace", it should be filtered.
    // User requirement: "Public should ONLY see specific service or collection, NOT all."
    // So this endpoint should probably be removed or restricted to Admin.
    throw new ForbiddenException(
      'Listing all services is not allowed publicly',
    );
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  async findOne(
    @Param('id') id: string,
    @Request() req: OptionalAuthenticatedRequest,
  ) {
    const service = await this.servicesService.findOne(id);
    if (!service) {
      throw new NotFoundException('Service not found');
    }

    // IDOR Protection & Data Redaction
    // If user is not the owner and not an admin, redact sensitive fields
    const isOwner = req.user?.id === service.owner_id;
    const isAdmin = req.user?.roles?.includes('ADMIN');

    if (!isOwner && !isAdmin) {
      service.original_notes = '';
    }

    return service;
  }

  @Get(':id/deactivate-check')
  @UseGuards(JwtAuthGuard)
  async checkDeactivate(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    const service = await this.servicesService.findOne(id);
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    if (service.owner_id !== req.user.id && !req.user.roles.includes('ADMIN')) {
      throw new ForbiddenException('You can only check your own services');
    }

    // In the future, we can check for pending orders here
    // const pendingCount = await this.orderService.countPending(id);
    const pendingCount = 0; // Placeholder

    return {
      allow: true,
      message: '服务即将暂停，后续用户无法预约，已经预约订单不受影响。',
      pending_orders: pendingCount,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateServiceDto: UpdateServiceDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const service = await this.servicesService.findOne(id);
    if (!service) throw new NotFoundException('Service not found');
    if (service.owner_id !== req.user.id) {
      throw new ForbiddenException('You can only update your own services');
    }
    const result = await this.servicesService.update(id, updateServiceDto);
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const service = await this.servicesService.findOne(id);
    if (!service) throw new NotFoundException('Service not found');
    if (service.owner_id !== req.user.id) {
      throw new ForbiddenException('You can only delete your own services');
    }
    return this.servicesService.remove(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('blocks/global')
  async addGlobalBlock(
    @Body() createBlockDto: CreateServiceBlockDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.servicesService.addGlobalBlock(req.user.id, createBlockDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('blocks/global')
  async getGlobalBlocks(@Request() req: AuthenticatedRequest) {
    return this.servicesService.getGlobalBlocks(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('blocks/global/:blockId')
  async updateGlobalBlock(
    @Param('blockId') blockId: string,
    @Body() updateBlockDto: UpdateServiceBlockDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.servicesService.updateGlobalBlock(
      blockId,
      req.user.id,
      updateBlockDto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Delete('blocks/global/:blockId')
  async removeGlobalBlock(
    @Param('blockId') blockId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.servicesService.removeGlobalBlock(blockId, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/blocks')
  async addBlock(
    @Param('id') id: string,
    @Body() createBlockDto: CreateServiceBlockDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.servicesService.addBlock(id, req.user.id, createBlockDto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('blocks/:blockId')
  async removeBlock(
    @Param('blockId') blockId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.servicesService.removeBlock(blockId, req.user.id);
  }

  private assertAvailabilityDateRange(startDate: string, endDate: string) {
    if (!startDate || !endDate) {
      throw new BadRequestException('StartDate and EndDate required');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date format');
    }
    if (start > end) {
      throw new BadRequestException('Start date must be before end date');
    }

    const diffDays = Math.ceil(
      (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (diffDays > 90) {
      throw new BadRequestException('Date range cannot exceed 90 days');
    }
  }
}
