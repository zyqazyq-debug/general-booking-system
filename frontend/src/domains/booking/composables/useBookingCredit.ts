import { ref, computed, type Ref } from 'vue';
import { request } from '@/utils/request';
import { useUserStore } from '@/shared/stores/user';
import { showAppConfirm } from '@/utils/app-confirm';

export function useBookingCredit(service: Ref<any>) {
  const userStore = useUserStore();
  const creditCheck = ref<any>(null);

  const requiredCredit = computed(() =>
    Number(
      (creditCheck.value?.required_credit ?? service.value?.deposit_points) || 0,
    ),
  );
  const availableCredit = computed(() =>
    Number(
      (creditCheck.value?.available_credit ??
        userStore.userInfo?.credit_balance) ||
        0,
    ),
  );
  const creditShortfall = computed(() =>
    Number(Math.max(0, requiredCredit.value - availableCredit.value).toFixed(2)),
  );
  const needPurchaseCredit = computed(
    () => Boolean(userStore.userInfo) && creditShortfall.value > 0,
  );

  const loadCreditCheck = async () => {
    if (!userStore.userInfo?.id || !service.value?.id) return;
    try {
      creditCheck.value = await request({
        url: `/order/credit-check?serviceId=${service.value.id}`,
        method: 'GET',
        hideLoading: true,
        silent: true,
      });
    } catch (e) {
      console.error(e);
    }
  };

  const triggerPurchaseIntent = async () => {
    const res = await showAppConfirm({
      title: '信用点不足',
      content: `当前可用: ${availableCredit.value}\n本次需要: ${requiredCredit.value}\n还差: ${creditShortfall.value}`,
      confirmText: '购买信用点',
      cancelText: '稍后再说'
    });
    if (!res.confirm) return;
    try {
      const intent = await request({
        url: '/users/me/credit/purchase-intent',
        method: 'POST',
        data: { required_credit: creditShortfall.value },
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
  };

  const resetCredit = () => {
    creditCheck.value = null;
  };

  return {
    creditCheck,
    requiredCredit,
    availableCredit,
    creditShortfall,
    needPurchaseCredit,
    loadCreditCheck,
    triggerPurchaseIntent,
    resetCredit,
  };
}
