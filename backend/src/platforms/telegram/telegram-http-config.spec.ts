import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import {
  createTelegramHttpConfig,
  TelegramHttpConfigError,
} from './telegram-http-config';

describe('createTelegramHttpConfig', () => {
  it.each([undefined, null, '', '   '])(
    'disables Axios environment proxy discovery when no proxy is configured',
    (value) => {
      const config = createTelegramHttpConfig(value);
      expect(config.agent).toBeUndefined();
      expect(config.axios).toEqual({ proxy: false });
    },
  );

  it.each(['http://proxy.example:3128', 'https://proxy.example:8443'])(
    'uses HttpsProxyAgent for %s',
    (url) => {
      const config = createTelegramHttpConfig(url);
      expect(config.agent).toBeInstanceOf(HttpsProxyAgent);
      expect(config.axios).toEqual({
        httpAgent: config.agent,
        httpsAgent: config.agent,
        proxy: false,
      });
    },
  );

  it.each([
    'socks://proxy.example:1080',
    'socks4://proxy.example:1080',
    'socks4a://proxy.example:1080',
    'socks5://proxy.example:1080',
    'socks5h://proxy.example:1080',
  ])('uses SocksProxyAgent for %s', (url) => {
    const config = createTelegramHttpConfig(url);
    expect(config.agent).toBeInstanceOf(SocksProxyAgent);
    expect(config.axios.proxy).toBe(false);
  });

  it.each([
    'ftp://proxy.example:21',
    'http://',
    'http://proxy.example:3128/path',
    'http://proxy.example:3128?mode=unexpected',
    'http://proxy.example:3128#fragment',
  ])('rejects unsupported or ambiguous proxy URL %s', (url) => {
    expect(() => createTelegramHttpConfig(url)).toThrow(
      TelegramHttpConfigError,
    );
  });

  it('never discloses rejected proxy credentials in its error', () => {
    const credential = 'proxy-password-material';
    let failure: unknown;
    try {
      createTelegramHttpConfig(
        `ftp://proxy-user:${credential}@proxy.example:21`,
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(TelegramHttpConfigError);
    expect(String(failure)).toBe(
      'TelegramHttpConfigError: TELEGRAM_PROXY_URL_INVALID',
    );
    expect(JSON.stringify(failure)).not.toContain(credential);
    expect(JSON.stringify(failure)).not.toContain('proxy-user');
  });
});
