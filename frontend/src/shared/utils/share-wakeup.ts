import { detectRuntimeProfile, type RuntimeEnv } from '@/utils/runtime-env';
import { toWakeupApp } from './native-wakeup';

type ShareWakeupPayload = {
  url: string;
  title?: string;
  text?: string;
};

type ShareRuntime = RuntimeEnv;

export type ShareWakeupResult = {
  method: 'telegram' | 'native' | 'none' | 'aborted';
  runtime: ShareRuntime;
  hostApp: string;
  os: string;
};

export async function tryWakeShare(payload: ShareWakeupPayload): Promise<ShareWakeupResult> {
  const shareUrl = payload.url.trim();
  const profile = detectRuntimeProfile();
  const runtime = profile.runtime;
  if (!shareUrl) return { method: 'none', runtime, hostApp: profile.hostApp, os: profile.os };

  const shareText = payload.text || payload.title || '';

  if (runtime === 'telegram_webapp') {
    return { method: 'none', runtime, hostApp: profile.hostApp, os: profile.os };
  }

  const wakeupApp = toWakeupApp(profile.hostApp);
  if (wakeupApp && (profile.os === 'ios' || profile.os === 'android')) {
    return { method: 'none', runtime, hostApp: profile.hostApp, os: profile.os };
  }

  if (runtime === 'browser' || runtime === 'unknown') {
    const nativeShare = typeof navigator !== 'undefined' ? (navigator as any).share : null;
    if (typeof nativeShare === 'function') {
      try {
        await nativeShare({
          title: payload.title || '分享',
          text: payload.text || '',
          url: shareUrl,
        });
        return { method: 'native', runtime, hostApp: profile.hostApp, os: profile.os };
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          return { method: 'aborted', runtime, hostApp: profile.hostApp, os: profile.os };
        }
      }
    }
  }

  return { method: 'none', runtime, hostApp: profile.hostApp, os: profile.os };
}

export function formatShareWakeTip(result: ShareWakeupResult): string {
  const runtimeText =
    result.runtime === 'telegram_webapp'
      ? '电报小程序'
      : result.runtime === 'wechat_mini_program'
        ? '微信小程序'
        : result.runtime === 'qq_mini_program'
          ? 'QQ小程序'
        : result.runtime === 'browser'
          ? '浏览器'
          : '未知环境';
  const osText = result.os === 'ios' ? 'iOS' : result.os === 'android' ? 'Android' : '其他系统';
  const hostText =
    result.hostApp === 'telegram'
      ? '电报'
      : result.hostApp === 'wechat'
        ? '微信'
        : result.hostApp === 'qq'
          ? 'QQ'
          : result.hostApp === 'browser'
            ? '浏览器'
            : result.hostApp;

  const actionText =
    result.method === 'telegram'
      ? '已尝试电报分享唤醒'
      : result.method === 'native'
        ? '已尝试系统分享唤醒'
        : result.method === 'aborted'
          ? '已取消系统分享'
          : '请使用下方链接或二维码分享';

  return `当前环境：${runtimeText}/${hostText}/${osText}，${actionText}`;
}
