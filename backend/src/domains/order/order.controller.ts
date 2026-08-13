import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  UseGuards,
  Request,
  Query,
  Logger,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { OrderFilterDto } from './dto/order-filter.dto';
import { JwtAuthGuard } from '../auth';
import type { AuthenticatedRequest } from '../../shared/common/types/auth-request.type';
import { PaginationDto } from '../../shared/common/dto/pagination.dto';

@Controller('order')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class OrderController {
  private readonly logger = new Logger(OrderController.name);
  private static readonly manageWindow = new Map<
    string,
    { count: number; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(private readonly orderService: OrderService) {}

  private observeManageRequests(params: {
    userId: string;
    path: string;
    page: number;
    limit: number;
    startTime?: string;
    endTime?: string;
    traceId?: string;
    traceSource?: string;
  }) {
    const key = [
      params.userId,
      params.path,
      params.page,
      params.limit,
      params.startTime,
      params.endTime,
      params.traceId,
      params.traceSource,
    ].join('|');

    const existing = OrderController.manageWindow.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }

    const entry = {
      count: 1,
      timer: setTimeout(() => {
        const finalEntry = OrderController.manageWindow.get(key);
        if (!finalEntry) return;
        this.logger.log(
          `OrderManage[dedupe] user=${params.userId} path=${params.path} page=${params.page} limit=${params.limit} start_time=${params.startTime} end_time=${params.endTime} traceId=${params.traceId} traceSource=${params.traceSource} count=${finalEntry.count}`,
        );
        OrderController.manageWindow.delete(key);
      }, 1000),
    };
    OrderController.manageWindow.set(key, entry);
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  create(
    @Request() req: AuthenticatedRequest,
    @Body() createOrderDto: CreateOrderDto,
  ) {
    // Prevent IDOR: Force consumer_id to be the current user
    createOrderDto.consumer_id = req.user.id;
    return this.orderService.create(createOrderDto);
  }

  @Get('my')
  findMyOrders(
    @Request() req: AuthenticatedRequest,
    @Query() paginationDto: PaginationDto,
  ) {
    // Return all related orders (consumer, provider, agent) with roles
    return this.orderService.findAllRelated(req.user.id, paginationDto);
  }

  @Get('manage')
  findOwnerOrders(
    @Request() req: AuthenticatedRequest,
    @Query() filter: OrderFilterDto,
  ) {
    const traceIdRaw = req.headers['x-trace-id'];
    const traceSourceRaw = req.headers['x-trace-source'];
    const traceId =
      typeof traceIdRaw === 'string'
        ? traceIdRaw
        : Array.isArray(traceIdRaw)
          ? traceIdRaw[0]
          : undefined;
    const traceSource =
      typeof traceSourceRaw === 'string'
        ? traceSourceRaw
        : Array.isArray(traceSourceRaw)
          ? traceSourceRaw[0]
          : undefined;
    const path = (req.originalUrl || req.url || '').split('?')[0];
    this.observeManageRequests({
      userId: req.user.id,
      path,
      page: filter.page ?? 1,
      limit: filter.limit ?? 10,
      startTime: filter.start_time,
      endTime: filter.end_time,
      traceId,
      traceSource,
    });
    return this.orderService.findAllByOwner(
      req.user.id,
      filter,
      filter.start_time,
      filter.end_time,
    );
  }

  @Get('credit-summary')
  getCreditSummary(@Request() req: AuthenticatedRequest) {
    return this.orderService.getCreditSummary(req.user.id);
  }

  @Get('credit-check')
  checkCredit(
    @Request() req: AuthenticatedRequest,
    @Query('serviceId') serviceId: string,
  ) {
    return this.orderService.checkCreditForService(req.user.id, serviceId);
  }

  // TODO: Add ownership check for these actions (ensure it's the owner of the schedule)
  @Post(':id/confirm')
  confirm(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.orderService.confirm(id, req.user.id);
  }

  @Post(':id/complete')
  complete(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.orderService.complete(id, req.user.id);
  }

  @Post(':id/no-show')
  noShow(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.orderService.noShow(id, req.user.id);
  }

  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.orderService.cancel(id, req.user.id, reason);
  }

  // findAll() is REMOVED to prevent accidental exposure.
  // Use AdminController for administrative listing.

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.orderService.findOne(id, req.user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateOrderDto: UpdateOrderDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.orderService.update(id, updateOrderDto, req.user.id);
  }
}
