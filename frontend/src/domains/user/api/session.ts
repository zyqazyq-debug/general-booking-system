import { request } from '@/utils/request';

/**
 * 刷新 Token
 */
export const refreshToken = (refreshTokenValue: string) => {
  return request<{ access_token: string }>({
    url: '/auth/refresh',
    method: 'POST',
    data: { refresh_token: refreshTokenValue },
  });
};
