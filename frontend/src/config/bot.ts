/**
 * Telegram bot identity is a build-time contract shared by login, referral,
 * and share flows. The release image requires both Vite values, while local
 * development keeps the explicit fallbacks owned by the environment adapter.
 */
import { getBotDisplayName, getBotName } from '@/utils/env';

export const TELEGRAM_BOT_NAME = getBotName();

export const TELEGRAM_BOT_DISPLAY_NAME = getBotDisplayName();
