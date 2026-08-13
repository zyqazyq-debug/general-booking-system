import { ref } from 'vue';

interface BookingUnavailablePayload {
  agencyNodeId?: string;
  serviceId?: string;
  message?: string;
  scene?: string;
  requestUrl?: string;
  statusCode?: number;
  rawMessage?: string;
}

export interface BookingUnavailableEvent {
  scene: string;
  requestUrl: string;
  statusCode: number;
  rawMessage: string;
  occurredAt: number;
}

const unavailableNodeMap = ref<Record<string, string>>({});
const unavailableServiceMap = ref<Record<string, string>>({});
const lastBookingUnavailableEvent = ref<BookingUnavailableEvent | null>(null);

const DEFAULT_MESSAGE = '该服务当前不可预约，请稍后刷新后重试';

export function useBookingUnavailableGuard() {
  const markBookingUnavailable = (payload: BookingUnavailablePayload) => {
    const message = payload.message || DEFAULT_MESSAGE;
    if (payload.agencyNodeId) {
      unavailableNodeMap.value = {
        ...unavailableNodeMap.value,
        [payload.agencyNodeId]: message,
      };
    }
    if (payload.serviceId) {
      unavailableServiceMap.value = {
        ...unavailableServiceMap.value,
        [payload.serviceId]: message,
      };
    }
    if (payload.scene || payload.requestUrl || payload.statusCode || payload.rawMessage) {
      lastBookingUnavailableEvent.value = {
        scene: payload.scene || 'unknown',
        requestUrl: payload.requestUrl || '',
        statusCode: payload.statusCode || 0,
        rawMessage: payload.rawMessage || '',
        occurredAt: Date.now(),
      };
    }
  };

  const isBookingUnavailable = (agencyNodeId?: string, serviceId?: string) => {
    if (agencyNodeId && unavailableNodeMap.value[agencyNodeId]) return true;
    if (serviceId && unavailableServiceMap.value[serviceId]) return true;
    return false;
  };

  const getBookingUnavailableMessage = (agencyNodeId?: string, serviceId?: string) => {
    if (agencyNodeId && unavailableNodeMap.value[agencyNodeId]) {
      return unavailableNodeMap.value[agencyNodeId];
    }
    if (serviceId && unavailableServiceMap.value[serviceId]) {
      return unavailableServiceMap.value[serviceId];
    }
    return DEFAULT_MESSAGE;
  };

  return {
    unavailableNodeMap,
    unavailableServiceMap,
    lastBookingUnavailableEvent,
    markBookingUnavailable,
    isBookingUnavailable,
    getBookingUnavailableMessage,
  };
}
