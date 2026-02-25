import { request } from '@/utils/request';
import type { LoginResponse } from '@/types/api';

export const loginApi = (data: { username: string; password: string }): Promise<LoginResponse> => {
  return request({
    url: '/auth/login',
    method: 'POST',
    data
  });
};

export const loginWechatApi = (openid: string) => {
  return request({
    url: '/auth/wechat',
    method: 'POST',
    data: { openid }
  });
};

export const loginQQApi = (openid: string) => {
  return request({
    url: '/auth/qq',
    method: 'POST',
    data: { openid }
  });
};

export const loginPhoneApi = (phone: string, code: string): Promise<LoginResponse> => {
  return request({
    url: '/auth/phone',
    method: 'POST',
    data: { phone, code }
  });
};

export const registerApi = (data: { username: string; password: string }): Promise<LoginResponse> => {
  return request({
    url: '/auth/register',
    method: 'POST',
    data
  });
};

export const addRoleApi = (id: string, role: string) => {
  return request({
    url: `/users/${id}/role`,
    method: 'POST',
    data: { role }
  });
};
