<template>
  <view class="schedule-controls-bar">
    <view class="view-toggle">
      <text :class="{ active: viewMode === 'year' }" @click="emit('toggle-view-mode', 'year')">年</text>
      <text :class="{ active: viewMode === 'month' }" @click="emit('toggle-view-mode', 'month')">月</text>
      <text :class="{ active: viewMode === 'week' }" @click="emit('toggle-view-mode', 'week')">周</text>
      <text :class="{ active: viewMode === 'day' }" @click="emit('toggle-view-mode', 'day')">日</text>
    </view>
    <view class="date-navigator">
      <template v-if="viewMode === 'year'">
        <text class="nav-action small" @click="emit('prev')">‹</text>
        <text class="week-range nowrap text-primary" @click="emit('go-today')">{{ dayjs(selectedDate).format('YYYY年') }}</text>
        <text class="nav-action small" @click="emit('next')">›</text>
      </template>
      <template v-else-if="viewMode === 'month'">
        <text class="nav-action small" @click="emit('prev')">‹</text>
        <text class="week-range nowrap text-primary" @click="emit('go-today')">{{ dayjs(selectedDate).format('YYYY年MM月') }}</text>
        <text class="nav-action small" @click="emit('next')">›</text>
      </template>
      <template v-else-if="viewMode === 'week'">
        <text class="nav-action small" @click="emit('prev')">‹</text>
        <text class="week-range nowrap text-primary" @click="emit('go-today')">{{ weekRangeLabel }}</text>
        <text class="nav-action small" @click="emit('next')">›</text>
      </template>
      <template v-else>
        <text class="nav-action small" @click="emit('prev')">‹</text>
        <text class="week-range nowrap text-primary" @click="emit('go-today')">{{ selectedDate || '今天' }}</text>
        <text class="nav-action small" @click="emit('next')">›</text>
      </template>
    </view>
  </view>
</template>

<script setup lang="ts">
import dayjs from 'dayjs';

defineProps<{
  viewMode: string;
  selectedDate: string;
  weekRangeLabel: string;
}>();

const emit = defineEmits<{
  (e: 'toggle-view-mode', mode: 'year' | 'month' | 'week' | 'day'): void;
  (e: 'prev'): void;
  (e: 'next'): void;
  (e: 'go-today'): void;
}>();
</script>

<style lang="scss" scoped>
.schedule-controls-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.view-toggle {
  display: flex;
  background-color: $uni-bg-color-grey;
  border-radius: 6px;
  padding: 2px;

  text {
    font-size: 12px;
    padding: 4px 10px;
    color: $uni-text-color-grey;
    border-radius: $uni-radius-sm;
    transition: all 0.2s;

    &.active {
      background-color: $uni-bg-color;
      color: $uni-color-primary;
      font-weight: 500;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    }
  }
}

.date-navigator {
  display: flex;
  align-items: center;
  font-size: 14px;

  .nav-action {
    padding: 0 8px;
    font-size: 18px;
    color: $uni-text-color-placeholder;

    &.small {
      font-size: 16px;
    }

    &:active {
      color: $uni-color-primary;
    }
  }

  .week-range {
    font-weight: 500;
    min-width: 80px;
    text-align: center;
  }
}

.text-primary {
  color: #0d6efd;
}

.nowrap {
  white-space: nowrap;
  flex-shrink: 0;
}
</style>
