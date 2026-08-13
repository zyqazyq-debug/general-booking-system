import { Injectable } from '@nestjs/common';
import { TelegramService } from '../services/telegram.service';
import type { HealthTelegramPort } from '../../../../shared/health/ports/health-telegram.port';

@Injectable()
export class HealthTelegramAdapter implements HealthTelegramPort {
  constructor(private readonly telegramService: TelegramService) {}

  async getBotInfo(): Promise<{ username?: string; id?: number }> {
    const info = await this.telegramService.getBotInfo();
    return {
      username: info?.username,
      id: info?.id,
    };
  }
}
