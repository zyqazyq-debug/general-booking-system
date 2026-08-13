import { request } from '@/utils/request';
import type { ApiResponse, Order, OrderStatus, PaginatedResponse } from '@/types/api';

/**
 * 创建订单
 */
export const createOrder = (data: {
  service_id: string;
  start_time: string;
  end_time: string;
  agency_node_id?: string;
  consumer_id?: string;
  agent_link_token?: string;
  metadata?: Record<string, any>;
}, options?: { hideErrorToast?: boolean; hideLoading?: boolean }) => {
  return request<Order>({
    url: '/order',
    method: 'POST',
    data,
    ...(options || {})
  });
};

/**
 * 获取订单列表
 */
export const getOrders = (params?: {
  role?: 'consumer' | 'owner';
  status?: OrderStatus;
  page?: number;
  limit?: number;
  start_time?: string;
  end_time?: string;
}) => {
  const url = params?.role === 'owner' ? '/order/manage' : '/order/my';
  const page = Math.max(1, Number(params?.page ?? 1));
  const limit = Math.min(500, Math.max(1, Number(params?.limit ?? 10)));
  const query: any = { page, limit };
  if (params?.role === 'owner') {
    if (params?.start_time) query.start_time = params.start_time;
    if (params?.end_time) query.end_time = params.end_time;
  }
  return request<PaginatedResponse<Order>>({
    url,
    method: 'GET',
    params: query
  });
};

/**
 * 获取单个订单详情
 */
export const getOrderDetail = (id: string) => {
  return request<Order>({
    url: `/order/${id}`,
    method: 'GET'
  });
};

/**
 * 取消订单
 */
export const cancelOrder = (id: string, reason?: string) => {
  return request<Order>({
    url: `/order/${id}/cancel`,
    method: 'POST',
    data: { reason }
  });
};

/**
 * 完成订单
 */
export const completeOrder = (id: string) => {
  return request<Order>({
    url: `/order/${id}/complete`,
    method: 'POST'
  });
};

/**
 * 确认订单（任务驱动接口）
 */
export const confirmOrder = (id: string) => {
  return request<Order>({
    url: `/order/${id}/confirm`,
    method: 'POST'
  });
};

/**
 * 标记未到场
 */
export const noShowOrder = (id: string) => {
  return request<Order>({
    url: `/order/${id}/no-show`,
    method: 'POST'
  });
};
