import { computed, type Ref } from 'vue';
import { resolveCostPrice } from '@/shared/utils/price-compat';

const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function useEditModalDisplay(preview: Ref<any>, form: Ref<any>) {
  const previewEditPrice = computed(() => {
    if (!preview.value) return '0.00';
    const base = resolveCostPrice(
      preview.value.service as Record<string, unknown>,
      'library_edit_preview_cost',
    );
    const val = Number(form.value.markup_value) || 0;
    if (form.value.markup_type === 'PERCENT') {
      return (base * (1 + val / 100)).toFixed(2);
    }
    return (base + val).toFixed(2);
  });

  const serviceRules = computed(() => {
    const service = preview.value?.service;
    if (!service || !service.rules) return null;
    try {
      return typeof service.rules === 'string' ? JSON.parse(service.rules) : service.rules;
    } catch {
      return null;
    }
  });

  const normalizeWeekdays = (weekdays: unknown): number[] => {
    if (!Array.isArray(weekdays)) return [];
    return Array.from(
      new Set(
        weekdays
          .map((day) => {
            const normalized = Number(day);
            if (!Number.isFinite(normalized)) return NaN;
            if (normalized === 0) return 7;
            return normalized;
          })
          .filter((day) => Number.isFinite(day) && day >= 1 && day <= 7),
      ),
    ).sort((a, b) => a - b);
  };

  const serviceDays = computed(() => {
    const rules = serviceRules.value;
    const weekdays = normalizeWeekdays(rules?.weekdays);
    if (weekdays.length === 0) return '未设置';
    if (weekdays.length === 7) return '每天';

    const isConsecutive = weekdays.every((day, index, arr) => (index === 0 ? true : day === (arr[index - 1] ?? day) + 1));
    if (isConsecutive && weekdays.length > 2) {
      const first = weekdays[0] ?? 1;
      const last = weekdays[weekdays.length - 1] ?? 7;
      return `${weekdayNames[first - 1]}至${weekdayNames[last - 1]}`;
    }
    return weekdays.map((day) => weekdayNames[day - 1]).join('、');
  });

  const formatHour = (hour: unknown, fallback: number, max: number) => {
    const normalized = Number(hour);
    return Number.isFinite(normalized) ? Math.max(0, Math.min(max, normalized)) : fallback;
  };

  const formatHourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

  const serviceHours = computed(() => {
    const rules = serviceRules.value;
    const hasStartHour = Number.isFinite(Number(rules?.start_hour));
    const hasEndHour = Number.isFinite(Number(rules?.end_hour));
    if (!hasStartHour || !hasEndHour) return '未设置';

    const rawStart = Number(rules?.start_hour);
    const rawEnd = Number(rules?.end_hour);
    const startHour = formatHour(rawStart, 0, 23);
    const endHour = formatHour(rawEnd, 24, 24);
    const startLabel = formatHourLabel(startHour);
    const endLabel = formatHourLabel(endHour);
    if (rawEnd <= rawStart) {
      return `${startLabel}-次日${endLabel}`;
    }
    return `${startLabel}-${endLabel}`;
  });

  return {
    previewEditPrice,
    serviceDays,
    serviceHours,
  };
}
