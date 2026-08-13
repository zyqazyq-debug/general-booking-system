<template>
  <view class="menu-grid-wrapper">
    <DashboardCard :title="t('profile.order_management')" :padding="'0 12px 12px 12px'" :no-margin="true">
      <view class="order-grid">
        <view class="grid-item" @click="emit('go-order', 'PROVIDER')">
          <view class="icon-circle bg-purple-light">
            <text class="grid-icon">🛠️</text>
          </view>
          <text class="grid-label">{{ t('profile.provider_orders') }}</text>
        </view>
        <view class="grid-item" @click="emit('go-order', 'AGENT')">
          <view class="icon-circle bg-green-light">
            <text class="grid-icon">🤝</text>
          </view>
          <text class="grid-label">{{ t('profile.agent_orders') }}</text>
        </view>
        <view class="grid-item" @click="emit('go-order', 'CONSUMER')">
          <view class="icon-circle bg-blue-light">
            <text class="grid-icon">💴</text>
          </view>
          <text class="grid-label">{{ t('profile.consumer_orders') }}</text>
        </view>
      </view>
    </DashboardCard>

    <AppCard :padding="'0'" :no-margin="true">
      <view class="menu-item" @click="emit('go-referral')">
        <view class="left">
          <text class="icon">📈</text>
          <text>{{ t('profile.referral_income') }}</text>
        </view>
        <text class="arrow">›</text>
      </view>

      <picker :range="langOptions" range-key="label" @change="emit('lang-change', $event)">
        <view class="menu-item">
          <view class="left">
            <text class="icon">🌐</text>
            <text>{{ t('profile.language') }}</text>
          </view>
          <view class="right-val">
            <text class="text-muted mr-1 right-val-text">{{ currentLangLabel }}</text>
            <text class="arrow">›</text>
          </view>
        </view>
      </picker>

      <view class="menu-item" @click="emit('go-help')">
        <view class="left">
          <text class="icon">❓</text>
          <text>{{ t('profile.help_center') }}</text>
        </view>
        <text class="arrow">›</text>
      </view>
    </AppCard>

    <AppCard :padding="'0'" :no-margin="true">
      <view class="menu-item logout-item" @click="emit('logout')">
        <view class="left">
          <text class="icon">🚪</text>
          <text>{{ t('app.logout') }}</text>
        </view>
        <text class="arrow">›</text>
      </view>
    </AppCard>
  </view>
</template>

<script setup lang="ts">
import AppCard from '@/shared/components/AppCard.vue';
import DashboardCard from '@/shared/components/DashboardCard.vue';

defineProps<{
  t: (key: string) => string;
  currentLangLabel: string;
  langOptions: Array<{ label: string; value: string }>;
}>();

const emit = defineEmits<{
  (e: 'go-order', role: 'CONSUMER' | 'PROVIDER' | 'AGENT'): void;
  (e: 'go-referral'): void;
  (e: 'lang-change', payload: any): void;
  (e: 'go-help'): void;
  (e: 'logout'): void;
}>();
</script>

<style scoped>
.menu-grid-wrapper {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid #f1f5f9;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  box-sizing: border-box;
  gap: 8px;
}

.menu-item:active {
  background-color: #f8fafc;
}

.menu-item:last-child {
  border-bottom: none;
}

.menu-item .left {
  display: flex;
  align-items: center;
  font-size: 13px;
  color: #334155;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.menu-item .left text:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-item .icon {
  margin-right: 8px;
  font-size: 14px;
  flex: 0 0 auto;
  width: 20px;
  text-align: center;
}

.menu-item .arrow {
  color: #cbd5e1;
  font-size: 12px;
  white-space: nowrap;
  flex: 0 0 auto;
}

.menu-item .right-val {
  display: flex;
  align-items: center;
  min-width: 0;
  white-space: nowrap;
  flex: 1;
  justify-content: flex-end;
  gap: 4px;
}

.menu-item .right-val .right-val-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  text-align: right;
}

.mr-1 {
  margin-right: 4px;
}

.text-muted {
  color: #94a3b8;
  font-size: 12px;
}

.order-grid {
  display: flex;
  justify-content: space-around;
  padding-top: 12px;
  padding-bottom: 0;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
}

.grid-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.icon-circle {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 4px;
  flex: 0 0 auto;
}

.grid-icon {
  font-size: 18px;
}

.grid-label {
  font-size: 11px;
  color: #334155;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.bg-green-light {
  background-color: #f0fdf4;
}

.bg-blue-light {
  background-color: #eff6ff;
}

.bg-purple-light {
  background-color: #faf5ff;
}

.logout-item .left,
.logout-item .arrow {
  color: #ef4444;
}
</style>
