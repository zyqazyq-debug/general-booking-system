import {
  Controller,
  Post,
  Body,
  Logger,
  Get,
  Param,
  Res,
} from '@nestjs/common';
import { AppService } from './app.service';
import type { Response } from 'express';

@Controller()
export class AppController {
  private readonly logger = new Logger('ClientDebug');

  constructor(private readonly appService: AppService) {}

  @Post('debug/log')
  clientLog(@Body() body: Record<string, unknown>) {
    this.logger.log(`[Frontend Log] ${JSON.stringify(body, null, 2)}`);
    return { success: true };
  }

  @Get('r/:code')
  handleReferral(@Param('code') code: string, @Res() res: Response) {
    return res.redirect(
      302,
      `/#/pages/login/register?ref=${encodeURIComponent(code)}`,
    );
  }

  @Get('s/:slug')
  handleShareSlug(@Param('slug') slug: string, @Res() res: Response) {
    return res.redirect(
      302,
      `/#/pages/booking/detail?slug=${encodeURIComponent(slug)}`,
    );
  }
}
