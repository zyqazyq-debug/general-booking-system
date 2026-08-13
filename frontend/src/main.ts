import { createSSRApp } from "vue";
import { createPinia } from 'pinia';
import App from "./App.vue";
import { initFrontendSentry } from '@/core/app/sentry';
import { applyUniI18nOverrides } from '@/core/i18n/uni-i18n-overrides';
import { injectUserSessionEffectsApi } from '@/core/auth/user-session-effects';
import { injectUserApi } from '@/shared/stores/user';
import { getUserById, updateUserById, loginTelegramWebappApi } from '@/domains/user';
import { i18n } from '@/core/i18n/instance';
import { setQrLoginAdapter } from '@/core/auth/qr-login/adapter';
import { loginQQApi, loginWechatApi } from '@/domains/user';

export { i18n };

const pinia = createPinia();
let rangeErrorHookInstalled = false;

export function createApp() {
  injectUserApi({
    getUserById,
    updateUserById,
    loginTelegramWebappApi,
  });
  injectUserSessionEffectsApi({
    updateUserById,
    loginTelegramWebappApi,
  });

  const app = createSSRApp(App);
  app.use(i18n);
  app.use(pinia);
  initFrontendSentry(app);
  applyUniI18nOverrides();
  setQrLoginAdapter({
    loginWechat: loginWechatApi,
    loginQQ: loginQQApi,
  });

  // --- Environment Check Log ---
  // @ts-ignore
  if (import.meta.env.DEV) {
    const shouldLog =
      (typeof window !== 'undefined' && /debugLog=1/.test(window.location.href)) ||
      uni.getStorageSync('debug_log') === '1';
    if (shouldLog) {
      console.log('%c 🚀 Frontend Dev Environment ', 'background: #222; color: #bada55; font-size: 14px; padding: 4px;');
      console.log('--------------------------------------------------');
      // @ts-ignore
      console.log(`🌍 MODE:         ${import.meta.env.MODE}`);
      // @ts-ignore
      console.log(`🔗 API Base:     ${import.meta.env.VITE_API_BASE_URL}`);
      // @ts-ignore
      console.log(`🤖 Bot Name:     @${import.meta.env.VITE_TELEGRAM_BOT_NAME}`);
      console.log('--------------------------------------------------');
    }
    if (typeof window !== 'undefined' && !rangeErrorHookInstalled) {
      rangeErrorHookInstalled = true;
      window.addEventListener('error', (event) => {
        const message = String(event?.message || '');
        const isRange = message.includes('Maximum call stack size exceeded') || event?.error instanceof RangeError;
        if (!isRange) return;
        const base = String(import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
        uni.request({
          url: `${base}/debug/log`,
          method: 'POST',
          data: {
            event: 'RANGE_ERROR_STACK',
            message,
            stack: String(event?.error?.stack || ''),
            filename: String(event?.filename || ''),
            lineno: Number(event?.lineno || 0),
            colno: Number(event?.colno || 0),
          },
        });
      });
    }
  }

  return {
    app,
    pinia
  };
}
