<template>
  <AppPage :with-navbar="false" :padding="'0'" :disable-page-scroll="true">
    <view class="entry-container">
      <view class="entry-skeleton">
        <view class="skeleton-card" />
        <view class="skeleton-card" />
        <view class="skeleton-card" />
      </view>
      <text class="loading-text">刷新中...</text>
    </view>
  </AppPage>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useUserStore } from '@/shared/stores/user';
import { isAuthInitBlocked, waitForAuthInit } from '@/core/auth/auth-init-state';
import { isTelegramWebAppRuntime } from '@/utils/runtime-env';
import AppPage from '@/shared/components/AppPage.vue';

const userStore = useUserStore();

onMounted(() => {
  const checkAndRedirect = async () => {
    const token = userStore.token || uni.getStorageSync('token');
    if (!token && isTelegramWebAppRuntime() && !isAuthInitBlocked()) {
      await waitForAuthInit(1500);
    }
    const nextToken = userStore.token || uni.getStorageSync('token');

    if (nextToken) {
      if (!userStore.token) {
          if (typeof (userStore as any).syncFromStorage === 'function') {
            (userStore as any).syncFromStorage();
          } else {
            userStore.token = nextToken;
          }
      }
      
      const role = userStore.currentRole || 'CONSUMER';

      let targetUrl = '/pages/library/index';
      if (role === 'PROVIDER') {
        targetUrl = '/pages/provider/dashboard/index';
      } else if (role === 'AGENT') {
        targetUrl = '/pages/distribution/dashboard';
      }
      
      uni.reLaunch({ url: targetUrl });
    } else {
      uni.reLaunch({ url: '/pages/login/login' });
    }
  };

  checkAndRedirect();
});
</script>

<style lang="scss" scoped>
.entry-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: calc(var(--app-vh, 1vh) * 100);
  background-color: $uni-bg-color;
}
.loading-text {
  color: $uni-text-color-placeholder;
  font-size: 14px;
  margin-top: 12px;
}
.entry-skeleton {
  width: 86%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.skeleton-card {
  height: 72px;
  border-radius: 14px;
  background: linear-gradient(90deg, rgba(220,220,220,0.6) 25%, rgba(235,235,235,0.9) 37%, rgba(220,220,220,0.6) 63%);
  background-size: 400% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
}
@keyframes shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: 0 0; }
}
</style>
