import type { PlatformAdapter, AuthData } from '../adapter.interface';

export class BrowserAdapter implements PlatformAdapter {
  name = 'browser';

  isCurrentRuntime(): boolean {
    return true; // Default fallback
  }

  async login(): Promise<AuthData | null> {
    // 浏览器环境通常使用账号密码/手机号登录，不依赖平台静默登录
    // 这里返回 null，由 UI 层决定显示登录表单
    return null;
  }

  share(options?: any): void {
    if (navigator.share) {
        navigator.share(options).catch(console.error);
    } else {
        console.log('Browser copy link fallback');
        // 可以触发一个通用的复制链接提示
    }
  }

  async pay(options?: any): Promise<void> {
    // 浏览器支付通常跳转 Stripe/支付宝/微信 H5 链接
    if (options.url) {
        window.location.href = options.url;
    } else {
        console.warn('Browser payment requires a redirect URL');
    }
  }

  setNavigationBarTitle(title: string): void {
    document.title = title;
  }

  setNavigationBarColor(options: any): void {
    // 浏览器通常不支持动态修改地址栏颜色，或者是通过 meta theme-color
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && options.backgroundColor) {
        meta.setAttribute('content', options.backgroundColor);
    }
  }
}

export const browserAdapter = new BrowserAdapter();
