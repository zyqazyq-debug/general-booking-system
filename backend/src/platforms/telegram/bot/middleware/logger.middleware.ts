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
  let payloadKind = 'Unknown';

  try {
    if ('message' in ctx.update) {
      const msg = ctx.update.message;
      if ('text' in msg) {
        payloadKind = 'Text';
      } else if ('photo' in msg) {
        payloadKind = 'Photo';
      } else {
        payloadKind = 'OtherMessage';
      }
    } else if ('callback_query' in ctx.update) {
      payloadKind = 'Callback';
    } else {
      payloadKind = 'OtherUpdate';
    }

    const logMsg = `📥 [IN][${updateType}] payload=${payloadKind}`;
    logger.log(logMsg);
    writeTrafficLog(logMsg);

    await next();

    const ms = Date.now() - start;
    logger.log(`✅ [${updateType}] processed in ${ms}ms`);
  } catch (e: unknown) {
    const ms = Date.now() - start;
    // Error text can include Telegram payloads, callback/deep-link tokens or
    // file URLs. Traffic logs retain only controlled operational metadata.
    const errMsg = `❌ [IN][${updateType}] failed in ${ms}ms | error_type=${e instanceof Error ? 'Error' : 'UnknownError'}`;
    logger.error(errMsg);
    writeTrafficLog(errMsg);
    throw e;
  }
};
