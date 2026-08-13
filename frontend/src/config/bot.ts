/**
 * Telegram Bot Configuration
 */
// Try multiple ways to detect production mode in the browser
const isProd =
  import.meta.env.MODE === 'production' ||
  (typeof window !== 'undefined' && (
    window.location.hostname === 'app.happybooking.uk' ||
    window.location.hostname === '192.168.3.5'
  ));

export const TELEGRAM_BOT_NAME = isProd 
  ? 'happybookingbot' 
  : 'happybookingdevbot';

export const TELEGRAM_BOT_DISPLAY_NAME = isProd
  ? 'BookingBot'
  : 'happybookingdevbot';
