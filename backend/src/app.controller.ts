import {
  Controller,
  Post,
  Body,
  Logger,
  Get,
  Param,
  Res,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import type { Response } from 'express';
import {
  ClientDebugLogDto,
  ClientDebugLogResponseDto,
} from './app.debug-log.dto';

@Controller()
export class AppController {
  private readonly logger = new Logger('ClientDebug');

  constructor(private readonly appService: AppService) {}

  @Post('debug/log')
  @ApiCreatedResponse({ type: ClientDebugLogResponseDto })
  clientLog(@Body() body: ClientDebugLogDto): ClientDebugLogResponseDto {
    this.logger.log(`[Frontend Log] ${JSON.stringify(body, null, 2)}`);
    return { success: true };
  }

  @Get('r/:code')
  @ApiResponse({
    status: 302,
    description: 'Redirects to registration with the referral code.',
    headers: {
      Location: {
        description: 'Registration route containing the encoded referral code.',
        schema: { type: 'string' },
      },
    },
  })
  handleReferral(@Param('code') code: string, @Res() res: Response) {
    return res.redirect(
      302,
      `/#/pages/login/register?ref=${encodeURIComponent(code)}`,
    );
  }

  @Get('s/:slug')
  @ApiResponse({
    status: 302,
    description: 'Redirects to booking detail for the shared slug.',
    headers: {
      Location: {
        description: 'Booking detail route containing the encoded shared slug.',
        schema: { type: 'string' },
      },
    },
  })
  handleShareSlug(@Param('slug') slug: string, @Res() res: Response) {
    return res.redirect(
      302,
      `/#/pages/booking/detail?slug=${encodeURIComponent(slug)}`,
    );
  }
}
