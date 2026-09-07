import { Context } from 'telegraf';
import { Logger } from '@nestjs/common';

const logger = new Logger('TelegramRateLimit');

// Simple in-memory storage for rate limiting
// For production, use Redis
const userLastMessageTime = new Map<number, number>();
const RATE_LIMIT_MS = 1000; // 1 message per second

export const telegrafRateLimitMiddleware = async (
  ctx: Context,
  next: () => Promise<void>,
) => {
  if (!ctx.from) return next();

  const now = Date.now();
  const userId = ctx.from.id;
  const lastTime = userLastMessageTime.get(userId) || 0;

  if (now - lastTime < RATE_LIMIT_MS) {
    logger.warn('Telegram rate limit exceeded.');
    // Optionally notify the user
    // await ctx.reply('发送太快了，请稍后再试。');
    return;
  }

  userLastMessageTime.set(userId, now);

  // Cleanup old entries occasionally (simple approach)
  if (userLastMessageTime.size > 10000) {
    const threshold = now - 60000; // Remove users inactive for 1 min
    for (const [uid, time] of userLastMessageTime.entries()) {
      if (time < threshold) userLastMessageTime.delete(uid);
    }
  }

  return next();
};
