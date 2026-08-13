import { ref, type Ref } from 'vue';
import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween';
import { request } from '@/shared/api/request';
import { useBookingSlotMeta } from './useBookingSlotMeta';
import { useBookingUnavailableGuard } from '@/shared/composables/useBookingUnavailableGuard';
import { resolveBookingUnavailable } from '@/shared/utils/booking-unavailable';

dayjs.extend(isBetween);

export function useBookingSlots(service: Ref<any>) {
  const { markBookingUnavailable } = useBookingUnavailableGuard();
  const selectedDate = ref('');
  const slots = ref<any[]>([]);
  const selectedSlot = ref<any>(null);
  const loadingSlots = ref(false);
  const isServiceOffline = ref(false);
  const loadErrorMessage = ref('');

  const today = dayjs().format('YYYY-MM-DD');
  const maxDate = dayjs().add(30, 'day').format('YYYY-MM-DD');

  const { weekdayRuleText, dayOfWeekText, timeRuleText, isSlotInDuration, formatTime } = useBookingSlotMeta(
    service,
    selectedDate,
    selectedSlot,
  );

  const fetchSlots = async () => {
    if (!service.value || !selectedDate.value) return;
    loadingSlots.value = true;
    loadErrorMessage.value = '';
    try {
      const res = await request<any[]>({
        url: `/services/${service.value.id}/available-slots`,
        method: 'GET',
        params: { date: selectedDate.value },
        hideErrorToast: true,
      });
      const list = Array.isArray(res) ? (res as any[]) : [];
      const filteredByDate = list.filter((slot) => {
        const dateKey = dayjs(slot?.start_time).format('YYYY-MM-DD');
        return dateKey === selectedDate.value;
      });
      const dedupedByTime = Array.from(
        new Map(filteredByDate.map((slot) => [slot.start_time, slot])).values(),
      );
      const sh = Number(service.value?.rules?.start_hour ?? 0);
      const eh = Number(service.value?.rules?.end_hour ?? 24);
      const startHour = Number.isFinite(sh) ? sh : 0;
      const endHour = Number.isFinite(eh) ? eh : 24;
      const overnight = endHour <= startHour;
      const withinRule = (iso: string) => {
        const h = dayjs(iso).hour();
        if (!overnight) return h >= startHour && h < endHour;
        return h >= startHour || h < endHour;
      };
      const filteredByRule = dedupedByTime.filter((slot) => withinRule(slot.start_time));
      slots.value = filteredByRule;
    } catch (e: any) {
      const unavailable = resolveBookingUnavailable({ error: e });
      if (unavailable.matched) {
        isServiceOffline.value = true;
        slots.value = [];
        loadErrorMessage.value = unavailable.userMessage;
        markBookingUnavailable({
          serviceId: service.value?.id || undefined,
          message: unavailable.userMessage,
          scene: 'booking_fetch_slots',
          requestUrl:
            unavailable.requestUrl ||
            `/services/${service.value?.id}/slots?date=${selectedDate.value}`,
          statusCode: unavailable.statusCode,
          rawMessage: unavailable.rawMessage,
        });
        console.warn('[BookingUnavailable]', {
          scene: 'booking_fetch_slots',
          requestUrl:
            unavailable.requestUrl ||
            `/services/${service.value?.id}/slots?date=${selectedDate.value}`,
          statusCode: unavailable.statusCode,
          errorCode: unavailable.errorCode,
          message: unavailable.rawMessage,
        });
      } else {
        console.error(e);
        loadErrorMessage.value = '时段加载失败，请切换日期后重试';
      }
    } finally {
      loadingSlots.value = false;
    }
  };

  const onDateChange = async (e: any) => {
    selectedDate.value = e.detail.value;
    selectedSlot.value = null;
    await fetchSlots();
  };

  const prevDay = async () => {
    if (!selectedDate.value) return;
    const prev = dayjs(selectedDate.value).subtract(1, 'day');
    if (prev.isBefore(dayjs(today))) {
      uni.showToast({ title: '不能选择过去的时间', icon: 'none' });
      return;
    }
    selectedDate.value = prev.format('YYYY-MM-DD');
    selectedSlot.value = null;
    await fetchSlots();
  };

  const nextDay = async () => {
    if (!selectedDate.value) return;
    const next = dayjs(selectedDate.value).add(1, 'day');
    selectedDate.value = next.format('YYYY-MM-DD');
    selectedSlot.value = null;
    await fetchSlots();
  };

  const selectSlot = (slot: any) => {
    if (slot.status !== 'available') return;
    selectedSlot.value = slot;
  };

  const resetSlots = () => {
    selectedDate.value = '';
    selectedSlot.value = null;
    slots.value = [];
    isServiceOffline.value = false;
    loadErrorMessage.value = '';
  };

  return {
    selectedDate,
    slots,
    selectedSlot,
    loadingSlots,
    isServiceOffline,
    loadErrorMessage,
    today,
    maxDate,
    weekdayRuleText,
    dayOfWeekText,
    timeRuleText,
    fetchSlots,
    onDateChange,
    prevDay,
    nextDay,
    selectSlot,
    isSlotInDuration,
    formatTime,
    resetSlots,
  };
}
