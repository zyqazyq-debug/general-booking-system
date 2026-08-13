import type { PlatformAdapter, AuthData } from '../adapter.interface';
import { isTelegramWebAppRuntime } from '@/utils/runtime-env';
import { markAuthInitIdle, markAuthInitPending } from '@/core/auth/auth-init-state';

export class TelegramAdapter implements PlatformAdapter {
  name = 'telegram';

  isCurrentRuntime(): boolean {
    return isTelegramWebAppRuntime();
  }

  async login(): Promise<AuthData | null> {
    if (typeof window === 'undefined') return null;
    const tg = (window as any).Telegram?.WebApp;
    const ua = navigator.userAgent;
    
    // Robust API URL detection
    const getBaseUrl = () => {
        const envUrl = import.meta.env.VITE_API_BASE_URL;
        if (envUrl && envUrl.startsWith('http')) return envUrl.replace(/\/+$/, '');
        return window.location.origin + (envUrl || '/api').replace(/\/+$/, '');
    };
    const API_BASE_URL = getBaseUrl();
    
    if (!tg) {
        uni.request({
            url: API_BASE_URL + '/debug/log',
            method: 'POST',
            data: { event: 'TG_LOGIN_FAILED_NO_TG_OBJECT', ua, href: window.location.href }
        }).catch(() => {});
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
          initDataCandidates.push({ value: decoded, source: `${source}:d${i}` });
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
      return !!p.get('hash') && (!!p.get('user') || !!p.get('auth_date') || !!p.get('query_id'));
    });
    const initData = matchedCandidate?.value || initDataCandidates[0]?.value || '';
    const initDataSource = matchedCandidate?.source || initDataCandidates[0]?.source || 'none';

    // Clean up URL parameters
    if (initData && typeof window !== 'undefined' && (window.location.search.includes('tgWebAppData') || window.location.hash.includes('tgWebAppData'))) {
      try {
        const url = new URL(window.location.href);
        const keysToRemove = ['tgWebAppData', 'tgWebAppVersion', 'tgWebAppPlatform', 'tgWebAppThemeParams'];
        
        keysToRemove.forEach(key => url.searchParams.delete(key));
        
        if (url.hash.includes('tgWebAppData=')) {
             const [path, query] = url.hash.split('?');
             if (query) {
                 const hashParams = new URLSearchParams(query);
                 keysToRemove.forEach(key => hashParams.delete(key));
                 const newQuery = hashParams.toString();
                 url.hash = path + (newQuery ? `?${newQuery}` : '');
             }
        }
        
        window.history.replaceState({}, '', url.toString());
      } catch (e) {
        console.error('Failed to clean TG URL params', e);
      }
    }

    if (!initData) {
        // Fallback: If platform is present but initData is empty, try to construct a partial login
        // This is UNSAFE and should only be used for non-critical reads or debugging
        if (tg.platform && tg.platform !== 'unknown') {
             console.warn('[TelegramAdapter] initData missing, using platform fallback');
             uni.request({
                url: API_BASE_URL + '/debug/log',
                method: 'POST',
                data: { event: 'TG_LOGIN_FALLBACK_PLATFORM', ua, href: window.location.href, platform: tg.platform }
            }).catch(() => {});
            
            // We cannot login without initData hash, so we just return null.
            // The Sentinel Guard will redirect to login page.
            return null;
        }

        uni.request({
            url: API_BASE_URL + '/debug/log',
            method: 'POST',
            data: { event: 'TG_LOGIN_FAILED_NO_INITDATA', ua, href: window.location.href, tgPlatform: tg.platform }
        }).catch(() => {});
        return null;
    }

    // --- Auto-Login Signal ---
    const params = new URLSearchParams(initData);
    uni.$emit('TG_INIT_DATA', {
      initData: initData.substring(0, 50) + '...',
      hash: params.get('hash') || 'NONE',
      authDate: params.get('auth_date') || 'NONE'
    });
    
    console.log('[TelegramAdapter] InitData found, length:', initData.length);
    
    markAuthInitPending();
    
    uni.request({
        url: API_BASE_URL + '/debug/log',
        method: 'POST',
        data: {
            event: 'TG_INIT_DATA_FOUND',
            initDataLength: initData.length,
            source: initDataSource,
            sample: initData.substring(0, 20)
        }
    }).catch(() => {});
    uni.request({
        url: API_BASE_URL + '/debug/log',
        method: 'POST',
        data: {
            event: 'TG_INIT_DATA_PAYLOAD',
            initData
        }
    }).catch(() => {});

    return {
        user: tg.initDataUnsafe?.user,
        platform_token: initData
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
