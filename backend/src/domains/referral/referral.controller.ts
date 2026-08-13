import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth';
import type { AuthenticatedRequest } from '../../shared/common/types/auth-request.type';
import { ReferralService } from './referral.service';

@ApiTags('referral')
@Controller('referral')
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Post('simulate-payment')
  @ApiOperation({
    summary: 'Simulate a software fee payment to trigger referral rewards',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment processed and rewards distributed.',
  })
  async simulatePayment(@Body() body: { userId: string; amount: number }) {
    return this.referralService.processSoftwareFeePayment(
      body.userId,
      body.amount,
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('logs')
  @ApiOperation({ summary: 'Get referral logs for the current user' })
  async getMyLogs(@Request() req: AuthenticatedRequest) {
    return this.referralService.getReferralLogs(req.user.id);
  }
}
