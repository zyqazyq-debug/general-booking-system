import { Injectable, Inject } from '@nestjs/common';
import type { PlatformAgencyPort } from '../../platform-ports';
import { PLATFORM_AGENCY_PORT } from '../../platform-ports';

@Injectable()
export class TelegramPricingApplicationService {
  constructor(
    @Inject(PLATFORM_AGENCY_PORT)
    private readonly agencyPort: PlatformAgencyPort,
  ) {}

  isPricingIntent(userText: string): boolean {
    const normalized = userText.trim().toLowerCase();
    return (
      normalized === '加价' ||
      normalized === 'markup' ||
      normalized === '修改加价' ||
      normalized === '修改价格'
    );
  }

  async resolveCollectionIdFromReply(replyText: string): Promise<string> {
    const idMatch = replyText.match(/ID[:：]\s*([a-f0-9-]{36})/i);
    if (idMatch) {
      return idMatch[1];
    }

    const slugMatch =
      replyText.match(/Slug[:：]\s*([a-zA-Z0-9_-]+)/i) ||
      replyText.match(/加价\s+([a-zA-Z0-9_-]{6,})/i);
    if (!slugMatch || !slugMatch[1]) {
      return '';
    }

    try {
      const node = (await this.agencyPort.findBySlug(slugMatch[1])) as {
        id: string;
      } | null;
      if (node && typeof node.id === 'string') {
        return node.id;
      }
    } catch {
      return '';
    }

    return '';
  }
}
