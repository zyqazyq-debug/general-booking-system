<template>
  <view class="app-container">
    <DebugConsole v-if="showDebugConsole" />
    <!-- AppConfirmHost Removed from here -->
    <!-- Global Components (Toast, Modal, etc. if needed) -->
  </view>
</template>

<script setup lang="ts">
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app';
import { computed } from 'vue';
import { useUserStore } from '@/shared/stores/user';
import DebugConsole from '@/core/debug/DebugConsole.vue';
import { bootstrapAppLaunch, bootstrapAppShow } from '@/core/app/bootstrap';
import {
  initializeUserSessionEffects,
  loginWithTelegramWebApp,
} from '@/core/auth/user-session-effects';
import { isTelegramWebAppRuntime } from '@/utils/runtime-env';
import { applyUniI18nOverrides } from '@/core/i18n/uni-i18n-overrides';

const userStore = useUserStore();
initializeUserSessionEffects(userStore as any);
const showDebugConsole = computed(() => {
  if (!import.meta.env.DEV) return false;
  if (
    typeof window !== 'undefined' &&
    /debugConsole=1/.test(window.location.href)
  )
    return true;
  return uni.getStorageSync('debug_console') === '1';
});
const shouldLog = computed(() => {
  if (!import.meta.env.DEV) return false;
  if (typeof window !== 'undefined' && /debugLog=1/.test(window.location.href))
    return true;
  return uni.getStorageSync('debug_log') === '1';
});

onLaunch(async () => {
  applyUniI18nOverrides();
  if (shouldLog.value) console.log('App Launch');
  bootstrapAppLaunch(userStore as any, {
    loginWithTelegramWebApp: (token) =>
      loginWithTelegramWebApp(userStore as any, token),
  });

  // Handle Telegram Direct Link start parameter (startapp)
  const tg = (window as any).Telegram?.WebApp;
  if (tg && isTelegramWebAppRuntime()) {
    // Ensure WebApp is ready and expanded
    tg.ready();
    tg.expand();

    const startParam = tg.initDataUnsafe?.start_param;
    if (shouldLog.value) {
      // initDataUnsafe may include Telegram account data. Keep development
      // diagnostics metadata-only so it cannot leak through browser logs.
      console.log('[App] Telegram WebApp context detected', {
        hasStartParam: Boolean(startParam),
      });
    }

    if (startParam && startParam.startsWith('ic_')) {
      const slug = startParam.replace('ic_', '');
      if (shouldLog.value) console.log('[App] Detected Booking Slug:', slug);
      if (slug) {
        // Use reLaunch to clear page stack and go directly to booking detail
        setTimeout(() => {
          if (shouldLog.value)
            console.log('[App] Redirecting to booking detail:', slug);
          uni.reLaunch({
            url: `/pages/booking/detail?slug=${slug}`,
          });
        }, 500); // Increased delay to ensure router is ready
      }
    }
  }
});

onShow(async () => {
  if (shouldLog.value) console.log('App Show');
  await bootstrapAppShow(userStore as any);
});

onHide(() => {
  if (shouldLog.value) console.log('App Hide');
});
</script>
<script lang="ts">
import { bootstrapPageNotFound } from '@/core/app/bootstrap';

export default {
  onPageNotFound(res: any) {
    console.error('Page Not Found:', res);
    bootstrapPageNotFound(res.path);
  },
};
</script>
<style lang="scss">
@use 'sass:color';
@use '@/uni.scss';
@use '@/styles/legacy.scss';

/* Global Styles */
view,
text,
image,
scroll-view,
input,
textarea,
button {
  box-sizing: border-box;
}

/* 提升 uni-app 默认交互组件（Toast, Loading）的层级，防止被自定义的 Modal/Confirm 遮挡 */
.uni-toast,
.uni-sample-toast,
.uni-loading,
.uni-mask {
  z-index: 2147483647 !important;
}

button,
uni-button,
.uni-button {
  white-space: nowrap;
}
page {
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue',
    Arial, sans-serif;
  background-color: $uni-bg-color-grey;
  color: $uni-text-color;
  font-size: 14px;
  line-height: 1.5;
}

.scroll-hints {
  position: fixed;
  right: 10px;
  bottom: 80px;
  display: none;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 6px;
  background: rgba(0, 0, 0, 0.25);
  color: $uni-bg-color;
  backdrop-filter: blur(6px);
  border-radius: 14px;
  z-index: $uni-z-float;
  pointer-events: none;
}
.scroll-hints .arrow {
  font-size: 12px;
  line-height: 1;
  opacity: 0.9;
}
</style>
