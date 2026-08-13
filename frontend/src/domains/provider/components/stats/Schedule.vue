<template>
  <view>
    <ScheduleControlsBar
      :view-mode="viewMode"
      :selected-date="selectedDate"
      :week-range-label="weekRangeLabel"
      @toggle-view-mode="emit('toggle-view-mode', $event)"
      @prev="emit('prev')"
      @next="emit('next')"
      @go-today="goToday"
    />
    
    <view class="schedule-body">
      <ScheduleYearView
        v-if="viewMode === 'year'"
        :selected-date="selectedDate"
        :yearly-orders="yearlyOrders"
        @month-click="onMonthClick"
      />
      <ScheduleMonthView
        v-else-if="viewMode === 'month'"
        :selected-date="selectedDate"
        :monthly-orders="monthlyOrders"
        @day-click="onMonthDayClick"
      />
      <ScheduleWeekView
        v-else-if="viewMode === 'week'"
        :week-days="weekDays"
        :week-time-slots="weekTimeSlots"
        :today="today"
        :get-day-name="getDayName"
        :get-weekly-slot-class="getWeeklySlotClass"
        :get-weekly-slot-order-count="getWeeklySlotOrderCount"
        @slot-click="onWeeklySlotClick"
      />
      <ScheduleDayView
        v-else
        :day-time-slots="dayTimeSlots"
        :get-slot-class="getSlotClass"
        @slot-click="onSlotClick"
      />
    </view>
  </view>
</template>

<script setup lang="ts">
import { toRef } from 'vue';
import ScheduleControlsBar from './components/ScheduleControlsBar.vue';
import ScheduleYearView from './views/ScheduleYearView.vue';
import ScheduleMonthView from './views/ScheduleMonthView.vue';
import ScheduleWeekView from './views/ScheduleWeekView.vue';
import ScheduleDayView from './views/ScheduleDayView.vue';
import { useScheduleViewModel } from './composables/useScheduleViewModel';
import { useScheduleInteractions } from './composables/useScheduleInteractions';

const props = defineProps<{
  viewMode: string,
  selectedDate: string,
  weeklyOrders: any[],
  todaysOrders: any[],
  monthlyOrders?: any[], // Optional
  yearlyOrders?: any[]   // Optional
}>();

const emit = defineEmits([
  'toggle-view-mode',
  'prev',
  'next',
  'date-change',
  'slot-click'
]);

const {
  today,
  weekTimeSlots,
  dayTimeSlots,
  weekDays,
  weekRangeLabel,
  getDayName,
  getWeeklySlotOrderCount,
  getWeeklySlotClass,
  getSlotClass,
  getSlotOrder,
} = useScheduleViewModel(props);

const { onMonthClick, onMonthDayClick, onWeeklySlotClick, onSlotClick, goToday } = useScheduleInteractions({
  selectedDate: toRef(props, 'selectedDate'),
  emit,
  getSlotOrder,
});

</script>

<style lang="scss" scoped>
.schedule-body {
  width: 100%;
}
</style>
