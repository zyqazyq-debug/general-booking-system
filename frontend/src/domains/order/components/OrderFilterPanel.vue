<template>
  <view class="filter-panel">
    <view class="filter-title">筛选条件</view>
    <view class="filter-grid">
      <view class="filter-item">
        <text class="filter-label">开始日期</text>
        <picker mode="date" :value="dateStart" @change="emit('start-date-change', $event)">
          <view class="filter-chip">{{ dateStart || '请选择' }}</view>
        </picker>
      </view>
      <view class="filter-item">
        <text class="filter-label">结束日期</text>
        <picker mode="date" :value="dateEnd" @change="emit('end-date-change', $event)">
          <view class="filter-chip">{{ dateEnd || '请选择' }}</view>
        </picker>
      </view>
    </view>
    <view class="filter-grid">
      <view class="filter-item">
        <text class="filter-label">最低金额</text>
        <input class="filter-input" type="digit" :value="amountMin" placeholder="输入金额" @input="onMinInput" />
      </view>
      <view class="filter-item">
        <text class="filter-label">最高金额</text>
        <input class="filter-input" type="digit" :value="amountMax" placeholder="输入金额" @input="onMaxInput" />
      </view>
    </view>
    <view v-if="hasAnyFilter" class="filter-actions">
      <AppButton type="info" outline size="small" @click="emit('reset')">重置筛选</AppButton>
    </view>
  </view>
</template>

<script setup lang="ts">
import AppButton from '@/components/AppButton.vue';

const props = defineProps<{
  dateStart: string;
  dateEnd: string;
  amountMin: string;
  amountMax: string;
  hasAnyFilter: boolean;
}>();

const emit = defineEmits<{
  (e: 'start-date-change', payload: any): void;
  (e: 'end-date-change', payload: any): void;
  (e: 'update:amountMin', value: string): void;
  (e: 'update:amountMax', value: string): void;
  (e: 'reset'): void;
}>();

const onMinInput = (e: any) => emit('update:amountMin', e?.detail?.value || '');
const onMaxInput = (e: any) => emit('update:amountMax', e?.detail?.value || '');
</script>

<style lang="scss" scoped>
.filter-panel {
  background: $uni-bg-color;
  border-radius: $uni-radius-lg;
  padding: 12px;
  margin: 0 0 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
  border: 1px solid #eef2f7;
}
.filter-title {
  font-size: 13px;
  color: $uni-text-color-grey;
  font-weight: 600;
  margin-bottom: 10px;
}
.filter-grid {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.filter-grid:last-of-type {
  margin-bottom: 0;
}
.filter-item {
  flex: 1;
}
.filter-label {
  display: block;
  font-size: 12px;
  color: $uni-text-color-placeholder;
  margin-bottom: 6px;
}
.filter-chip {
  width: 100%;
  height: 36px;
  line-height: 36px;
  text-align: left;
  border: 1px solid $uni-border-color;
  border-radius: $uni-radius-base;
  font-size: 13px;
  color: $uni-text-color-secondary;
  background: #f9fbff;
  padding: 0 12px;
  box-sizing: border-box;
}
.filter-input {
  width: 100%;
  height: 36px;
  border: 1px solid $uni-border-color;
  border-radius: $uni-radius-base;
  padding: 0 12px;
  font-size: 13px;
  background: $uni-bg-color;
  color: $uni-text-color;
  box-sizing: border-box;
}
.filter-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>
