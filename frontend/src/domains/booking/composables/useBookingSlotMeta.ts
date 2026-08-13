import { computed, type Ref } from 'vue';
import dayjs from 'dayjs';

export function useBookingSlotMeta(service: Ref<any>, selectedDate: Ref<string>, selectedSlot: Ref<any>) {
  const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  const normalizeWeekdays = (wds: unknown): number[] => {
    if (!wds) return [];
    let v: any = wds;
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v);
      } catch {
        v = [];
      }
    }
    if (!Array.isArray(v)) return [];
    return v.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n) && n >= 1 && n <= 7);
  };

  const weekdayRuleText = computed(() => {
    const wds = normalizeWeekdays(service.value?.rules?.weekdays);
    if (wds.length === 0) return '未设置';
    const uniq = Array.from(new Set(wds)).sort((a, b) => a - b);
    if (uniq.length === 7) return '每天';
    return uniq.map((d) => weekdayNames[d - 1]).join('、');
  });

  const dayOfWeekText = computed(() => {
    if (!selectedDate.value) return '';
    const day = dayjs(selectedDate.value).day();
    const map = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return map[day];
  });

  const timeRuleText = computed(() => {
    const start = service.value?.rules?.start_hour ?? 0;
    const end = service.value?.rules?.end_hour ?? 24;
    return `${start}:00 - ${end}:00`;
  });

  const isSlotInDuration = (slot: any) => {
    if (!selectedSlot.value || !service.value) return false;
    const start = dayjs(selectedSlot.value.start_time);
    const end = start.add(service.value.duration_minutes, 'minute');
    const current = dayjs(slot.start_time);
    return current.isAfter(start) && current.isBefore(end);
  };

  const formatTime = (iso: string) => dayjs(iso).format('HH:mm');

  return {
    weekdayRuleText,
    dayOfWeekText,
    timeRuleText,
    isSlotInDuration,
    formatTime,
  };
}
