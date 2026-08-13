import { request } from '@/utils/request';
import type { User } from '@/types/api';

/**
 * 获取个人资料
 */
export const getProfile = () => {
  return request<User>({
    url: '/users/profile',
    method: 'GET',
  });
};

/**
 * 更新个人资料
 */
export const updateProfile = (data: Partial<User>) => {
  return request<User>({
    url: '/users/profile',
    method: 'PATCH',
    data,
  });
};

/**
 * 修改密码
 */
export const changePassword = (data: {
  oldPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}) => {
  return request<void>({
    url: '/users/change-password',
    method: 'POST',
    data,
  });
};

export const getUserById = (id: string) => {
  return request<User>({
    url: `/users/${id}`,
    method: 'GET',
  });
};

export const updateUserById = (id: string, data: Partial<User>) => {
  return request<User>({
    url: `/users/${id}`,
    method: 'PATCH',
    data,
  });
};
