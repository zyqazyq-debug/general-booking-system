import { ref, type Ref } from 'vue';
import { request } from '@/shared/api/request';
import dayjs from 'dayjs';
import { useBookingUnavailableGuard } from '@/shared/composables/useBookingUnavailableGuard';
import { resolveBookingUnavailable } from '@/shared/utils/booking-unavailable';

interface UseBookingConfirmFlowOptions {
  userStore: any;
  service: Ref<any>;
  selectedDate: Ref<string>;
  selectedSlot: Ref<any>;
  displayPrice: Ref<number>;
}

export function useBookingConfirmFlow(options: UseBookingConfirmFlowOptions) {
  const { markBookingUnavailable, isBookingUnavailable, getBookingUnavailableMessage } =
    useBookingUnavailableGuard();
  const showConfirmDialog = ref(false);
  const confirmContent = ref('');
  const postLoginRedirectKey = 'postLoginRedirect';

  const formatTime = (iso: string) => dayjs(iso).format('HH:mm');

  const resolveCurrentPageUrl = () => {
    const pages = getCurrentPages();
    const currentPage = pages[pages.length - 1] as any;
    const route = currentPage?.route ? `/${currentPage.route}` : '/pages/index/index';
    const options = currentPage?.options || {};
    const query = Object.entries(options)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value ?? ''))}`)
      .join('&');
    return query ? `${route}?${query}` : route;
  };

  const confirmBooking = async () => {
    if (!options.userStore.userInfo) {
      const redirect = resolveCurrentPageUrl();
      uni.setStorageSync(postLoginRedirectKey, redirect);
      uni.navigateTo({ url: `/pages/login/login?redirect=${encodeURIComponent(redirect)}` });
      return false;
    }

    const serviceId = options.service.value?.id;
    if (serviceId && isBookingUnavailable(undefined, serviceId)) {
      uni.showToast({ title: getBookingUnavailableMessage(undefined, serviceId), icon: 'none' });
      return false;
    }

    try {
      const freshService = await request({
        url: `/services/${options.service.value.id}`,
        method: 'GET',
        hideLoading: true,
        hideErrorToast: true,
      });
      if (!freshService?.is_active) {
        uni.showToast({ title: '抱歉，该服务已下架', icon: 'none' });
        options.service.value.is_active = false;
        return false;
      }
    } catch (e: any) {
      const unavailable = resolveBookingUnavailable({ error: e });
      if (unavailable.matched) {
        markBookingUnavailable({
          serviceId: options.service.value?.id || undefined,
          message: unavailable.userMessage,
          scene: 'booking_precheck',
          requestUrl: unavailable.requestUrl || `/services/${options.service.value.id}`,
          statusCode: unavailable.statusCode,
          rawMessage: unavailable.rawMessage,
        });
        console.warn('[BookingUnavailable]', {
          scene: 'booking_precheck',
          requestUrl: unavailable.requestUrl || `/services/${options.service.value.id}`,
          statusCode: unavailable.statusCode,
          errorCode: unavailable.errorCode,
          message: unavailable.rawMessage,
        });
        uni.showToast({ title: unavailable.userMessage, icon: 'none' });
        return false;
      }
      console.warn('Failed to pre-verify service status', e);
      uni.showToast({ title: '服务校验失败，请稍后重试', icon: 'none' });
      return false;
    }

    const dayMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const date = dayjs(options.selectedDate.value);
    const dayText = dayMap[date.day()];

    let content = `确认预约 ${options.service.value.title}\n时间: ${options.selectedDate.value} (${dayText}) ${formatTime(options.selectedSlot.value.start_time)}\n费用: ¥${options.displayPrice.value}`;
    if (options.service.value.deposit_points > 0) {
      content += `\n需冻结定金: ${options.service.value.deposit_points} 信用点`;
    }

    confirmContent.value = content;
    showConfirmDialog.value = true;
    return true;
  };

  const closeConfirmDialog = () => {
    showConfirmDialog.value = false;
  };

  return {
    showConfirmDialog,
    confirmContent,
    confirmBooking,
    closeConfirmDialog,
  };
}
