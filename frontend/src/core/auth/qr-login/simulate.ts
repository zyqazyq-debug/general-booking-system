import type { LoginResponse } from '@/types/api';
import type { QrLoginProvider } from './types';
import { getQrLoginAdapter } from './adapter';

const getMockOpenId = (provider: QrLoginProvider) => {
  if (provider === 'wechat') {
    return 'demo';
  }
  return 'demo';
};

export const simulateQrScanLogin = async (
  provider: QrLoginProvider,
  deviceInfo?: Record<string, unknown>,
): Promise<LoginResponse> => {
  const adapter = getQrLoginAdapter();
  if (!adapter) {
    throw new Error('[QrLogin] adapter not set');
  }
  const openid = getMockOpenId(provider);
  if (provider === 'wechat') {
    return adapter.loginWechat(openid, deviceInfo);
  }
  return adapter.loginQQ(openid, deviceInfo);
};
