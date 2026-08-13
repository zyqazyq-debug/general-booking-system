import { getApiBaseUrl } from '@/utils/env';

type PriceMetricScene = string;

const priceMetricState = {
  newFieldRead: 0,
  legacyFieldRead: 0,
  byScene: {} as Record<PriceMetricScene, { newFieldRead: number; legacyFieldRead: number }>,
  lastFlushAt: 0,
};

let metricFlushInFlight = false;
let metricFlushQueued = false;

const normalizeNumber = (value: unknown): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
};

const bumpMetric = (scene: PriceMetricScene, legacyUsed: boolean) => {
  if (legacyUsed) {
    priceMetricState.legacyFieldRead += 1;
  } else {
    priceMetricState.newFieldRead += 1;
  }
  if (!priceMetricState.byScene[scene]) {
    priceMetricState.byScene[scene] = { newFieldRead: 0, legacyFieldRead: 0 };
  }
  if (legacyUsed) {
    priceMetricState.byScene[scene].legacyFieldRead += 1;
  } else {
    priceMetricState.byScene[scene].newFieldRead += 1;
  }
};

const shouldFlushMetric = () => {
  const total = priceMetricState.newFieldRead + priceMetricState.legacyFieldRead;
  if (total === 0) return false;
  const now = Date.now();
  if (total % 20 === 0) return true;
  if (now - priceMetricState.lastFlushAt > 60000) return true;
  return false;
};

const flushMetric = () => {
  if (typeof uni === 'undefined') return;
  if (!shouldFlushMetric()) return;
  if (metricFlushInFlight) {
    metricFlushQueued = true;
    return;
  }
  priceMetricState.lastFlushAt = Date.now();
  const total = priceMetricState.newFieldRead + priceMetricState.legacyFieldRead;
  const ratio = total > 0 ? Number((priceMetricState.legacyFieldRead / total).toFixed(4)) : 0;
  const base = getApiBaseUrl().replace(/\/+$/, '');
  metricFlushInFlight = true;
  setTimeout(() => {
    uni.request({
      url: `${base}/debug/log`,
      method: 'POST',
      data: {
        event: 'PRICE_FIELD_READ_RATIO',
        total_reads: total,
        new_field_reads: priceMetricState.newFieldRead,
        legacy_field_reads: priceMetricState.legacyFieldRead,
        legacy_ratio: ratio,
        by_scene: priceMetricState.byScene,
      },
      complete: () => {
        metricFlushInFlight = false;
        if (metricFlushQueued) {
          metricFlushQueued = false;
          flushMetric();
        }
      },
    });
  }, 0);
};

const pickPrice = (
  source: Record<string, unknown> | null | undefined,
  scene: PriceMetricScene,
  newFieldKeys: string[],
  legacyFieldKeys: string[],
  defaultValue = 0,
) => {
  const target = source || {};
  for (const key of newFieldKeys) {
    const value = normalizeNumber(target[key]);
    if (value !== null) {
      bumpMetric(scene, false);
      flushMetric();
      return value;
    }
  }
  for (const key of legacyFieldKeys) {
    const value = normalizeNumber(target[key]);
    if (value !== null) {
      bumpMetric(scene, true);
      flushMetric();
      return value;
    }
  }
  bumpMetric(scene, true);
  flushMetric();
  return defaultValue;
};

export const resolveSalePrice = (
  source: Record<string, unknown> | null | undefined,
  scene: PriceMetricScene,
  defaultValue = 0,
) => pickPrice(source, scene, ['sale_price'], ['cache_total_price', 'display_price_snapshot', 'base_price', 'price'], defaultValue);

export const resolveCostPrice = (
  source: Record<string, unknown> | null | undefined,
  scene: PriceMetricScene,
  defaultValue = 0,
) => pickPrice(source, scene, ['cost_price'], ['cache_cost_price', 'base_price'], defaultValue);

export const resolveProviderBasePrice = (
  source: Record<string, unknown> | null | undefined,
  scene: PriceMetricScene,
  defaultValue = 0,
) => pickPrice(source, scene, ['provider_base_price'], ['base_price'], defaultValue);
