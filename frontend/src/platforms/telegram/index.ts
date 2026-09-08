import type { PlatformAdapter, AuthData } from '../adapter.interface';
import { isTelegramWebAppRuntime } from '@/utils/runtime-env';
import {
  markAuthInitIdle,
  markAuthInitPending,
} from '@/core/auth/auth-init-state';

export class TelegramAdapter implements PlatformAdapter {
  name = 'telegram';

  isCurrentRuntime(): boolean {
    return isTelegramWebAppRuntime();
  }

  async login(): Promise<AuthData | null> {
    if (typeof window === 'undefined') return null;
    const tg = (window as any).Telegram?.WebApp;

    if (!tg) {
      return null;
    }

    // --- InitData Extraction Logic from App.vue ---
    markAuthInitIdle();

    tg.ready();
    tg.expand();

    const initDataCandidates: Array<{ value: string; source: string }> = [];
    const pushCandidate = (value: unknown, source: string) => {
      if (typeof value !== 'string') return;
      const trimmed = value.trim();
      if (!trimmed) return;
      const seen = new Set<string>();
      let decoded = trimmed;
      for (let i = 0; i < 4; i++) {
        if (!seen.has(decoded)) {
          initDataCandidates.push({
            value: decoded,
            source: `${source}:d${i}`,
          });
          seen.add(decoded);
        }
        try {
          const next = decodeURIComponent(decoded);
          if (!next || next === decoded) break;
          decoded = next;
        } catch {
          break;
        }
      }
    };

    pushCandidate(tg.initData, 'tg.initData');
    const locationHash = window.location.hash || '';
    const locationSearch = window.location.search || '';
    const href = window.location.href || '';

    if (locationHash.includes('?')) {
      const queryPart = locationHash.split('?').slice(1).join('?');
      const paramsInHash = new URLSearchParams(queryPart);
      pushCandidate(paramsInHash.get('tgWebAppData'), 'hash.query');
    }

    if (locationSearch) {
      const paramsInSearch = new URLSearchParams(locationSearch);
      pushCandidate(paramsInSearch.get('tgWebAppData'), 'search.query');
    }

    if (href.includes('tgWebAppData=')) {
      const direct = href.match(/tgWebAppData=([^&]+)/);
      pushCandidate(direct?.[1] || '', 'href.regex');
    }

    const matchedCandidate = initDataCandidates.find((item) => {
      const p = new URLSearchParams(item.value);
      return (
        !!p.get('hash') &&
        (!!p.get('user') || !!p.get('auth_date') || !!p.get('query_id'))
      );
    });
    // Do not forward arbitrary URL data as an authentication credential. The
    // server performs the cryptographic verification, but the client must at
    // least require the Telegram init-data envelope before making that request.
    const initData = matchedCandidate?.value || '';

    // Telegram may include initData in the address bar. Remove it promptly so
    // it is not left in copied URLs, browser history, or client diagnostics.
    if (
      window.location.search.includes('tgWebAppData') ||
      window.location.hash.includes('tgWebAppData')
    ) {
      try {
        const url = new URL(window.location.href);
        const keysToRemove = [
          'tgWebAppData',
          'tgWebAppVersion',
          'tgWebAppPlatform',
          'tgWebAppThemeParams',
        ];

        keysToRemove.forEach((key) => url.searchParams.delete(key));

        if (url.hash.includes('tgWebAppData=')) {
          const [path, query] = url.hash.split('?');
          if (query) {
            const hashParams = new URLSearchParams(query);
            keysToRemove.forEach((key) => hashParams.delete(key));
            const newQuery = hashParams.toString();
            url.hash = path + (newQuery ? `?${newQuery}` : '');
          }
        }

        window.history.replaceState({}, '', url.toString());
      } catch {
        // URL cleanup is best effort; never log a URL because it may contain initData.
      }
    }

    if (!initData) {
      // A Telegram WebApp login is only valid with signed initData. Do not
      // synthesize a partial login from initDataUnsafe or platform metadata.
      return null;
    }

    // --- Auto-Login Signal ---
    uni.$emit('TG_INIT_DATA', {
      available: true,
    });

    markAuthInitPending();

    return {
      // The server derives the authenticated user from verified initData.
      // initDataUnsafe must never become an application identity source.
      user: null,
      platform_token: initData,
    };
  }

  share(options?: any): void {
    const tg = (window as any).Telegram?.WebApp;
    // Telegram WebApp share implementation
    // 通常是调用 switchInlineQuery 或 openTelegramLink
  }

  async pay(options?: any): Promise<void> {
    // 调用 openInvoice
  }

  setNavigationBarTitle(title: string): void {
    // TG WebApp Header 颜色和标题通常由 Bot 设置，WebApp 内部较少控制
  }

  setNavigationBarColor(options: any): void {
    const tg = (window as any).Telegram?.WebApp;
    if (options.backgroundColor) {
      tg.setHeaderColor(options.backgroundColor);
    }
  }
}

export const telegramAdapter = new TelegramAdapter();
