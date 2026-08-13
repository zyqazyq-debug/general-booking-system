import { computed, reactive, ref, watch, type Ref } from 'vue';
import { ServiceBlockType } from '@/types/api';

const DEFAULT_BLOCK_MINUTES = 60;
const HALF_HOUR_MINUTES = 30;

interface UseServiceBlockFormStateOptions {
  serviceId: Ref<string | undefined>;
}

export function useServiceBlockFormState(options: UseServiceBlockFormStateOptions) {
  const globalLoading = ref(false);
  const globalBlocks = ref<any[]>([]);
  const editingGlobalId = ref('');

  const form = reactive({
    start_date: '',
    start_clock: '',
    end_date: '',
    end_clock: '',
    reason: '',
    type: ServiceBlockType.TIME_OFF,
  });

  const isGlobal = computed(() => !options.serviceId.value);

  const pad = (num: number) => String(num).padStart(2, '0');

  const normalizeClockToHalfHour = (clock: string) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(clock);
    if (!match) return '';
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
    const total = hour * 60 + minute;
    const rounded = Math.min(Math.ceil(total / HALF_HOUR_MINUTES) * HALF_HOUR_MINUTES, 23 * 60 + 30);
    const hh = pad(Math.floor(rounded / 60));
    const mm = pad(rounded % 60);
    return `${hh}:${mm}`;
  };

  const formatPickerDate = (date: Date) => {
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    return `${y}-${m}-${d}`;
  };

  const formatPickerTime = (date: Date) => {
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    return normalizeClockToHalfHour(`${hh}:${mm}`);
  };

  const parseDateTimeValue = (dateText: string, timeText: string) => {
    if (!dateText || !timeText) return null;
    const normalizedTime = timeText.length === 5 ? `${timeText}:00` : timeText;
    const parsed = new Date(`${dateText}T${normalizedTime}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const setRange = (start: Date, end: Date) => {
    form.start_date = formatPickerDate(start);
    form.start_clock = formatPickerTime(start);
    form.end_date = formatPickerDate(end);
    form.end_clock = formatPickerTime(end);
  };

  const ceilToHalfHour = (date: Date) => {
    const next = new Date(date);
    next.setSeconds(0, 0);
    const minute = next.getMinutes();
    const remainder = minute % HALF_HOUR_MINUTES;
    if (remainder !== 0) {
      next.setMinutes(minute + (HALF_HOUR_MINUTES - remainder));
    }
    return next;
  };

  const getPickerValue = (event: any) => {
    const value = event?.detail?.value;
    return typeof value === 'string' ? value : '';
  };

  const onStartDateChange = (event: any) => {
    form.start_date = getPickerValue(event);
  };

  const onStartClockChange = (event: any) => {
    form.start_clock = normalizeClockToHalfHour(getPickerValue(event));
  };

  const onEndDateChange = (event: any) => {
    form.end_date = getPickerValue(event);
  };

  const onEndClockChange = (event: any) => {
    form.end_clock = normalizeClockToHalfHour(getPickerValue(event));
  };

  const initializeOnOpen = async (loadGlobalBlocks: () => Promise<void>) => {
    const start = ceilToHalfHour(new Date());
    const end = new Date(start.getTime() + DEFAULT_BLOCK_MINUTES * 60 * 1000);
    setRange(start, end);
    form.reason = '';
    editingGlobalId.value = '';
    if (isGlobal.value) {
      await loadGlobalBlocks();
    }
  };

  const formatRange = (start: string, end: string) => {
    const s = new Date(start);
    const e = new Date(end);
    const fmt = (d: Date) => {
      const y = d.getFullYear();
      const m = pad(d.getMonth() + 1);
      const day = pad(d.getDate());
      const hh = pad(d.getHours());
      const mm = pad(d.getMinutes());
      return `${y}-${m}-${day} ${hh}:${mm}`;
    };
    return `${fmt(s)} - ${fmt(e)}`;
  };

  watch(
    () => [form.start_date, form.start_clock],
    ([nextDate, nextClock]) => {
      const nextStartDate = parseDateTimeValue(nextDate, nextClock);
      const currentEndDate = parseDateTimeValue(form.end_date, form.end_clock);
      if (!nextStartDate) return;
      if (!currentEndDate || currentEndDate <= nextStartDate) {
        const end = new Date(nextStartDate.getTime() + DEFAULT_BLOCK_MINUTES * 60 * 1000);
        form.end_date = formatPickerDate(end);
        form.end_clock = formatPickerTime(end);
      }
    },
  );

  return {
    form,
    isGlobal,
    globalLoading,
    globalBlocks,
    editingGlobalId,
    normalizeClockToHalfHour,
    parseDateTimeValue,
    setRange,
    onStartDateChange,
    onStartClockChange,
    onEndDateChange,
    onEndClockChange,
    initializeOnOpen,
    formatRange,
  };
}
