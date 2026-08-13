export const AUTH_SOCIAL_LOGIN_SUCCEEDED_EVENT = 'auth.social.login.succeeded';

export type AuthSocialLoginSucceededEvent = {
  eventVersion: 1;
  requestId: string;
  provider: 'wechat' | 'qq';
  userId: string;
  username: string;
  deviceInfo?: Record<string, unknown>;
  timestamp: string;
};
