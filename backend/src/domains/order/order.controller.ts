import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
  Logger,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
} from '@nestjs/swagger';
import { OrderService } from './order.service';
import {
  CreateOrderDto,
  type CreateOrderCommand,
} from './dto/create-order.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { OrderFilterDto } from './dto/order-filter.dto';
import { JwtAuthGuard } from '../auth';
import type { AuthenticatedRequest } from '../../shared/common/types/auth-request.type';
import { PaginationDto } from '../../shared/common/dto/pagination.dto';
import {
  CreditCheckResponseDto,
  CreditCheckResponseEnvelopeDto,
  CreditSummaryResponseDto,
  CreditSummaryResponseEnvelopeDto,
  ManagedOrdersResponseDto,
  ManagedOrdersResponseEnvelopeDto,
  MyOrdersResponseDto,
  MyOrdersResponseEnvelopeDto,
  OrderContextResponseDto,
  OrderContextResponseEnvelopeDto,
  OrderCreatedResponseEnvelopeDto,
  OrderResponseDto,
} from './dto/order-response.dto';

@Controller('order')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@ApiExtraModels(
  OrderResponseDto,
  MyOrdersResponseDto,
  ManagedOrdersResponseDto,
  CreditSummaryResponseDto,
  CreditCheckResponseDto,
  OrderContextResponseDto,
  OrderCreatedResponseEnvelopeDto,
  MyOrdersResponseEnvelopeDto,
  ManagedOrdersResponseEnvelopeDto,
  CreditSummaryResponseEnvelopeDto,
  CreditCheckResponseEnvelopeDto,
  OrderContextResponseEnvelopeDto,
)
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
  @ApiCreatedResponse({ type: OrderCreatedResponseEnvelopeDto })
  create(
    @Request() req: AuthenticatedRequest,
    @Body() createOrderDto: CreateOrderDto,
  ) {
    const command: CreateOrderCommand = {
      consumer_id: req.user.id,
      service_id: createOrderDto.service_id,
      agency_node_id: createOrderDto.agency_node_id,
      start_time: createOrderDto.start_time,
      end_time: createOrderDto.end_time,
    };
    return this.orderService.create(command);
  }

  @Get('my')
  @ApiOkResponse({ type: MyOrdersResponseEnvelopeDto })
  findMyOrders(
    @Request() req: AuthenticatedRequest,
    @Query() paginationDto: PaginationDto,
  ) {
    // Return all related orders (consumer, provider, agent) with roles
    return this.orderService.findAllRelated(req.user.id, paginationDto);
  }

  @Get('manage')
  @ApiOkResponse({ type: ManagedOrdersResponseEnvelopeDto })
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
  @ApiOkResponse({ type: CreditSummaryResponseEnvelopeDto })
  getCreditSummary(@Request() req: AuthenticatedRequest) {
    return this.orderService.getCreditSummary(req.user.id);
  }

  @Get('credit-check')
  @ApiOkResponse({ type: CreditCheckResponseEnvelopeDto })
  checkCredit(
    @Request() req: AuthenticatedRequest,
    @Query('serviceId') serviceId: string,
  ) {
    return this.orderService.checkCreditForService(req.user.id, serviceId);
  }

  @Post(':id/confirm')
  @ApiCreatedResponse({ type: OrderCreatedResponseEnvelopeDto })
  confirm(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.orderService.confirm(id, req.user.id);
  }

  @Post(':id/complete')
  @ApiCreatedResponse({ type: OrderCreatedResponseEnvelopeDto })
  complete(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.orderService.complete(id, req.user.id);
  }

  @Post(':id/no-show')
  @ApiCreatedResponse({ type: OrderCreatedResponseEnvelopeDto })
  noShow(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.orderService.noShow(id, req.user.id);
  }

  @Post(':id/cancel')
  @ApiCreatedResponse({ type: OrderCreatedResponseEnvelopeDto })
  cancel(
    @Param('id') id: string,
    @Body() cancelOrderDto: CancelOrderDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.orderService.cancel(id, req.user.id, cancelOrderDto.reason);
  }

  // findAll() is REMOVED to prevent accidental exposure.
  // Use AdminController for administrative listing.

  @Get(':id')
  @ApiOkResponse({ type: OrderContextResponseEnvelopeDto })
  findOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.orderService.findOne(id, req.user.id);
  }
}
