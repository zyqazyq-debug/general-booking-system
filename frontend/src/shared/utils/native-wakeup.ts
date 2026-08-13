import type { HostApp, MobileOS } from '@/utils/runtime-env';

export type WakeupApp = 'telegram' | 'wechat' | 'qq';

type WakeupPayload = {
  url?: string;
  text?: string;
};

export type NativeWakeupResult = {
  app: WakeupApp;
  method: 'scheme' | 'intent' | 'universal' | 'none';
  attempted: boolean;
};

function encode(value: string): string {
  return encodeURIComponent(value || '');
}

function buildTelegramCandidates(os: MobileOS, payload: WakeupPayload): Array<{ method: NativeWakeupResult['method']; url: string }> {
  const shareUrl = payload.url || '';
  const shareText = payload.text || '';
  const textPart = shareText ? `&text=${encode(shareText)}` : '';
  if (os === 'android') {
    return [
      { method: 'intent', url: `intent://msg_url?url=${encode(shareUrl)}${textPart}#Intent;scheme=tg;package=org.telegram.messenger;end` },
      { method: 'scheme', url: `tg://msg_url?url=${encode(shareUrl)}${textPart}` },
      { method: 'universal', url: `https://t.me/share/url?url=${encode(shareUrl)}${textPart}` },
    ];
  }
  if (os === 'ios') {
    return [
      { method: 'scheme', url: `tg://msg_url?url=${encode(shareUrl)}${textPart}` },
      { method: 'universal', url: `https://t.me/share/url?url=${encode(shareUrl)}${textPart}` },
    ];
  }
  return [];
}

function buildWechatCandidates(os: MobileOS): Array<{ method: NativeWakeupResult['method']; url: string }> {
  if (os === 'android') {
    return [
      { method: 'intent', url: 'intent://#Intent;scheme=weixin;package=com.tencent.mm;end' },
      { method: 'scheme', url: 'weixin://' },
    ];
  }
  if (os === 'ios') {
    return [
      { method: 'scheme', url: 'weixin://' },
      { method: 'universal', url: 'https://weixin.qq.com/' },
    ];
  }
  return [];
}

function buildQQCandidates(os: MobileOS, payload: WakeupPayload): Array<{ method: NativeWakeupResult['method']; url: string }> {
  const shareUrl = payload.url || '';
  const shareText = payload.text || '';
  if (os === 'android') {
    return [
      { method: 'intent', url: `intent://share/to_fri?src_type=web&version=1&file_type=news&url=${encode(shareUrl)}&description=${encode(shareText)}#Intent;scheme=mqqapi;package=com.tencent.mobileqq;end` },
      { method: 'scheme', url: `mqqapi://share/to_fri?src_type=web&version=1&file_type=news&url=${encode(shareUrl)}&description=${encode(shareText)}` },
      { method: 'scheme', url: 'mqq://' },
    ];
  }
  if (os === 'ios') {
    return [
      { method: 'scheme', url: `mqqapi://share/to_fri?src_type=web&version=1&file_type=news&url=${encode(shareUrl)}&description=${encode(shareText)}` },
      { method: 'scheme', url: 'mqq://' },
    ];
  }
  return [];
}

function launchLink(url: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.location.href = url;
    return true;
  } catch (_) {
    return false;
  }
}

export function wakeNativeApp(app: WakeupApp, os: MobileOS, payload: WakeupPayload = {}): NativeWakeupResult {
  const candidates =
    app === 'telegram'
      ? buildTelegramCandidates(os, payload)
      : app === 'wechat'
        ? buildWechatCandidates(os)
        : buildQQCandidates(os, payload);

  for (const candidate of candidates) {
    if (launchLink(candidate.url)) {
      return { app, method: candidate.method, attempted: true };
    }
  }

  return { app, method: 'none', attempted: false };
}

export function toWakeupApp(hostApp: HostApp): WakeupApp | null {
  if (hostApp === 'telegram') return 'telegram';
  if (hostApp === 'wechat') return 'wechat';
  if (hostApp === 'qq') return 'qq';
  return null;
}
