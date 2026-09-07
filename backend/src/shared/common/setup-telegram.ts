import { ConfigService } from '@nestjs/config';
import axios, { AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

const WEBHOOK_PATH = '/telegram/webhook';
const SECRET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

function isEnabled(configService: ConfigService, name: string) {
  return configService.get<string>(name)?.toLowerCase() === 'true';
}
function webhookConfiguration(configService: ConfigService) {
  const mode =
    configService.get<string>('TELEGRAM_BOT_MODE')?.toLowerCase() || 'polling';
  const url = configService.get<string>('TELEGRAM_WEBHOOK_URL')?.trim();
  const secret = configService
    .get<string>('TELEGRAM_WEBHOOK_SECRET_TOKEN')
    ?.trim();

  if (
    !isEnabled(configService, 'TELEGRAM_ENABLE_WEBHOOK') ||
    mode !== 'webhook'
  ) {
    return null;
  }
  if (!url || !secret || !SECRET_TOKEN_PATTERN.test(secret)) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.pathname !== WEBHOOK_PATH) {
      return null;
    }
    return { url: parsed.toString(), secret };
  } catch {
    return null;
  }
}

function axiosConfig(configService: ConfigService): AxiosRequestConfig {
  const proxyUrl = configService.get<string>('TELEGRAM_PROXY_URL');
  if (!proxyUrl) return {};

  const agent = proxyUrl.startsWith('socks')
    ? new SocksProxyAgent(proxyUrl)
    : new HttpsProxyAgent(proxyUrl, { keepAlive: true, timeout: 20000 });
  return { httpsAgent: agent, proxy: false };
}

/**
 * Remote webhook mutation is deliberately opt-in. A normal application
 * restart must never remove a production webhook just because this process is
 * configured differently.
 */
export async function deleteTelegramWebhook(configService: ConfigService) {
  if (
    !isEnabled(configService, 'TELEGRAM_WEBHOOK_MANAGE_ON_STARTUP') ||
    !isEnabled(configService, 'TELEGRAM_ALLOW_WEBHOOK_DELETE')
  ) {
    return;
  }

  const botToken = configService.get<string>('TELEGRAM_BOT_TOKEN');
  if (!botToken || botToken === 'DUMMY') return;

  try {
    await axios.post(
      `https://api.telegram.org/bot${botToken}/deleteWebhook`,
      undefined,
      axiosConfig(configService),
    );
    console.log('Telegram webhook deletion completed.');
  } catch {
    console.error('Telegram webhook deletion failed.');
  }
}

/**
 * This is a one-shot operator action, protected by
 * TELEGRAM_WEBHOOK_MANAGE_ON_STARTUP=true. It must be unset for normal
 * application launches. The URL is intentionally never inferred from API_URL.
 */
export async function setupTelegramWebhook(configService: ConfigService) {
  if (!isEnabled(configService, 'TELEGRAM_WEBHOOK_MANAGE_ON_STARTUP')) {
    return;
  }

  const botToken = configService.get<string>('TELEGRAM_BOT_TOKEN');
  const webhook = webhookConfiguration(configService);
  if (!botToken || botToken === 'DUMMY' || !webhook) {
    console.error(
      'Telegram webhook setup skipped: explicit HTTPS endpoint and valid secret token are required.',
    );
    return;
  }

  try {
    await axios.post(
      `https://api.telegram.org/bot${botToken}/setWebhook`,
      {
        url: webhook.url,
        secret_token: webhook.secret,
      },
      axiosConfig(configService),
    );
    console.log('Telegram webhook registration completed.');
  } catch {
    console.error('Telegram webhook registration failed.');
  }
}
