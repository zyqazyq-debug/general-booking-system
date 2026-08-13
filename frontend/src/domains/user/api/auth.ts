import { request } from '@/utils/request';
import type { LoginResponse, User } from '@/types/api';

type DeviceInfo = Record<string, any>;

export type SocialProvider =
  | 'wechat'
  | 'qq'
  | 'telegram'
  | 'weibo'
  | 'douyin'
  | 'xiaohongshu'
  | 'facebook'
  | 'google'
  | 'apple';

/**
 * 账号密码登录
 */
export const loginApi = (data: {
  username: string;
  password: string;
  deviceInfo?: DeviceInfo;
}) => {
  return request<LoginResponse>({
    url: '/auth/login',
    method: 'POST',
    data,
  });
};

/**
 * 微信模拟登录
 */
export const loginWechatApi = (openid: string, deviceInfo?: DeviceInfo) => {
  return request<LoginResponse>({
    url: '/auth/wechat',
    method: 'POST',
    data: { openid, deviceInfo },
  });
};

/**
 * QQ模拟登录
 */
export const loginQQApi = (openid: string, deviceInfo?: DeviceInfo) => {
  return request<LoginResponse>({
    url: '/auth/qq',
    method: 'POST',
    data: { openid, deviceInfo },
  });
};

/**
 * 手机验证码登录
 */
export const loginPhoneApi = (phone: string, code: string, deviceInfo?: DeviceInfo) => {
  return request<LoginResponse>({
    url: '/auth/phone',
    method: 'POST',
    data: { phone, code, deviceInfo },
  });
};

/**
 * Telegram登录
 */
export const loginTelegramApi = (telegramData: Record<string, any>, deviceInfo?: DeviceInfo) => {
  return request<LoginResponse>({
    url: '/auth/telegram',
    method: 'POST',
    data: { ...telegramData, deviceInfo },
  });
};

export const getTelegramLoginTicketApi = () => {
  return request<{
    ticket_id: string;
    bot_url: string;
    expires_in: number;
  }>({
    url: '/auth/telegram/login-ticket',
    method: 'POST',
  });
};

/**
 * 合并 Telegram 账号到已有手机号账号
 */
export const mergeTelegramAccountApi = (data: { phone: string; code: string }) => {
  return request<LoginResponse>({
    url: '/auth/telegram/merge',
    method: 'POST',
    data,
  });
};

export const bindPhoneApi = (data: { phone: string; code: string }) => {
  return request<LoginResponse>({
    url: '/auth/phone/bind',
    method: 'POST',
    data,
  });
};

export const mergeByPhoneApi = (data: { phone: string; code: string }) => {
  return request<LoginResponse>({
    url: '/auth/account/merge-by-phone',
    method: 'POST',
    data,
  });
};

/**
 * 获取支持的社交登录平台
 */
export const getSocialProvidersApi = () => {
  return request<SocialProvider[]>({
    url: '/auth/social/providers',
    method: 'GET',
  });
};

/**
 * 社交平台 OAuth 登录
 */
export const loginBySocialApi = (data: {
  provider: SocialProvider;
  auth_code: string;
  redirect_uri?: string;
  extra?: Record<string, unknown>;
}) => {
  return request<LoginResponse>({
    url: '/auth/social/login',
    method: 'POST',
    data,
  });
};

/**
 * 发送短信验证码
 */
export const sendSmsCodeApi = (phone: string, scene = 'login') => {
  return request<void>({
    url: '/auth/sms/send-code',
    method: 'POST',
    data: { phone, scene },
  });
};

/**
 * 短信登录
 */
export const loginBySmsApi = (phone: string, code: string) => {
  return request<LoginResponse>({
    url: '/auth/sms/login',
    method: 'POST',
    data: { phone, code },
  });
};

/**
 * 注册
 */
export const registerApi = (data: {
  username: string;
  password: string;
  roles?: string[];
  referrer_id?: string;
  referral_code?: string;
}) => {
  return request<LoginResponse>({
    url: '/auth/register',
    method: 'POST',
    data,
  });
};

export const loginTelegramWebappApi = (initData: string) => {
  return request<{
    user: User;
    access_token: string;
    refresh_token?: string;
  }>({
    url: '/auth/telegram/webapp-login',
    method: 'POST',
    data: { initData },
  });
};
