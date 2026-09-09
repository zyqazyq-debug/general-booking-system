import type { Agent } from 'node:http';
import type { AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

const HTTP_PROXY_PROTOCOLS = new Set(['http:', 'https:']);
const SOCKS_PROXY_PROTOCOLS = new Set([
  'socks:',
  'socks4:',
  'socks4a:',
  'socks5:',
  'socks5h:',
]);

export class TelegramHttpConfigError extends Error {
  readonly code = 'TELEGRAM_PROXY_URL_INVALID';

  constructor() {
    super('TELEGRAM_PROXY_URL_INVALID');
    this.name = 'TelegramHttpConfigError';
  }
}

export type TelegramHttpConfig = Readonly<{
  agent?: Agent;
  axios: Readonly<
    Pick<AxiosRequestConfig, 'httpAgent' | 'httpsAgent' | 'proxy'>
  >;
}>;

export function createTelegramHttpConfig(
  configuredProxyUrl: unknown,
): TelegramHttpConfig {
  const proxyUrl =
    typeof configuredProxyUrl === 'string' ? configuredProxyUrl.trim() : '';
  if (!proxyUrl)
    return Object.freeze({ axios: Object.freeze({ proxy: false }) });

  try {
    const parsed = new URL(proxyUrl);
    if (
      !parsed.hostname ||
      parsed.search ||
      parsed.hash ||
      !['', '/'].includes(parsed.pathname)
    ) {
      throw new Error('invalid proxy URL');
    }

    let agent: Agent;
    if (HTTP_PROXY_PROTOCOLS.has(parsed.protocol)) {
      agent = new HttpsProxyAgent(parsed);
    } else if (SOCKS_PROXY_PROTOCOLS.has(parsed.protocol)) {
      agent = new SocksProxyAgent(parsed);
    } else {
      throw new Error('unsupported proxy protocol');
    }

    return Object.freeze({
      agent,
      axios: Object.freeze({
        httpAgent: agent,
        httpsAgent: agent,
        proxy: false,
      }),
    });
  } catch {
    // Never attach the rejected URL or constructor error: either may contain
    // proxy credentials. Callers receive only this stable, non-secret code.
    throw new TelegramHttpConfigError();
  }
}
