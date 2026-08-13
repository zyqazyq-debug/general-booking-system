import type { Order } from '@/types/api';

export type OrderRole = 'CONSUMER' | 'PROVIDER' | 'AGENT';
export type OrderStatusScene = 'default' | 'distribution-dashboard';

export const ORDER_ROLE_OPTIONS: Array<{ role: OrderRole; label: string }> = [
  { role: 'CONSUMER', label: '消费订单' },
  { role: 'PROVIDER', label: '服务订单' },
  { role: 'AGENT', label: '代理订单' },
];

const ORDER_ROLE_LABELS: Record<OrderRole, string> = ORDER_ROLE_OPTIONS.reduce(
  (result, item) => {
    result[item.role] = item.label;
    return result;
  },
  {} as Record<OrderRole, string>,
);

const DEFAULT_STATUS_META: Record<string, { label: string; className: string }> = {
  PENDING: { label: '待确认', className: 'status-pending' },
  RESERVED: { label: '已预约', className: 'status-reserved' },
  COMPLETED: { label: '已完成', className: 'status-completed' },
  FORFEITED: { label: '已违约', className: 'status-danger' },
  DISPUTED: { label: '争议中', className: 'status-warning' },
  CANCELLED: { label: '已取消', className: 'status-gray' },
};

const DISTRIBUTION_STATUS_LABELS: Record<string, string> = {
  PENDING: '待入账',
  COMPLETED: '已入账',
  CANCELLED: '已取消',
};

export interface DistributionDashboardOrderItem {
  orderId: string;
  amount: number;
  createdAt: string;
  status: string;
  statusLabel: string;
  statusClassName: string;
  serviceTitle: string;
}

export interface DistributionDashboardStats {
  totalOrders: number;
  totalRevenue: number;
  orders: DistributionDashboardOrderItem[];
}

export function getOrderRoleLabel(role?: string, fallback = ORDER_ROLE_LABELS.CONSUMER) {
  return ORDER_ROLE_LABELS[(role || '') as OrderRole] || fallback;
}

export function getOrderListTitle(options: {
  tab?: string;
  hideTabs?: boolean;
  title?: string;
}) {
  if (options.title) return options.title;
  if (!options.hideTabs) return '我的订单';
  return getOrderRoleLabel(options.tab);
}

export function getOrderStatusMeta(status?: string, scene: OrderStatusScene = 'default') {
  const normalizedStatus = typeof status === 'string' ? status.toUpperCase() : '';
  const fallbackLabel = normalizedStatus || '-';
  const baseMeta = DEFAULT_STATUS_META[normalizedStatus];

  if (scene === 'distribution-dashboard') {
    return {
      label: DISTRIBUTION_STATUS_LABELS[normalizedStatus] || fallbackLabel,
      className: baseMeta?.className || 'status-gray',
    };
  }

  return {
    label: baseMeta?.label || fallbackLabel,
    className: baseMeta?.className || 'status-gray',
  };
}

export function buildDistributionDashboardStats(source: Array<Order | Record<string, any>>): DistributionDashboardStats {
  const mapped = source
    .filter((item) => (Array.isArray(item?.roles) ? item.roles.includes('AGENT') : false))
    .map((item) => {
      const amount = Number(item?.commission?.AGENT?.markup_amount ?? 0);
      const { label, className } = getOrderStatusMeta(String(item?.status || ''), 'distribution-dashboard');
      return {
        orderId: String(item?.id || ''),
        amount: Number.isFinite(amount) ? amount : 0,
        createdAt: String(item?.created_at || ''),
        status: String(item?.status || ''),
        statusLabel: label,
        statusClassName: className,
        serviceTitle: String(item?.service?.title || item?.service_snapshot?.title || ''),
      };
    })
    .filter((item) => item.orderId);

  const totalRevenue = mapped.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return {
    totalOrders: mapped.length,
    totalRevenue: Number(totalRevenue.toFixed(2)),
    orders: mapped,
  };
}
