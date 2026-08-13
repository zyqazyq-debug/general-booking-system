import { resolveCostPrice, resolveSalePrice } from '@/shared/utils/price-compat';

export function useLibraryDisplay() {
  const getPriceFormula = (item: any) => {
    const base = resolveCostPrice(
      item?.service as Record<string, unknown>,
      'library_display_formula_cost',
    );
    const type = item.markup_type || 'FIXED';
    const val = Number(item.markup_value ?? item.markup_amount ?? 0) || 0;

    if (val === 0) return `¥${base}`;

    if (type === 'PERCENT') {
      return `¥${base} + ${val}%`;
    }
    return `¥${base} + ¥${val}`;
  };

  const computeFinalPrice = (item: any) => {
    const hasMarkupValue =
      Number.isFinite(Number(item?.markup_value)) ||
      Number.isFinite(Number(item?.markup_amount));
    if (hasMarkupValue) {
      const base = resolveCostPrice(
        item?.service as Record<string, unknown>,
        'library_display_markup_cost',
      );
      const type = item?.markup_type || 'FIXED';
      const markupValue = Number(item?.markup_value ?? 0) || 0;
      const markupAmount =
        type === 'PERCENT'
          ? Math.round(base * (markupValue / 100))
          : Number(item?.markup_amount ?? item?.markup_value ?? 0) || 0;
      return (base + markupAmount).toFixed(2);
    }

    const price = resolveSalePrice(
      {
        sale_price: item?.service?.sale_price,
        cache_total_price: item?.cache_total_price,
        base_price: item?.service?.base_price,
      },
      'library_display_final_price',
    );
    if (price > 0) return price.toFixed(2);
    const base = resolveCostPrice(
      item?.service as Record<string, unknown>,
      'library_display_fallback_cost',
    );
    const markup = Number(item.markup_amount) || 0;
    return (base + markup).toFixed(2);
  };

  const weekdayNames = [
    '周一',
    '周二',
    '周三',
    '周四',
    '周五',
    '周六',
    '周日',
  ];
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
    return v
      .map((x: any) => Number(x))
      .filter((n: any) => Number.isFinite(n) && n >= 1 && n <= 7);
  };

  const getWeekdayList = (service: any) => {
    if (!service || !service.rules) return ['未设置'];
    const wds = normalizeWeekdays(service.rules.weekdays);
    if (wds.length === 0) return ['未设置'];

    const uniq = Array.from(new Set(wds)).sort((a, b) => a - b);
    if (uniq.length === 7) return ['每天'];

    // Check for consecutive range (e.g. 1-5)
    let isConsecutive = true;
    for (let i = 0; i < uniq.length - 1; i++) {
      const currentDay = uniq[i] ?? 0;
      const nextDay = uniq[i + 1] ?? 0;
      if (nextDay !== currentDay + 1) {
        isConsecutive = false;
        break;
      }
    }

    if (isConsecutive && uniq.length > 2) {
      const firstDay = uniq[0] ?? 1;
      const lastDay = uniq[uniq.length - 1] ?? 7;
      return [`${weekdayNames[firstDay - 1]}至${weekdayNames[lastDay - 1]}`];
    }

    return uniq.map((d) => weekdayNames[d - 1]);
  };

  const formatTimeRule = (service: any) => {
    if (!service || !service.rules) return '每天 00:00-24:00';
    
    // Get weekday display string
    const weekdays = getWeekdayList(service);
    const weekdayStr = weekdays.join('、');
    
    const start = service.rules.start_hour ?? 0;
    const end = service.rules.end_hour ?? 24;
    return `${weekdayStr} ${start}:00-${end}:00`;
  };

  const extractNote = (text: string, prefix: string) => {
    if (!text) return '';
    const parts = text.split('\n');
    const match = parts.find((p) => p.startsWith(prefix));
    return match ? match.replace(prefix, '') : '';
  };

  return {
    getPriceFormula,
    computeFinalPrice,
    getWeekdayList,
    formatTimeRule,
    extractNote,
  };
}
