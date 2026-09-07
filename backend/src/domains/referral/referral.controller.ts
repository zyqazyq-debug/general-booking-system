import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../shared/common/types/auth-request.type';
import { JwtAuthGuard } from '../auth';
import { ReferralService } from './referral.service';

@ApiTags('referral')
@Controller('referral')
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('logs')
  @ApiOperation({ summary: 'Get referral logs for the current user' })
  async getMyLogs(@Request() req: AuthenticatedRequest) {
    return this.referralService.getReferralLogs(req.user.id);
  }
}
