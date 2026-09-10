import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { MergeTelegramAccountDto } from './dto/merge-telegram-account.dto';
import { IdentityBindDto } from './dto/identity-merge.dto';
import {
  IdentityScanStartDto,
  IdentityScanStatusDto,
} from './dto/identity-scan.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedRequest } from '../../shared/common/types/auth-request.type';
import { AppThrottlerGuard } from '../../shared/common/guards/app-throttler.guard';
import { IdentityUnbindDto } from './dto/identity-unbind.dto';
import {
  ApiCreatedAuthSuccessResponse,
  AuthLoginResponseDto,
  IdentityBoundResponseDto,
  IdentityMergeRequiredResponseDto,
  IdentityScanPendingResponseDto,
  IdentityScanSuccessResponseDto,
  IdentityUnbindResponseDto,
  ReservedIdentityScanStartResponseDto,
  TelegramIdentityScanStartResponseDto,
} from './dto/auth-response.dto';

@Controller('auth')
@UseGuards(AppThrottlerGuard)
export class AuthIdentityController {
  constructor(private readonly authService: AuthService) {}

  @Post('telegram/merge')
  @ApiCreatedAuthSuccessResponse(AuthLoginResponseDto)
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
  @ApiCreatedAuthSuccessResponse(AuthLoginResponseDto)
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
  @ApiCreatedAuthSuccessResponse(AuthLoginResponseDto)
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
  @ApiCreatedAuthSuccessResponse([
    IdentityBoundResponseDto,
    IdentityMergeRequiredResponseDto,
  ])
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
  @ApiCreatedAuthSuccessResponse(AuthLoginResponseDto)
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
  @ApiCreatedAuthSuccessResponse([
    TelegramIdentityScanStartResponseDto,
    ReservedIdentityScanStartResponseDto,
  ])
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
  @ApiCreatedAuthSuccessResponse([
    IdentityScanPendingResponseDto,
    IdentityScanSuccessResponseDto,
  ])
  @UseGuards(JwtAuthGuard)
  checkIdentityScanStatus(
    @Req() req: AuthenticatedRequest,
    @Body() body: IdentityScanStatusDto,
  ) {
    return this.authService.checkIdentityScanBindingStatus(
      body.ticket_id,
      req.user.id,
    );
  }

  @Post('identity/unbind')
  @ApiCreatedAuthSuccessResponse(IdentityUnbindResponseDto)
  @UseGuards(JwtAuthGuard)
  async unbindIdentity(
    @Req() req: AuthenticatedRequest,
    @Body() body: IdentityUnbindDto,
  ) {
    return this.authService.unbindIdentity(req.user.id, body.provider);
  }
}
