import { request } from '@/utils/request';
import type { LoginResponse } from '@/types/api';

export type IdentityProvider = 'phone' | 'wechat' | 'qq' | 'telegram';

export const bindIdentityApi = (data: {
  provider: IdentityProvider;
  identity: string;
  code?: string;
}) => {
  return request<any>({
    url: '/auth/identity/bind',
    method: 'POST',
    data,
  });
};

export const confirmIdentityMergeApi = (data: {
  provider: IdentityProvider;
  identity: string;
  code?: string;
}) => {
  return request<LoginResponse>({
    url: '/auth/identity/merge-confirm',
    method: 'POST',
    data,
  });
};

export const startIdentityScanApi = (data: { provider: string }) => {
  return request<{
    status: 'ready';
    provider: string;
    ticket_id: string;
    qr_url: string;
    expires_in: number;
    message: string;
    extra?: {
      bot_username?: string;
      bot_name?: string;
    };
  }>({
    url: '/auth/identity/scan/start',
    method: 'POST',
    data,
  });
};

export const checkIdentityScanStatusApi = (data: { ticket_id: string }) => {
  return request<{
    status: 'success' | 'pending' | 'expired';
    message: string;
    user?: any;
    access_token?: string;
    refresh_token?: string;
  }>({
    url: '/auth/identity/scan/status',
    method: 'POST',
    data,
  });
};

export const unbindIdentityApi = (data: { provider: string }) => {
  return request<{
    status: string;
    message: string;
  }>({
    url: '/auth/identity/unbind',
    method: 'POST',
    data,
  });
};
