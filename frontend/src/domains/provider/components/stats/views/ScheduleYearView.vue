<template>
  <view class="year-view-container">
    <view class="year-grid">
      <view
        v-for="month in 12"
        :key="month"
        class="month-cell"
        :class="{ 'current-month': isCurrentMonth(month - 1) }"
        @click="emit('month-click', month - 1)"
      >
        <text class="month-name">{{ month }}月</text>
        <view class="month-dots">
          <view v-if="getMonthOrderCount(month - 1) > 0" class="dot"></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import dayjs from 'dayjs';

const props = defineProps<{
  selectedDate: string;
  yearlyOrders?: any[];
}>();

const emit = defineEmits<{
  (e: 'month-click', monthIdx: number): void;
}>();

const isCurrentMonth = (monthIdx: number) => dayjs(props.selectedDate).month() === monthIdx;
const getMonthOrderCount = (monthIdx: number) => {
  if (!props.yearlyOrders) return 0;
  return props.yearlyOrders.filter((o: any) => dayjs(o.start_time).month() === monthIdx).length;
};
</script>

<style scoped>
.year-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 12px;
}

.month-cell {
  background-color: #f8fafc;
  border-radius: 8px;
  padding: 16px 8px;
  text-align: center;
  border: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.month-cell.current-month {
  background-color: #e0f2fe;
  border-color: #bae6fd;
  color: #0369a1;
  font-weight: 600;
}

.month-dots {
  display: flex;
  gap: 2px;
  margin-top: 4px;
  height: 4px;
}

.dot {
  width: 4px;
  height: 4px;
  background-color: #0ea5e9;
  border-radius: 50%;
}
</style>
