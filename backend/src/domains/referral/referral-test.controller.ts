import {
  Body,
  Controller,
  ForbiddenException,
  NotFoundException,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsPositive, IsString } from 'class-validator';
import type { AuthenticatedRequest } from '../../shared/common/types/auth-request.type';
import { JwtAuthGuard } from '../auth';
import { PaymentChannel, PaymentPurpose } from '../payment/payment.types';
import { ReferralService } from './referral.service';

export class SimulatePaymentDto {
  @IsString()
  @IsNotEmpty()
  paymentEventId: string;

  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsInt()
  @IsPositive()
  amountMinor: number;

  @IsIn(['CNY'])
  currency: 'CNY';
}

@ApiTags('referral-test')
@Controller('referral')
export class ReferralTestController {
  constructor(private readonly referralService: ReferralService) {}

  @Post('simulate-payment')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Test-only simulated verified payment event' })
  @ApiResponse({ status: 200, description: 'Test event accepted.' })
  async simulatePayment(
    @Body() body: SimulatePaymentDto,
    @Request() req: AuthenticatedRequest,
  ) {
    if (process.env.NODE_ENV !== 'test') {
      throw new NotFoundException();
    }

    if (body.userId !== req.user.id) {
      throw new ForbiddenException(
        'A simulated payment can only target the authenticated user',
      );
    }

    return this.referralService.handlePaymentSettled({
      eventVersion: 1,
      paymentEventId: body.paymentEventId,
      transactionId: `test:${body.paymentEventId}`,
      payerUserId: req.user.id,
      orderNo: `test:${body.paymentEventId}`,
      tradeNo: `test:${body.paymentEventId}`,
      channel: PaymentChannel.WECHAT,
      amountMinor: body.amountMinor,
      currency: body.currency,
      purpose: PaymentPurpose.SOFTWARE_FEE,
      occurredAt: new Date().toISOString(),
    });
  }
}
