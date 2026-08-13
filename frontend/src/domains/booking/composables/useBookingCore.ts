import { ref } from 'vue';
import { useUserStore } from '@/shared/stores/user';
import { useBookingSource } from './useBookingSource';
import { useBookingSlots } from './useBookingSlots';
import { useBookingCredit } from './useBookingCredit';
import { useBookingActions } from './useBookingActions';
import { useBookingBootstrap } from './useBookingBootstrap';

export function useBookingCore(onClose: () => void, onSuccess: () => void) {
  const userStore = useUserStore();
  const visible = ref(false);

  const {
    service,
    agentLinkToken,
    agencyNodeId,
    sourceAgentId,
    displayPrice,
    showCollectionAction,
    loadSource,
  } = useBookingSource();

  const {
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
  } = useBookingSlots(service);

  const {
    requiredCredit,
    availableCredit,
    creditShortfall,
    needPurchaseCredit,
    loadCreditCheck,
    triggerPurchaseIntent,
    resetCredit,
  } = useBookingCredit(service);

  const close = () => {
    visible.value = false;
    onClose();
  };

  const {
    addToCollection,
    confirmBooking,
    showConfirmDialog,
    confirmContent,
    executeBooking,
    closeConfirmDialog,
  } = useBookingActions(
    service,
    sourceAgentId,
    agencyNodeId,
    agentLinkToken,
    selectedDate,
    selectedSlot,
    displayPrice,
    close,
    onSuccess,
  );

  const { open, handlePrimaryAction } = useBookingBootstrap({
    visible,
    selectedDate,
    selectedSlot,
    needPurchaseCredit,
    today,
    resetSlots,
    resetCredit,
    setLoadErrorMessage: (message: string) => {
      loadErrorMessage.value = message;
    },
    loadSource,
    loadCreditCheck,
    fetchSlots,
    triggerPurchaseIntent,
    confirmBooking,
  });

  return {
    userStore,
    visible,
    service,
    displayPrice,
    showCollectionAction,
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
    requiredCredit,
    availableCredit,
    creditShortfall,
    needPurchaseCredit,
    showConfirmDialog,
    confirmContent,
    open,
    close,
    onDateChange,
    prevDay,
    nextDay,
    selectSlot,
    isSlotInDuration,
    formatTime,
    addToCollection,
    handlePrimaryAction,
    executeBooking,
    closeConfirmDialog,
  };
}
