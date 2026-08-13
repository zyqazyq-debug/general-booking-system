<template>
  <!-- The container is removed because spacer is handled by AppPage -->
  <view class="bottom-tab">
      <view class="tab-item" :class="{ active: isActive('provider') }" @click="switchTab('/pages/provider/dashboard/index')">
            <text class="tab-icon">🛠️</text>
            <text class="tab-label">我的服务</text>
        </view>
        <view class="tab-item" :class="{ active: isActive('library') }" @click="switchTab('/pages/library/index')">
            <text class="tab-icon">⭐</text>
            <text class="tab-label">收藏</text>
        </view>
        <view class="tab-item" :class="{ active: isActive('user') }" @click="switchTab('/pages/user/profile')">
            <text class="tab-icon">🧑</text>
            <text class="tab-label">个人中心</text>
        </view>
  </view>
</template>

<script setup lang="ts">
import { useUserStore } from '@/shared/stores/user';
import { computed } from 'vue';

const userStore = useUserStore();

const isActive = (tab: string) => {
    const pages = getCurrentPages();
    const page = pages[pages.length - 1];
    const route = page ? page.route : '';
    
    if (!route) return false;

    if (tab === 'provider') {
        return route.includes('pages/provider/') || route.includes('pages/order/manage');
    }
    if (tab === 'library') {
        return route.includes('pages/library/') || 
               route.includes('pages/booking/') || 
               route.includes('pages/share/');
    }
    if (tab === 'user') {
        return route.includes('pages/user/') || 
               route.includes('pages/referral/') || 
               route.includes('pages/help/') || 
               (route.includes('pages/order/') && !route.includes('pages/order/manage'));
    }
    return false;
};

const switchTab = (url: string) => {
    // Use redirectTo instead of reLaunch to preserve store state if possible
    // reLaunch clears all pages and potentially resets app context in some environments
    uni.redirectTo({ url });
};
</script>

<style lang="scss" scoped>
/* Container style removed */

.bottom-tab {
    /* Changed from fixed to static/flex item */
    width: 100%;
    height: calc(60px + env(safe-area-inset-bottom));
    background-color: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    border-top: 1px solid $uni-border-color;
    display: flex;
    z-index: $uni-z-navbar;
    padding-bottom: env(safe-area-inset-bottom);
    box-shadow: 0 -4px 6px -1px rgba(0,0,0,0.02);
    box-sizing: border-box;
    flex-shrink: 0; /* Important for flex layout */
}

.tab-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: $uni-text-color-grey;
    font-size: 11px;
    font-weight: 500;
    transition: all 0.2s;
    height: 60px;
}

.tab-item.active { 
    color: $uni-color-primary; 
}

.tab-icon { 
    font-size: 22px; 
    margin-bottom: 2px;
    line-height: 1;
}

.tab-label {
    line-height: 1.2;
}
</style>
