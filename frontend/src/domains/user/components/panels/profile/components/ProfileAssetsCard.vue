<template>
  <DashboardCard :title="t('profile.assets')" :no-margin="true">
    <view class="assets-row">
      <view class="asset-item">
        <text class="label">{{ t('profile.balance_cny') }}</text>
        <text v-if="creditReady" class="value">¥{{ walletBalance || '0.00' }}</text>
        <view v-else class="skeleton skeleton--value" />
        <AppButton v-if="creditReady" type="primary" size="small" class="recharge-action" @click="emit('recharge')">{{ t('profile.recharge') }}</AppButton>
        <view v-else class="skeleton skeleton--btn" />
      </view>
      <view class="asset-item">
        <text class="label">{{ t('profile.credit_total') }}</text>
        <text v-if="creditReady" class="value text-success">{{ totalCredit }}</text>
        <view v-else class="skeleton skeleton--value" />
        <view class="frozen-inline">
          <template v-if="creditReady">
            <text class="desc text-muted">{{ t('profile.frozen_orders') }}: {{ activeReservedOrders }}</text>
            <text class="desc text-muted">{{ t('profile.frozen') }}: {{ dynamicFrozenCredit }}</text>
          </template>
          <template v-else>
            <view class="skeleton skeleton--desc" />
            <view class="skeleton skeleton--desc" />
          </template>
        </view>
      </view>
    </view>
  </DashboardCard>
</template>

<script setup lang="ts">
import AppButton from '@/shared/components/AppButton.vue';
import DashboardCard from '@/shared/components/DashboardCard.vue';

defineProps<{
  t: (key: string) => string;
  walletBalance: string | number;
  creditReady: boolean;
  totalCredit: string;
  activeReservedOrders: number;
  dynamicFrozenCredit: number;
}>();

const emit = defineEmits<{
  (e: 'recharge'): void;
}>();
</script>

<style lang="scss" scoped>
.assets-row {
  display: flex;
  flex-direction: column;
  padding: 0;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
}

.asset-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid $uni-bg-color-grey;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  box-sizing: border-box;
  gap: 8px;
}

.asset-item:last-child {
  border-bottom: none;
  border-right: none;
}

.asset-item .label {
  font-size: 14px;
  color: $uni-text-color-grey;
  margin-bottom: 0;
  width: 80px;
  flex: 0 0 auto;
  white-space: nowrap;
}

.asset-item .value {
  font-size: 16px;
  font-weight: 700;
  color: $uni-text-color;
  margin-bottom: 0;
  line-height: 1.2;
  margin-right: 10px;
  white-space: nowrap;
}

.asset-item .desc {
  font-size: 12px;
  color: $uni-text-color-placeholder;
  margin-left: auto;
  white-space: nowrap;
}

.asset-item .recharge-action {
  margin-top: 0 !important;
  margin-left: auto;
  white-space: nowrap;
}

.frozen-inline {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  overflow: hidden;
}

.frozen-inline .desc {
  margin-left: 0;
}

.text-muted {
  color: $uni-text-color-placeholder;
  font-size: 12px;
}

.skeleton {
  border-radius: 10px;
  background: linear-gradient(90deg, rgba(220,220,220,0.55) 25%, rgba(235,235,235,0.9) 37%, rgba(220,220,220,0.55) 63%);
  background-size: 400% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
}
.skeleton--value {
  height: 18px;
  width: 86px;
}
.skeleton--btn {
  height: 30px;
  width: 76px;
  margin-left: auto;
  border-radius: 999px;
}
.skeleton--desc {
  height: 12px;
  width: 90px;
}
@keyframes shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: 0 0; }
}
</style>
