import { type Ref } from 'vue';
import { resolveBookingUnavailable } from '@/shared/utils/booking-unavailable';

interface UseBookingBootstrapOptions {
  visible: Ref<boolean>;
  selectedDate: Ref<string>;
  selectedSlot: Ref<any>;
  needPurchaseCredit: Ref<boolean>;
  today: string;
  resetSlots: () => void;
  resetCredit: () => void;
  setLoadErrorMessage: (message: string) => void;
  loadSource: (options: any) => Promise<void>;
  loadCreditCheck: () => Promise<void>;
  fetchSlots: () => Promise<void>;
  triggerPurchaseIntent: () => Promise<void>;
  confirmBooking: () => Promise<boolean>;
}

export function useBookingBootstrap(options: UseBookingBootstrapOptions) {
  const open = async (payload: any) => {
    options.visible.value = true;
    options.resetSlots();
    options.resetCredit();
    options.setLoadErrorMessage('');
    try {
      await options.loadSource(payload);
      await options.loadCreditCheck();
      if (!options.selectedDate.value) {
        options.selectedDate.value = options.today;
      }
      await options.fetchSlots();
    } catch (e: any) {
      const unavailable = resolveBookingUnavailable({ error: e });
      if (unavailable.matched) {
        options.setLoadErrorMessage(unavailable.userMessage);
        return;
      }
      options.setLoadErrorMessage('预约信息加载失败，请稍后重试');
    }
  };

  const handlePrimaryAction = () => {
    const hasValidSlot = Boolean(options.selectedSlot.value && options.selectedSlot.value.start_time && options.selectedSlot.value.end_time);
    if (!hasValidSlot) {
      uni.showToast({ title: '请选择时间', icon: 'none' });
      return;
    }
    if (options.needPurchaseCredit.value) {
      void options.triggerPurchaseIntent();
      return;
    }
    void options.confirmBooking();
  };

  return {
    open,
    handlePrimaryAction,
  };
}
