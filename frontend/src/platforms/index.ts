import { telegramAdapter } from './telegram';
import { wechatAdapter } from './wechat';
import { browserAdapter } from './browser';
import type { PlatformAdapter } from './adapter.interface';

export function getPlatformAdapter(): PlatformAdapter {
  // 1. Telegram WebApp 优先检测
  try {
      if (telegramAdapter.isCurrentRuntime()) {
        console.log('[Platform] Detected Telegram');
        return telegramAdapter;
      }
  } catch (e) {
      console.error('[Platform] Error checking Telegram runtime:', e);
  }
  
  // 2. 微信小程序环境检测
  try {
      if (wechatAdapter.isCurrentRuntime()) {
        console.log('[Platform] Detected Wechat');
        return wechatAdapter;
      }
  } catch (e) {
      console.error('[Platform] Error checking Wechat runtime:', e);
  }
  
  // 3. 默认为浏览器/Web 环境
  console.log('[Platform] Fallback to Browser');
  return browserAdapter;
}

/**
 * NOTE: Using a getter instead of a constant ensures we detect the platform
 * at the moment it's actually needed (e.g., during login).
 */
export const currentPlatform = {
    get name() { return getPlatformAdapter().name; },
    isCurrentRuntime() { return getPlatformAdapter().isCurrentRuntime(); },
    login() { return getPlatformAdapter().login(); },
    share(options?: any) { return getPlatformAdapter().share(options); },
    pay(options?: any) { return getPlatformAdapter().pay(options); },
    setNavigationBarTitle(title: string) { return getPlatformAdapter().setNavigationBarTitle(title); },
    setNavigationBarColor(options: any) { return getPlatformAdapter().setNavigationBarColor(options); }
} as PlatformAdapter;
