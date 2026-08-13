import dayjs from 'dayjs';
import { getOrderRoleLabel, getOrderStatusMeta } from './useOrderScene';

export function useOrderDisplay() {
  const formatStatus = (status: string) => getOrderStatusMeta(status).label;

  const getStatusClass = (status: string) => getOrderStatusMeta(status).className;

  const formatTime = (time: string) => (time ? dayjs(time).format('YYYY-MM-DD HH:mm') : '-');

  const formatTimeRange = (start: string, end: string) => {
    if (!start || !end) return '-';
    const s = dayjs(start);
    const e = dayjs(end);
    if (s.isSame(e, 'day')) {
      return `${s.format('YYYY-MM-DD HH:mm')} - ${e.format('HH:mm')}`;
    }
    return `${s.format('YYYY-MM-DD HH:mm')} - ${e.format('MM-DD HH:mm')}`;
  };

  const formatTimeRangeCompact = (start: string, end: string) => {
    if (!start || !end) return '-';
    const s = dayjs(start);
    const e = dayjs(end);
    if (s.isSame(e, 'day')) {
      return `${s.format('MM-DD HH:mm')} - ${e.format('HH:mm')}`;
    }
    return `${s.format('MM-DD HH:mm')} - ${e.format('MM-DD HH:mm')}`;
  };

  const getDuration = (start: string, end: string) => {
    if (!start || !end) return '-';
    const diff = dayjs(end).diff(dayjs(start), 'minute');
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return h > 0 ? `${h}小时${m}分` : `${m}分钟`;
  };

  const getOrderTypeLabel = (role: string, hasAgentLink: boolean) => {
    if (role === 'CONSUMER') return hasAgentLink ? '推荐订单' : '普通订单';
    return getOrderRoleLabel(role, '-');
  };

  const getCancelActorLabel = (orderData: any) => {
    const roleValue = orderData?.metadata?.cancelled_role;
    const providerName = orderData?.service?.owner?.nickname || orderData?.service?.owner?.username;
    const consumerName = orderData?.consumer?.nickname || orderData?.consumer?.username;
    if (roleValue === 'PROVIDER') {
      return providerName ? `服务者（${providerName}）` : '服务者';
    }
    if (roleValue === 'CONSUMER') {
      return consumerName ? `消费者（${consumerName}）` : '消费者';
    }
    const cancelledBy = orderData?.metadata?.cancelled_by;
    if (cancelledBy && cancelledBy === orderData?.service?.owner?.id) {
      return providerName ? `服务者（${providerName}）` : '服务者';
    }
    if (cancelledBy && cancelledBy === orderData?.consumer?.id) {
      return consumerName ? `消费者（${consumerName}）` : '消费者';
    }
    if (cancelledBy) {
      return `用户（${String(cancelledBy).slice(0, 8)}）`;
    }
    return '-';
  };

  return {
    formatStatus,
    getStatusClass,
    formatTime,
    formatTimeRange,
    formatTimeRangeCompact,
    getDuration,
    getOrderTypeLabel,
    getCancelActorLabel,
  };
}
