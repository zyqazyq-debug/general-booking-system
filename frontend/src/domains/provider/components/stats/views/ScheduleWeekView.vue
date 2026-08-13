<template>
  <view class="schedule-grid">
    <view class="grid-header">
      <view class="header-cell time-col-head"></view>
      <view
        v-for="day in weekDays"
        :key="day.format('YYYY-MM-DD')"
        class="header-cell week-head-cell"
        :class="{ 'today-col': day.isSame(today, 'day') }"
      >
        <text class="day-name">{{ getDayName(day) }}</text>
        <text class="day-date">{{ day.format('M/D') }}</text>
      </view>
    </view>
    <view class="grid-body-week">
      <view v-for="slot in weekTimeSlots" :key="slot.idx" class="time-row week-row">
        <view class="time-cell">{{ slot.label }}</view>
        <view
          v-for="day in weekDays"
          :key="day.format('YYYY-MM-DD') + '-' + slot.idx"
          class="slot-cell"
          :class="getWeeklySlotClass(day, slot)"
          @click="emit('slot-click', day, slot)"
        >
          <text v-if="getWeeklySlotOrderCount(day, slot) > 0" class="slot-text-mini">
            {{ getWeeklySlotOrderCount(day, slot) }}
          </text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import dayjs from 'dayjs';

defineProps<{
  weekDays: dayjs.Dayjs[];
  weekTimeSlots: Array<{ idx: number; label: string; startH: number; endH: number }>;
  today: dayjs.Dayjs;
  getDayName: (day: any) => string;
  getWeeklySlotClass: (day: any, slot: any) => string;
  getWeeklySlotOrderCount: (day: any, slot: any) => number;
}>();

const emit = defineEmits<{
  (e: 'slot-click', day: any, slot: any): void;
}>();
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

.time-col-head {
  flex: 0 0 50px;
}

.week-head-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.week-head-cell .day-name,
.week-head-cell .day-date {
  display: block;
  line-height: 1.1;
}

.week-head-cell .day-name {
  font-size: 12px;
}

.week-head-cell .day-date {
  font-size: 11px;
  color: #94a3b8;
}

.today-col .day-date {
  color: #0d6efd;
}

.time-row {
  display: flex;
  border-bottom: 1px solid #f1f5f9;
  height: 40px;
}

.time-cell {
  flex: 0 0 50px;
  font-size: 10px;
  color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid #f1f5f9;
}

.slot-cell {
  flex: 1;
  border-right: 1px solid #f1f5f9;
  position: relative;
}

.slot-cell.has-order {
  background-color: #f0f9ff;
}

.slot-text-mini {
  font-size: 10px;
  color: #1e3a8a;
  font-weight: 600;
  position: static;
}
</style>
