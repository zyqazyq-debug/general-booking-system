import type { PlatformAdapter, AuthData } from '../adapter.interface';
import { detectRuntimeEnv } from '@/utils/runtime-env';

export class WechatAdapter implements PlatformAdapter {
  name = 'wechat';

  isCurrentRuntime(): boolean {
    // Uni's H5 runtime can expose a compatibility `wx` global. Runtime
    // selection must use the platform contract, not global-name presence.
    return detectRuntimeEnv() === 'wechat_mini_program';
  }

  async login(): Promise<AuthData | null> {
    return new Promise((resolve) => {
      // @ts-ignore
      wx.login({
        success: (res: any) => {
          if (res.code) {
            resolve({ user: null, platform_token: res.code });
          } else {
            resolve(null);
          }
        },
        fail: () => resolve(null),
      });
    });
  }

  share(options?: any): void {
    // @ts-ignore
    wx.showShareMenu(options);
  }

  async pay(options?: any): Promise<void> {
    // @ts-ignore
    return new Promise((resolve, reject) => {
      // @ts-ignore
      wx.requestPayment({
        ...options,
        success: resolve,
        fail: reject,
      });
    });
  }

  setNavigationBarTitle(title: string): void {
    uni.setNavigationBarTitle({ title });
  }

  setNavigationBarColor(options: any): void {
    uni.setNavigationBarColor(options);
  }
}

export const wechatAdapter = new WechatAdapter();
