<template>
  <view class="date-section mt-2">
    <view class="date-navigator">
      <view class="nav-action" @click="emit('prev')">←</view>
      <picker mode="date" :value="selectedDate" :start="today" :end="maxDate" @change="emit('change', $event)">
        <view class="date-display">
          <text class="date-text">{{ selectedDate || '选择日期' }}</text>
          <text v-if="selectedDate" class="weekday-text">{{ dayOfWeekText }}</text>
          <text class="icon-calendar ml-1">📅</text>
        </view>
      </picker>
      <view class="nav-action" @click="emit('next')">→</view>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  selectedDate: string;
  today: string;
  maxDate: string;
  dayOfWeekText: string;
}>();

const emit = defineEmits<{
  (e: 'prev'): void;
  (e: 'next'): void;
  (e: 'change', payload: any): void;
}>();
</script>

<style lang="scss" scoped>
.date-section {
  margin-top: 8px;
}
.date-navigator {
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: $uni-bg-color-hover;
  border-radius: $uni-radius-lg;
  padding: 4px;
  gap: 8px;
}
.nav-action {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: $uni-text-color-secondary;
  background: $uni-bg-color;
  border: 1px solid #cbd5e1;
  border-radius: $uni-radius-base;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  flex-shrink: 0;
}
.nav-action:active {
  background-color: $uni-bg-color-grey;
  transform: translateY(1px);
}
.date-display {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  min-width: 140px;
  background-color: $uni-bg-color;
  border-radius: $uni-radius-base;
  padding: 0 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}
.ml-1 {
  margin-left: 4px;
}
.icon-calendar {
  font-size: 14px;
}
.date-text {
  font-size: 16px;
  font-weight: 600;
  color: $uni-text-color;
  line-height: 1.2;
}
.weekday-text {
  font-size: 14px;
  color: $uni-text-color-grey;
  line-height: 1.2;
  font-weight: 500;
}
</style>
