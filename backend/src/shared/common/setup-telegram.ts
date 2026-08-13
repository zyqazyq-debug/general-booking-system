import { ConfigService } from '@nestjs/config';
import axios, { AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

export async function deleteTelegramWebhook(configService: ConfigService) {
  // 核心：直接读取环境变量，本地开发由 .env.local 覆盖
  const botToken = configService.get<string>('TELEGRAM_BOT_TOKEN');

  if (!botToken) return;

  try {
    const proxyUrl = configService.get<string>('TELEGRAM_PROXY_URL');
    let axiosConfig: AxiosRequestConfig = {};

    if (proxyUrl) {
      const agent = proxyUrl.startsWith('socks')
        ? new SocksProxyAgent(proxyUrl)
        : new HttpsProxyAgent(proxyUrl, {
            keepAlive: true,
            timeout: 20000,
          });
      axiosConfig = {
        httpsAgent: agent,
        proxy: false,
      };
    }

    console.log(
      `Ensuring Webhook is deleted for Polling mode... (Proxy: ${proxyUrl || 'None'})`,
    );
    const response = await axios.get(
      `https://api.telegram.org/bot${botToken}/deleteWebhook`,
      axiosConfig,
    );
    console.log('Webhook deleted successfully:', response.data);
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('Failed to delete webhook:', error);
  }
}

export async function setupTelegramWebhook(configService: ConfigService) {
  const webhookUrl = configService.get<string>('API_URL');
  const botToken = configService.get<string>('TELEGRAM_BOT_TOKEN');

  if (!botToken) return;

  const explicitWebhookUrl = configService.get<string>('TELEGRAM_WEBHOOK_URL');
  const finalWebhookUrl =
    explicitWebhookUrl ||
    (webhookUrl ? `${webhookUrl}/telegram/webhook` : null);

  // Check if Webhook is enabled
  const enableWebhook =
    configService.get<string>('TELEGRAM_ENABLE_WEBHOOK') === 'true';
  const botMode = (
    configService.get<string>('TELEGRAM_BOT_MODE') || 'polling'
  ).toLowerCase();

  const shouldUseWebhook =
    enableWebhook && botMode === 'webhook' && !!finalWebhookUrl;

  if (shouldUseWebhook) {
    console.log(`Setting Telegram Webhook to: ${finalWebhookUrl}`);

    try {
      const proxyUrl = configService.get<string>('TELEGRAM_PROXY_URL');
      let axiosConfig: AxiosRequestConfig = {};

      if (proxyUrl) {
        const agent = proxyUrl.startsWith('socks')
          ? new SocksProxyAgent(proxyUrl)
          : new HttpsProxyAgent(proxyUrl, {
              keepAlive: true,
              timeout: 20000,
            });
        axiosConfig = {
          httpsAgent: agent,
          proxy: false, // disable axios default proxy handling to use agent
        };
      } else {
        // If no proxy is set, use the default axios config
        axiosConfig = {};
      }

      // Delete existing webhook first to avoid conflicts or stale states
      console.log(`Deleting old webhook... (Proxy: ${proxyUrl || 'None'})`);
      try {
        await axios.get(
          `https://api.telegram.org/bot${botToken}/deleteWebhook`,
          axiosConfig,
        );
      } catch (e) {
        console.warn(
          'Warning: Failed to delete old webhook (ignoring)',
          e instanceof Error ? e.message : String(e),
        );
      }

      // Set new webhook
      console.log(`Setting new webhook to ${finalWebhookUrl}...`);
      const response = await axios.get(
        `https://api.telegram.org/bot${botToken}/setWebhook?url=${finalWebhookUrl}`,
        axiosConfig,
      );
      console.log('Webhook set result:', response.data);
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      console.error('Failed to set webhook manually:', error);
    }
  } else {
    // If webhook is disabled but we are in this function, we should ensure it's deleted
    // But typically this function is only called if webhook is enabled.
    // We can add a safe delete check here just in case.
    await deleteTelegramWebhook(configService);
  }
}
