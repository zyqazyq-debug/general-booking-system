<template>
  <view class="month-view-container">
    <view class="grid-header">
      <view v-for="dayName in ['日', '一', '二', '三', '四', '五', '六']" :key="dayName" class="header-cell">
        <text>{{ dayName }}</text>
      </view>
    </view>
    <view class="month-grid">
      <view
        v-for="(day, idx) in monthDays"
        :key="idx"
        class="month-day-cell"
        :class="{
          'other-month': !day.isSame(dayjs(selectedDate), 'month'),
          'today': day.isSame(today, 'day'),
          'selected': day.isSame(dayjs(selectedDate), 'day')
        }"
        @click="emit('day-click', day)"
      >
        <text class="day-number">{{ day.date() }}</text>
        <view v-if="getDayOrderCount(day) > 0" class="day-indicators">
          <text class="indicator-count">{{ getDayOrderCount(day) }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import dayjs from 'dayjs';

const props = defineProps<{
  selectedDate: string;
  monthlyOrders?: any[];
}>();

const emit = defineEmits<{
  (e: 'day-click', day: any): void;
}>();

const today = dayjs();

const monthDays = computed(() => {
  const startOfMonth = dayjs(props.selectedDate).startOf('month');
  const endOfMonth = dayjs(props.selectedDate).endOf('month');
  const startDay = startOfMonth.day();

  const days = [];
  for (let i = startDay; i > 0; i--) {
    days.push(startOfMonth.subtract(i, 'day'));
  }
  for (let i = 0; i < endOfMonth.date(); i++) {
    days.push(startOfMonth.add(i, 'day'));
  }
  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) {
    days.push(endOfMonth.add(i, 'day'));
  }
  return days;
});

const getDayOrderCount = (day: any) => {
  if (!props.monthlyOrders) return 0;
  return props.monthlyOrders.filter((o: any) => dayjs(o.start_time).isSame(day, 'day')).length;
};
</script>

<style scoped>
.grid-header {
  display: flex;
  border-bottom: 1px solid #e2e8f0;
}

.header-cell {
  flex: 1;
  text-align: center;
  padding: 8px 0;
  font-size: 12px;
  color: #64748b;
}

.month-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  padding: 8px 0;
}

.month-day-cell {
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  position: relative;
}

.month-day-cell.today {
  background-color: #e0f2fe;
  color: #0369a1;
  font-weight: bold;
}

.month-day-cell.selected {
  background-color: #0d6efd;
  color: #fff;
}

.month-day-cell.other-month {
  opacity: 0.3;
}

.day-indicators {
  margin-top: 2px;
}

.indicator-count {
  font-size: 8px;
  background-color: #ef4444;
  color: white;
  padding: 0 4px;
  border-radius: 4px;
  transform: scale(0.8);
}
</style>
