import dayjs from 'dayjs';
import { type Ref } from 'vue';

interface UseScheduleInteractionsOptions {
  selectedDate: Ref<string>;
  emit: (event: 'toggle-view-mode' | 'prev' | 'next' | 'date-change' | 'slot-click', payload?: any) => void;
  getSlotOrder: (slotIdx: number) => any;
}

export function useScheduleInteractions(options: UseScheduleInteractionsOptions) {
  const onMonthClick = (monthIdx: number) => {
    const newDate = dayjs(options.selectedDate.value).month(monthIdx).startOf('month').format('YYYY-MM-DD');
    options.emit('date-change', { detail: { value: newDate } });
    options.emit('toggle-view-mode', 'month');
  };

  const onMonthDayClick = (day: any) => {
    options.emit('date-change', { detail: { value: day.format('YYYY-MM-DD') } });
    options.emit('toggle-view-mode', 'day');
  };

  const onWeeklySlotClick = (day: any, slot: any) => {
    options.emit('slot-click', { date: day.format('YYYY-MM-DD'), slot });
  };

  const onSlotClick = (slotIdx: number) => {
    const order = options.getSlotOrder(slotIdx);
    if (order) {
      options.emit('slot-click', { id: order.id });
      return;
    }
    options.emit('slot-click', { date: options.selectedDate.value, hour: slotIdx });
  };

  const goToday = () => {
    options.emit('date-change', { detail: { value: dayjs().format('YYYY-MM-DD') } });
  };

  return {
    onMonthClick,
    onMonthDayClick,
    onWeeklySlotClick,
    onSlotClick,
    goToday,
  };
}
