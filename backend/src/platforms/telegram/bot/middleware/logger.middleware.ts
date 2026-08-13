import { Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import * as fs from 'fs';
import * as path from 'path';

const logger = new Logger('TelegramBot');
const logPath = path.join(process.cwd(), 'logs', 'telegram-traffic.log');

function writeTrafficLog(msg: string) {
  const logDir = path.dirname(logPath);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  const timestamp = new Date().toISOString();
  // Use UTF-8 encoding for file append
  fs.appendFileSync(logPath, `[${timestamp}] ${msg}\n`, { encoding: 'utf8' });
}

export const telegrafLoggerMiddleware = async (
  ctx: Context,
  next: () => Promise<void>,
) => {
  const start = Date.now();
  const updateType = ctx.updateType;
  const from = ctx.from
    ? `User:${ctx.from.id}${ctx.from.username ? `(@${ctx.from.username})` : ''}`
    : 'Unknown';
  let message = '';

  try {
    if ('message' in ctx.update) {
      const msg = ctx.update.message;
      if ('text' in msg) {
        message = `Text: "${msg.text}"`;
      } else if ('photo' in msg) {
        message = 'Photo';
      } else {
        message = 'Other Message Type';
      }
    } else if ('callback_query' in ctx.update) {
      const cb = ctx.update.callback_query;
      message = `Callback: "${'data' in cb ? cb.data : 'unknown'}"`;
    } else {
      message = JSON.stringify(ctx.update).substring(0, 100);
    }

    const logMsg = `📥 [IN][${updateType}] from ${from} | ${message}`;
    logger.log(logMsg);
    writeTrafficLog(logMsg);

    await next();

    const ms = Date.now() - start;
    logger.log(`✅ [${updateType}] processed in ${ms}ms`);
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error(String(e));
    const ms = Date.now() - start;
    const errMsg = `❌ [IN][${updateType}] failed in ${ms}ms | Error: ${error.message}`;
    logger.error(errMsg);
    writeTrafficLog(errMsg);
    throw e;
  }
};
