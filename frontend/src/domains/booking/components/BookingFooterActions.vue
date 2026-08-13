<template>
  <view class="modal-footer">
    <view v-if="showCreditLine" class="credit-line">
      <text>当前可用信用点: {{ availableCredit }}</text>
      <text>所需信用点: {{ requiredCredit }}</text>
      <text v-if="needPurchaseCredit" class="credit-shortfall">还差: {{ creditShortfall }}</text>
    </view>
    <view class="action-row">
      <AppButton v-if="showCollectionAction" type="info" outline class="action-button" @click="emit('add-to-collection')">加入收藏</AppButton>
      <AppButton type="primary" class="action-button" :class="{ 'full-width': !showCollectionAction }" @click="emit('primary-action')">
        {{ needPurchaseCredit ? '购买信用点' : '确认预约' }}
      </AppButton>
    </view>
  </view>
</template>

<script setup lang="ts">
import AppButton from '@/shared/components/AppButton.vue';

defineProps<{
  showCreditLine: boolean;
  availableCredit: number;
  requiredCredit: number;
  creditShortfall: number;
  needPurchaseCredit: boolean;
  showCollectionAction: boolean;
}>();

const emit = defineEmits<{
  (e: 'add-to-collection'): void;
  (e: 'primary-action'): void;
}>();
</script>

<style lang="scss" scoped>
.modal-footer {
  padding: 10px 16px;
  border-top: 1px solid $uni-bg-color-grey;
  background-color: $uni-bg-color;
  padding-bottom: calc(10px + env(safe-area-inset-bottom));
}
.credit-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: $uni-text-color-grey;
  margin-bottom: 8px;
}
.credit-shortfall {
  color: #dc2626;
}
.action-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.action-button {
  flex: 1;
}
.action-button.full-width {
  width: 100%;
}
</style>
