import type { LoginResponse } from '@/types/api';
import type { QrLoginProvider } from './types';

export interface QrLoginAdapter {
  loginWechat: (openid: string, deviceInfo?: Record<string, unknown>) => Promise<LoginResponse>;
  loginQQ: (openid: string, deviceInfo?: Record<string, unknown>) => Promise<LoginResponse>;
}

let adapter: QrLoginAdapter | null = null;

export const setQrLoginAdapter = (a: QrLoginAdapter) => {
  adapter = a;
};

export const getQrLoginAdapter = (): QrLoginAdapter | null => adapter;

