import {
  Body,
  Controller,
  Post,
  Request,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { SendSmsCodeDto, VerifySmsLoginDto } from './dto/sms-auth.dto';
import { AppThrottlerGuard } from '../../shared/common/guards/app-throttler.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedRequest } from '../../shared/common/types/auth-request.type';

@Controller('auth')
@UseGuards(AppThrottlerGuard)
export class AuthSessionController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() req: LoginDto) {
    const user = await this.authService.validateUser(
      req.username,
      req.password,
    );
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.authService.login(user, req.deviceInfo || {});
  }

  @Post('refresh')
  async refresh(@Body('refresh_token') refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token required');
    }
    return this.authService.refresh(refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(
    @Request() req: AuthenticatedRequest,
    @Body('refresh_token') refreshToken: string,
  ) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token required');
    }
    return this.authService.logout(req.user.id, refreshToken);
  }

  @Post('phone')
  async phoneLogin(@Body() body: VerifySmsLoginDto) {
    return this.authService.loginPhone(body.phone, body.code, body.deviceInfo);
  }

  @Post('sms/send-code')
  @Throttle({ default: { limit: 1, ttl: 60000 } })
  sendSmsCode(@Body() body: SendSmsCodeDto) {
    return this.authService.sendSmsCode(body.phone, body.scene);
  }

  @Post('sms/login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async smsLogin(@Body() body: VerifySmsLoginDto) {
    return this.authService.loginPhone(body.phone, body.code, body.deviceInfo);
  }
}
