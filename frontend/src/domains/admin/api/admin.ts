import { request } from '@/shared/api/request';
import type { User } from '@/types/api';

export const getAdminUsers = () => {
  return request<User[]>({
    url: '/admin/users',
    method: 'GET',
  });
};

export const getAdminServices = () => request({ url: '/admin/services', method: 'GET' });
export const getAdminOrders = () => request({ url: '/admin/orders', method: 'GET' });
export const getAdminCollections = () => request({ url: '/admin/collections', method: 'GET' });

export const adjustAdminUserCredit = (id: string, amount: number) => {
  return request<void>({
    url: `/admin/users/${id}/credit`,
    method: 'POST',
    data: { amount },
  });
};
