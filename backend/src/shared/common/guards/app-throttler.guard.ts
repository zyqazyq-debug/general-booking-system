import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const user = req['user'] as { id?: string } | undefined;
    if (user?.id) {
      return Promise.resolve(`user:${user.id}`);
    }
    const ip =
      (req['ip'] as string | undefined) ||
      (req['headers'] as Record<string, unknown> | undefined)?.[
        'x-forwarded-for'
      ];
    if (typeof ip === 'string' && ip.trim()) {
      return Promise.resolve(`ip:${ip.split(',')[0].trim()}`);
    }
    return Promise.resolve('ip:unknown');
  }

  protected async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    const { context } = requestProps;
    const type = context.getType();
    // Only apply throttling to HTTP requests for now to avoid crashes in Telegram Bot context
    if (type === 'http') {
      return super.handleRequest(requestProps);
    }

    // For other contexts (like Telegraf/RPC), we skip throttling to prevent errors
    // related to missing response objects (e.g. res.header is not a function)
    return true;
  }
}
