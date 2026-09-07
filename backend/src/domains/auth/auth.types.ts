export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    username: string;
    referral_code: string;
    email: string | null;
    roles: string[];
    wallet_balance: number;
    credit_balance: number;
    frozen_credit: number;
  };
}

export type AuthTokenUse = 'access' | 'refresh';

export interface AuthJwtPayload {
  sub: string;
  username: string;
  roles: string[];
  token_use: AuthTokenUse;
  session_id: string;
  jti: string;
  auth_version: number;
}

export interface BindingStatusResponse {
  status: string;
  ticket_id: string;
  message: string;
  [key: string]: unknown;
}

export type BindIdentityProvider = 'phone' | 'wechat' | 'qq' | 'telegram';
export type ScanIdentityProvider = 'wechat' | 'qq' | 'telegram';
