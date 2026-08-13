import type { PlatformAdapter, AuthData } from '../adapter.interface';

export class WechatAdapter implements PlatformAdapter {
  name = 'wechat';

  isCurrentRuntime(): boolean {
    // @ts-ignore
    return typeof wx !== 'undefined' && typeof wx.login === 'function';
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
            fail: () => resolve(null)
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
            fail: reject
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
