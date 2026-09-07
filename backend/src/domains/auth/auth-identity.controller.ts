import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { ScanIdentityProvider } from './auth.types';
import { MergeTelegramAccountDto } from './dto/merge-telegram-account.dto';
import { IdentityBindDto } from './dto/identity-merge.dto';
import {
  IdentityScanStartDto,
  IdentityScanStatusDto,
} from './dto/identity-scan.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedRequest } from '../../shared/common/types/auth-request.type';
import { AppThrottlerGuard } from '../../shared/common/guards/app-throttler.guard';

@Controller('auth')
@UseGuards(AppThrottlerGuard)
export class AuthIdentityController {
  constructor(private readonly authService: AuthService) {}

  @Post('telegram/merge')
  @UseGuards(JwtAuthGuard)
  async mergeTelegramAccount(
    @Req() req: AuthenticatedRequest,
    @Body() body: MergeTelegramAccountDto,
  ) {
    return this.authService.mergeTelegramAccountWithPhone(
      req.user.id,
      body.phone,
      body.code,
    );
  }

  @Post('phone/bind')
  @UseGuards(JwtAuthGuard)
  async bindPhone(
    @Req() req: AuthenticatedRequest,
    @Body() body: MergeTelegramAccountDto,
  ) {
    return this.authService.bindPhoneForCurrentUser(
      req.user.id,
      body.phone,
      body.code,
    );
  }

  @Post('account/merge-by-phone')
  @UseGuards(JwtAuthGuard)
  async mergeByPhone(
    @Req() req: AuthenticatedRequest,
    @Body() body: MergeTelegramAccountDto,
  ) {
    return this.authService.mergeAccountByPhone(
      req.user.id,
      body.phone,
      body.code,
    );
  }

  @Post('identity/bind')
  @UseGuards(JwtAuthGuard)
  async bindIdentity(
    @Req() req: AuthenticatedRequest,
    @Body() body: IdentityBindDto,
  ) {
    return this.authService.bindIdentityOrRequireMerge(
      req.user.id,
      body.provider,
      body.identity,
      body.code,
      body.proof,
    );
  }

  @Post('identity/merge-confirm')
  @UseGuards(JwtAuthGuard)
  async mergeByIdentity(
    @Req() req: AuthenticatedRequest,
    @Body() body: IdentityBindDto,
  ) {
    return this.authService.confirmMergeByIdentity(
      req.user.id,
      body.provider,
      body.identity,
      body.code,
      body.proof,
    );
  }

  @Post('identity/scan/start')
  @UseGuards(JwtAuthGuard)
  async startIdentityScan(
    @Req() req: AuthenticatedRequest,
    @Body() body: IdentityScanStartDto,
  ) {
    return this.authService.startIdentityScanBinding(
      req.user.id,
      body.provider,
    );
  }

  @Post('identity/scan/status')
  @UseGuards(JwtAuthGuard)
  checkIdentityScanStatus(@Body() body: IdentityScanStatusDto) {
    return this.authService.checkIdentityScanBindingStatus(body.ticket_id);
  }

  @Post('identity/unbind')
  @UseGuards(JwtAuthGuard)
  async unbindIdentity(
    @Req() req: AuthenticatedRequest,
    @Body('provider') provider: ScanIdentityProvider,
  ) {
    return this.authService.unbindIdentity(req.user.id, provider);
  }
}
