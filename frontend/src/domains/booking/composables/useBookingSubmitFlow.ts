import { type Ref } from 'vue';
import { request } from '@/shared/api/request';
import { createOrder } from '@/domains/order';
import { showAppConfirm } from '@/utils/app-confirm';
import { useBookingUnavailableGuard } from '@/shared/composables/useBookingUnavailableGuard';
import { resolveBookingUnavailable } from '@/shared/utils/booking-unavailable';

interface UseBookingSubmitFlowOptions {
  userStore: any;
  service: Ref<any>;
  agencyNodeId: Ref<string>;
  agentLinkToken: Ref<string>;
  selectedDate: Ref<string>;
  selectedSlot: Ref<any>;
  onSuccess: () => void;
  onClose: () => void;
}

export function useBookingSubmitFlow(options: UseBookingSubmitFlowOptions) {
  const { markBookingUnavailable } = useBookingUnavailableGuard();

  const executeBooking = async () => {
    try {
      const orderData: any = {
        service_id: options.service.value.id,
        consumer_id: options.userStore.userInfo.id,
        start_time: options.selectedSlot.value.start_time,
        end_time: options.selectedSlot.value.end_time,
      };

      if (options.agencyNodeId.value) orderData.agency_node_id = options.agencyNodeId.value;

      await createOrder(orderData, { hideErrorToast: true });
      try {
        await options.userStore.refreshUserInfo();
      } catch (refreshErr) {
        console.error(refreshErr);
      }

      uni.showToast({ title: '预约成功!', icon: 'success' });
      options.onSuccess();
      options.onClose();
    } catch (e: any) {
      console.error(e);
      const availableCredit = Number(e?.available_credit ?? e?.data?.available_credit);
      const requiredCredit = Number(e?.required_credit ?? e?.data?.required_credit);
      const shortfall = Number(e?.shortfall ?? e?.data?.shortfall);
      const purchaseEndpoint = e?.purchase_endpoint || e?.data?.purchase_endpoint;
      const creditErrorCode = e?.error_code || e?.data?.error_code;
      if (creditErrorCode === 'INSUFFICIENT_CREDIT' && Number.isFinite(availableCredit) && Number.isFinite(requiredCredit)) {
        const confirmRes = await showAppConfirm({
          title: '信用点不足',
          content: `当前可用: ${availableCredit}\n本次需要: ${requiredCredit}\n还差: ${Number.isFinite(shortfall) ? shortfall : Math.max(0, requiredCredit - availableCredit)}`,
          confirmText: '购买信用点',
          cancelText: '稍后再说',
        });
        if (!confirmRes.confirm) return;
        try {
          const intent = await request({
            url: purchaseEndpoint || '/users/me/credit/purchase-intent',
            method: 'POST',
            data: {
              required_credit: Number.isFinite(shortfall) ? shortfall : Math.max(0, requiredCredit - availableCredit),
            },
            hideLoading: true,
          });
          uni.showToast({
            title: intent?.message || '购买接口预留已创建',
            icon: 'none',
          });
        } catch (intentErr: any) {
          console.error(intentErr);
          uni.showToast({ title: '购买接口调用失败', icon: 'none' });
        }
        return;
      }
      const unavailable = resolveBookingUnavailable({ error: e });
      if (unavailable.matched) {
        markBookingUnavailable({
          agencyNodeId: options.agencyNodeId.value || undefined,
          serviceId: options.service.value?.id || undefined,
          message: unavailable.userMessage,
          scene: 'booking_submit',
          requestUrl: unavailable.requestUrl || '/orders',
          statusCode: unavailable.statusCode,
          rawMessage: unavailable.rawMessage,
        });
        console.warn('[BookingUnavailable]', {
          scene: 'booking_submit',
          requestUrl: unavailable.requestUrl || '/orders',
          statusCode: unavailable.statusCode,
          errorCode: unavailable.errorCode,
          message: unavailable.rawMessage,
        });
        uni.showToast({
          title: unavailable.userMessage,
          icon: 'none',
        });
        return;
      }

      const rawMessage = unavailable.rawMessage;
      let msg = rawMessage || 'booking_failed';
      if (msg === 'booking_failed') msg = '预约失败';
      else if (msg === 'Insufficient credit') msg = '信用分不足';
      else if (msg === 'Service is currently unavailable') msg = '服务暂不可用';
      uni.showToast({ title: msg, icon: 'none' });
    }
  };

  return {
    executeBooking,
  };
}
