import { computed, nextTick, onMounted, ref, watch, type Ref } from 'vue';
import { syncUserLocale } from '@/core/auth/user-session-effects';
import { getOrderRoleLabel } from '@/domains/order';

interface UseProfilePanelStateOptions {
  userStore: any;
  locale: Ref<string>;
}

export function useProfilePanelState(options: UseProfilePanelStateOptions) {
  const showProfileDrawer = ref(false);
  const showHelpDrawer = ref(false);
  const showReferralIncomeModal = ref(false);
  const showOrderListModal = ref(false);
  const showOrderDetailModal = ref(false);

  const orderModalRole = ref('CONSUMER');
  const selectedOrderId = ref('');
  const creditReady = ref(false);
  const activeReservedOrders = ref(0);
  const dynamicFrozenCredit = ref(0);
  const langOptions = [
    { label: '简体中文', value: 'zh-CN' },
    { label: 'English', value: 'en-US' },
  ];
  const currentLangLabel = computed(() => {
    return langOptions.find((item) => item.value === options.locale.value)?.label || '简体中文';
  });
  const totalCredit = computed(() => {
    const available = Number(options.userStore.userInfo?.credit_balance || 0);
    const frozen = Number(dynamicFrozenCredit.value || options.userStore.userInfo?.frozen_credit || 0);
    return (available + frozen).toFixed(2);
  });

  const orderListTitle = computed(() => getOrderRoleLabel(orderModalRole.value));

  const loadProfileStats = async (force = false) => {
    try {
      const res = await options.userStore.refreshUserInfo(force);
      if (res) {
        dynamicFrozenCredit.value = Number(res?.frozen_credit || options.userStore.userInfo?.frozen_credit || 0);
        activeReservedOrders.value = Number(res?.active_reserved_orders || 0);
      }
      creditReady.value = true;
    } catch {
      creditReady.value = true;
    }
  };

  let currentRefreshPromise: Promise<void> | null = null;

  const refresh = (force = false) => {
    if (currentRefreshPromise) return currentRefreshPromise;
    currentRefreshPromise = (async () => {
      try {
        await loadProfileStats(force);
      } finally {
        currentRefreshPromise = null;
      }
    })();
    return currentRefreshPromise;
  };

  const goToSettings = () => {
    showProfileDrawer.value = true;
  };

  const onProfileSaved = () => {
    void loadProfileStats(true);
  };

  const recharge = () => {
    uni.showToast({ title: '充值功能开发中', icon: 'none' });
  };

  const goToOrder = (role: string) => {
    orderModalRole.value = role;
    selectedOrderId.value = '';
    showOrderDetailModal.value = false;
    showOrderListModal.value = true;
  };

  const onOrderClickInModal = (payload: { id: string; role: string }) => {
    selectedOrderId.value = payload.id;
    orderModalRole.value = payload.role;
    nextTick(() => {
      showOrderDetailModal.value = true;
    });
  };

  const onOrderDetailClose = () => {
    showOrderDetailModal.value = false;
    selectedOrderId.value = '';
  };

  const goToReferral = () => {
    showReferralIncomeModal.value = true;
  };

  const goToHelp = () => {
    showHelpDrawer.value = true;
  };

  const onLangChange = async (e: any) => {
    const index = Number(e?.detail?.value ?? 0);
    const target = langOptions[index];
    if (!target) return;
    try {
      await syncUserLocale(options.userStore, target.value);
      options.locale.value = target.value;
    } catch {
      uni.showToast({ title: '语言保存失败', icon: 'none' });
    }
  };

  const handleLogout = () => {
    options.userStore.logout();
    uni.reLaunch({ url: '/pages/login/login' });
  };

  watch(
    () => options.userStore.lastRefreshTime,
    (newVal, oldVal) => {
      if (newVal === 0 && oldVal !== 0) {
        void refresh(false);
      }
    },
  );

  onMounted(() => {
    void refresh(false);
    if (typeof window === 'undefined') return;
    const hash = window.location.hash || '';
    const queryStr = hash.includes('?') ? hash.split('?')[1] : '';
    const params = new URLSearchParams(queryStr);
    const action = params.get('action');
    if (action === 'referral') {
      setTimeout(() => {
        goToReferral();
      }, 500);
    }
  });

  return {
    showProfileDrawer,
    showHelpDrawer,
    showReferralIncomeModal,
    showOrderListModal,
    showOrderDetailModal,
    orderModalRole,
    selectedOrderId,
    creditReady,
    activeReservedOrders,
    dynamicFrozenCredit,
    langOptions,
    currentLangLabel,
    totalCredit,
    orderListTitle,
    goToSettings,
    onProfileSaved,
    recharge,
    goToOrder,
    onOrderClickInModal,
    onOrderDetailClose,
    goToReferral,
    goToHelp,
    onLangChange,
    handleLogout,
    refresh,
  };
}
