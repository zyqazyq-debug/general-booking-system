import { type Ref } from 'vue';
import dayjs from 'dayjs';
import {
  cancelOrder as cancelOrderApi,
  completeOrder as completeOrderApi,
  confirmOrder as confirmOrderApi,
  noShowOrder as noShowOrderApi,
} from '../api/order';
import { showAppConfirm } from '@/utils/app-confirm';
import { resolveApiErrorMessage } from '@/utils/error-code';

interface UseOrderListActionsOptions {
  currentTab: Ref<string>;
  scene: Ref<'default' | 'provider-manage'>;
  hiddenProviderIds: Ref<string[]>;
  userStore: any;
  refreshData: () => Promise<void>;
}

export function useOrderListActions(options: UseOrderListActionsOptions) {
  const isProviderManageScene = () =>
    options.currentTab.value === 'PROVIDER' && options.scene.value === 'provider-manage';

  const canCancel = (item: any) => options.currentTab.value === 'CONSUMER' && item.status === 'RESERVED';
  const canConsumerComplete = (_item: any) => false;
  const canProviderCancel = (item: any) =>
    !isProviderManageScene() && options.currentTab.value === 'PROVIDER' && (item.status === 'PENDING' || item.status === 'RESERVED');
  const canProviderConfirm = (item: any) => isProviderManageScene() && item.status === 'PENDING';
  const canProviderNoShow = (item: any) => isProviderManageScene() && item.status === 'RESERVED';
  const canComplete = (item: any) => {
    if (options.currentTab.value !== 'PROVIDER') return false;
    if (isProviderManageScene()) return item.status === 'RESERVED';
    return item.status === 'RESERVED' || item.status === 'PENDING';
  };
  const canProviderComplete = (item: any) => !dayjs().isBefore(dayjs(item.start_time)) && canComplete(item);
  const canProviderDelete = (item: any) =>
    !isProviderManageScene() &&
    options.currentTab.value === 'PROVIDER' &&
    ['COMPLETED', 'FORFEITED', 'DISPUTED', 'CANCELLED'].includes(item.status);

  const cancelOrder = async (item: any) => {
    let content = '确定要取消预约吗？';
    if (item.service && item.service.cancellation_policy) {
      const policy = item.service.cancellation_policy;
      if (policy.penalty_percent > 0) {
        const now = new Date();
        const start = new Date(item.start_time);
        const diffMinutes = (start.getTime() - now.getTime()) / 60000;
        const window = policy.window_minutes || 0;
        if (diffMinutes < window) {
          const penalty = (item.frozen_points * policy.penalty_percent) / 100;
          content = `注意：当前取消将扣除 ${penalty.toFixed(2)} 信用点（违约金 ${policy.penalty_percent}%），确定继续吗？`;
        }
      }
    }
    const res = await showAppConfirm({
      title: '取消预约',
      content,
      editable: true,
      placeholderText: '请输入取消原因（选填）',
      cancelText: '返回',
    });
    if (!res.confirm) return;
    try {
      await cancelOrderApi(item.id, res.content);
      await options.userStore.refreshUserInfo();
      uni.showToast({ title: '已取消', icon: 'success' });
      await options.refreshData();
    } catch (e) {
      const { message: msg } = resolveApiErrorMessage(e, '操作失败');
      uni.showToast({ title: msg, icon: 'none' });
    }
  };

  const providerCancel = async (item: any) => {
    const res = await showAppConfirm({
      title: '取消订单',
      content: '确认取消该订单？将释放时间并退还信用点',
      editable: true,
      placeholderText: '请输入取消原因（选填）',
      cancelText: '返回',
    });
    if (!res.confirm) return;
    try {
      await cancelOrderApi(item.id, res.content);
      await options.userStore.refreshUserInfo();
      uni.showToast({ title: '已取消', icon: 'success' });
      await options.refreshData();
    } catch (e) {
      const { message: msg } = resolveApiErrorMessage(e, '操作失败');
      uni.showToast({ title: msg, icon: 'none' });
    }
  };

  const providerConfirm = async (item: any) => {
    const res = await showAppConfirm({
      title: '确认预约',
      content: '确认接受该订单并锁定服务时段？',
    });
    if (!res.confirm) return;
    try {
      await confirmOrderApi(item.id);
      await options.userStore.refreshUserInfo();
      uni.showToast({ title: '已确认', icon: 'success' });
      await options.refreshData();
    } catch (e) {
      const { message: msg } = resolveApiErrorMessage(e, '操作失败');
      uni.showToast({ title: msg, icon: 'none' });
    }
  };

  const completeOrder = async (item: any) => {
    if (options.currentTab.value === 'PROVIDER' && !canProviderComplete(item)) {
      uni.showToast({ title: '未到开始时间，暂不能完成', icon: 'none' });
      return;
    }
    const res = await showAppConfirm({
      title: '完成订单',
      content: '确认标记该订单为已完成？',
    });
    if (!res.confirm) return;
    try {
      if (options.currentTab.value === 'CONSUMER') {
        await confirmOrderApi(item.id);
      } else {
        await completeOrderApi(item.id);
      }
      await options.userStore.refreshUserInfo();
      uni.showToast({ title: '已完成', icon: 'success' });
      await options.refreshData();
    } catch (e) {
      const { message: msg } = resolveApiErrorMessage(e, '操作失败');
      uni.showToast({ title: msg, icon: 'none' });
    }
  };

  const providerNoShow = async (item: any) => {
    const res = await showAppConfirm({
      title: '标记违约',
      content: '确认标记该订单为未到场违约？',
    });
    if (!res.confirm) return;
    try {
      await noShowOrderApi(item.id);
      await options.userStore.refreshUserInfo();
      uni.showToast({ title: '已标记', icon: 'success' });
      await options.refreshData();
    } catch (e) {
      const { message: msg } = resolveApiErrorMessage(e, '操作失败');
      uni.showToast({ title: msg, icon: 'none' });
    }
  };

  const hideOrder = async (item: any) => {
    const res = await showAppConfirm({
      title: '删除订单',
      content: '删除后该订单将不再显示（记录仍保留）',
    });
    if (!res.confirm) return;
    const set = new Set(options.hiddenProviderIds.value);
    set.add(item.id);
    options.hiddenProviderIds.value = Array.from(set);
    uni.setStorageSync('hidden_orders_provider', JSON.stringify(options.hiddenProviderIds.value));
    uni.showToast({ title: '已删除', icon: 'success' });
  };

  return {
    canCancel,
    canConsumerComplete,
    canProviderCancel,
    canProviderConfirm,
    canProviderNoShow,
    canProviderDelete,
    canComplete,
    canProviderComplete,
    cancelOrder,
    providerCancel,
    providerConfirm,
    completeOrder,
    providerNoShow,
    hideOrder,
  };
}
