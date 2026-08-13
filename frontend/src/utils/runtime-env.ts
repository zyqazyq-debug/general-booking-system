export type RuntimeEnv = 'telegram_webapp' | 'wechat_mini_program' | 'qq_mini_program' | 'browser' | 'unknown';
export type HostApp = 'telegram' | 'wechat' | 'qq' | 'weibo' | 'douyin' | 'browser' | 'unknown';
export type MobileOS = 'ios' | 'android' | 'other';

export type RuntimeProfile = {
  runtime: RuntimeEnv;
  hostApp: HostApp;
  os: MobileOS;
  userAgent: string;
};

function getUA(): string {
  if (typeof navigator === 'undefined') return '';
  return navigator.userAgent || '';
}

function hasTelegramWebAppDataInUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const href = window.location.href || '';
  return /tgWebAppData=|tgWebAppVersion=|tgWebAppPlatform=/i.test(href);
}

function detectMobileOSFromUA(ua: string): MobileOS {
  if (/iphone|ipad|ipod|ios/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'other';
}

function detectHostAppFromUA(ua: string): HostApp {
  if (/telegram/i.test(ua)) return 'telegram';
  if (/micromessenger/i.test(ua)) return 'wechat';
  if (/qq\//i.test(ua) || /mqqbrowser/i.test(ua)) return 'qq';
  if (/weibo/i.test(ua)) return 'weibo';
  if (/aweme|douyin/i.test(ua)) return 'douyin';
  if (ua) return 'browser';
  return 'unknown';
}

export function isTelegramWebAppRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const tg = (window as any)?.Telegram?.WebApp;
  if (!tg) return false;

  // Check 1: Explicit initData or user (Strongest signal)
  const initData = typeof tg.initData === 'string' ? tg.initData.trim() : '';
  const hasUser =
    typeof tg?.initDataUnsafe?.user?.id === 'number' ||
    typeof tg?.initDataUnsafe?.user?.id === 'string';
  const hasData = initData.length > 0 || hasUser || hasTelegramWebAppDataInUrl();

  if (hasData) return true;

  // Check 2: Platform property (Medium signal)
  // Standard browsers with script tag usually return 'unknown'
  // Real TG clients return 'android', 'ios', 'tdesktop', etc.
  const isValidPlatform =
    typeof tg.platform === 'string' &&
    tg.platform.length > 0 &&
    tg.platform !== 'unknown';
  
  if (isValidPlatform) return true;

  // Check 3: UserAgent (Fallback signal)
  // If script is loaded but no data/platform, check if UA contains Telegram
  const ua = getUA();
  if (/Telegram/i.test(ua)) return true;

  return false;
}

export function detectRuntimeProfile(): RuntimeProfile {
  const ua = getUA();
  const os = detectMobileOSFromUA(ua);
  const hostApp = detectHostAppFromUA(ua);

  if (isTelegramWebAppRuntime()) {
    return { runtime: 'telegram_webapp', hostApp: 'telegram', os, userAgent: ua };
  }

  try {
    const info = uni.getSystemInfoSync();
    if (info?.uniPlatform === 'mp-weixin') {
      return { runtime: 'wechat_mini_program', hostApp: 'wechat', os, userAgent: ua };
    }
    if (info?.uniPlatform === 'mp-qq') {
      return { runtime: 'qq_mini_program', hostApp: 'qq', os, userAgent: ua };
    }
    if (info?.uniPlatform === 'web') {
      return { runtime: 'browser', hostApp, os, userAgent: ua };
    }
  } catch (_) {}

  return { runtime: 'unknown', hostApp, os, userAgent: ua };
}

export function detectRuntimeEnv(): RuntimeEnv {
  return detectRuntimeProfile().runtime;
}
