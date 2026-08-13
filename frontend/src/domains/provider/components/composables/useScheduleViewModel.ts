import { computed } from 'vue';
import dayjs from 'dayjs';

interface UseScheduleViewModelInput {
  selectedDate: string;
  weeklyOrders: any[];
  todaysOrders: any[];
}

export function useScheduleViewModel(input: UseScheduleViewModelInput) {
  const today = dayjs();

  const weekTimeSlots = [
    { idx: 0, label: '00-06', startH: 0, endH: 6 },
    { idx: 1, label: '06-12', startH: 6, endH: 12 },
    { idx: 2, label: '12-18', startH: 12, endH: 18 },
    { idx: 3, label: '18-24', startH: 18, endH: 24 },
  ];

  const dayTimeSlots = Array.from({ length: 24 }, (_, i) => ({ idx: i, label: `${i}:00` }));

  const weekDays = computed(() => {
    const current = dayjs(input.selectedDate);
    const startOfWeek = current.startOf('week');
    const days = [];
    for (let i = 0; i < 7; i++) {
      days.push(startOfWeek.add(i, 'day'));
    }
    return days;
  });

  const weekRangeLabel = computed(() => {
    if (weekDays.value.length === 0) return '';
    const start = weekDays.value[0];
    const end = weekDays.value[6];
    if (!start || !end) return '';
    return `${start.format('MM/DD')} - ${end.format('MM/DD')}`;
  });

  const getDayName = (day: any) => {
    const names = ['日', '一', '二', '三', '四', '五', '六'];
    return names[day.day()];
  };

  const getWeeklySlotOrderCount = (day: any, slot: any) => {
    if (!input.weeklyOrders) return 0;
    return input.weeklyOrders.filter((o: any) => {
      const orderStart = dayjs(o.start_time);
      return orderStart.isSame(day, 'day') && orderStart.hour() >= slot.startH && orderStart.hour() < slot.endH && o.status !== 'CANCELLED';
    }).length;
  };

  const getWeeklySlotClass = (day: any, slot: any) => {
    if (!input.weeklyOrders) return '';
    const isOccupied = input.weeklyOrders.some((o: any) => {
      const start = dayjs(o.start_time);
      const end = dayjs(o.end_time);
      const slotStart = day.hour(slot.startH).minute(0);
      const slotEnd = day.hour(slot.endH).minute(0);
      return start.isBefore(slotEnd) && end.isAfter(slotStart) && o.status !== 'CANCELLED';
    });
    return isOccupied ? 'has-order' : '';
  };

  const getSlotClass = (slotIdx: number) => {
    if (!input.todaysOrders) return '';
    const slotStart = dayjs(input.selectedDate).hour(slotIdx).minute(0);
    const slotEnd = slotStart.add(1, 'hour');
    const startOrder = input.todaysOrders.find((o: any) => {
      const start = dayjs(o.start_time);
      return start.isSame(slotStart, 'hour');
    });
    if (startOrder) return 'slot-start-order';
    const overlapOrder = input.todaysOrders.find((o: any) => {
      const start = dayjs(o.start_time);
      const end = dayjs(o.end_time);
      const selected = dayjs(input.selectedDate).startOf('day');
      const localSlotStart = selected.hour(slotIdx).minute(0);
      const localSlotEnd = selected.hour(slotIdx + 1).minute(0);
      return start.isBefore(localSlotEnd) && end.isAfter(localSlotStart);
    });
    if (overlapOrder) return 'slot-occupied';
    return '';
  };

  const getSlotOrder = (slotIdx: number) => {
    if (!input.todaysOrders) return null;
    return input.todaysOrders.find((o: any) => {
      const start = dayjs(o.start_time);
      const end = dayjs(o.end_time);
      const selected = dayjs(input.selectedDate).startOf('day');
      const slotStart = selected.hour(slotIdx).minute(0);
      const slotEnd = selected.hour(slotIdx + 1).minute(0);
      return start.isBefore(slotEnd) && end.isAfter(slotStart);
    });
  };

  return {
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
  };
}
