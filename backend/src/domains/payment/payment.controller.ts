import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  Request,
  Headers,
} from '@nestjs/common';
import { CreatePrepayDto } from './dto/create-prepay.dto';
import { PaymentChannel } from './payment.types';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../auth';
import type { AuthenticatedRequest } from '../../shared/common/types/auth-request.type';
import { ApiCreatedResponse, ApiExcludeEndpoint, ApiOkResponse } from '@nestjs/swagger';
import {
  CreatePrepayResponseEnvelopeDto,
  PaymentChannelAvailabilityResponseEnvelopeDto,
  PaymentStatusResponseEnvelopeDto,
} from './dto/payment-response.dto';

@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('channels')
  @ApiOkResponse({ type: PaymentChannelAvailabilityResponseEnvelopeDto, description: 'Configured payment channels and their runtime availability.' })
  getChannels() {
    return this.paymentService.getChannels();
  }

  @Post('prepay')
  @UseGuards(JwtAuthGuard)
  @ApiCreatedResponse({ type: CreatePrepayResponseEnvelopeDto, description: 'Provider prepay initiation details for the persisted transaction.' })
  createPrepay(
    @Body() dto: CreatePrepayDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.paymentService.createPrepay(dto, req.user.id);
  }

  @Post('notify/:channel')
  @ApiExcludeEndpoint()
  notify(
    @Param('channel') channel: PaymentChannel,
    @Body() payload: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.paymentService.handleNotify(channel, payload, headers);
  }

  @Get(':channel/:orderNo/status')
  @ApiOkResponse({ type: PaymentStatusResponseEnvelopeDto, description: 'Persisted payment transaction state for the requested channel and order.' })
  getStatus(
    @Param('channel') channel: PaymentChannel,
    @Param('orderNo') orderNo: string,
  ) {
    return this.paymentService.getPaymentStatus(channel, orderNo);
  }
}
