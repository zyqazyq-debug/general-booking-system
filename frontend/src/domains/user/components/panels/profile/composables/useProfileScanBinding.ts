import { ref, type Ref } from 'vue';
import { checkIdentityScanStatusApi, startIdentityScanApi } from '../../../../api/identity';
import { resolveApiErrorMessage } from '@/utils/error-code';

type BindProvider = 'wechat' | 'qq' | 'telegram';

interface UseProfileScanBindingOptions {
  userStore: any;
  currentBindProvider: Ref<BindProvider>;
  isMobile: Ref<boolean>;
  onGenerateQr: (data: string) => void;
}

export function useProfileScanBinding(options: UseProfileScanBindingOptions) {
  const bindingIdentity = ref(false);
  const identityScanTicketId = ref('');
  const identityScanQrUrl = ref('');
  const identityScanBotInfo = ref<{ username?: string; name?: string }>({});

  const openTelegramLink = () => {
    if (!identityScanQrUrl.value) return;
    const globalWindow = typeof window !== 'undefined' ? (window as any) : null;
    const tg = globalWindow?.Telegram?.WebApp;
    if (tg && typeof tg.openTelegramLink === 'function') {
      try {
        tg.openTelegramLink(identityScanQrUrl.value);
        return;
      } catch (e) {
        console.error('TG open link error:', e);
      }
    }
    // #ifdef H5
    window.open(identityScanQrUrl.value, '_blank');
    // #endif
    // #ifndef H5
    uni.setClipboardData({
      data: identityScanQrUrl.value,
      success: () => {
        uni.showToast({ title: '链接已复制，请在浏览器打开', icon: 'none' });
      },
    });
    // #endif
  };

  const openTelegramWeb = () => {
    if (!identityScanQrUrl.value) return;
    const url = identityScanQrUrl.value;
    const botMatch = url.match(/t\.me\/([^\?]+)/);
    const tokenMatch = url.match(/start=([^&]+)/);
    if (botMatch && tokenMatch) {
      const botName = botMatch[1];
      const token = tokenMatch[1];
      const webUrl = `https://web.telegram.org/a/#?tgaddr=tg%3A%2F%2Fresolve%3Fdomain%3D${botName}%26start%3D${token}`;
      window.open(webUrl, '_blank');
      return;
    }
    window.open(url, '_blank');
  };

  const resetScanState = () => {
    identityScanTicketId.value = '';
    identityScanQrUrl.value = '';
  };

  const startIdentityScan = async (isAuto = false) => {
    bindingIdentity.value = true;
    try {
      const res = await startIdentityScanApi({ provider: options.currentBindProvider.value });
      identityScanTicketId.value = res.ticket_id;
      identityScanQrUrl.value = res.qr_url || '';
      if (res.extra) {
        identityScanBotInfo.value = {
          username: res.extra.bot_username,
          name: res.extra.bot_name,
        };
      }
      if (options.currentBindProvider.value === 'telegram' && !options.isMobile.value && identityScanQrUrl.value) {
        setTimeout(() => {
          options.onGenerateQr(identityScanQrUrl.value);
        }, 150);
      }
      if (!isAuto) {
        uni.showToast({ title: '已生成绑定链接', icon: 'success' });
      }
    } catch (e: any) {
      const { message: msg } = resolveApiErrorMessage(e, '操作失败');
      uni.showToast({ title: msg, icon: 'none' });
    } finally {
      bindingIdentity.value = false;
    }
  };

  const checkIdentityScanStatus = async (onSuccess: () => void) => {
    if (!identityScanTicketId.value) {
      uni.showToast({ title: '请先发起扫码绑定', icon: 'none' });
      return;
    }
    bindingIdentity.value = true;
    try {
      const statusRes = await checkIdentityScanStatusApi({ ticket_id: identityScanTicketId.value });
      if (statusRes.status === 'success') {
        uni.showToast({ title: '绑定成功', icon: 'success' });
        resetScanState();
        onSuccess();
      } else if (statusRes.status === 'pending') {
        uni.showToast({ title: '等待绑定中', icon: 'none' });
      } else {
        uni.showToast({ title: '绑定超时或已失效', icon: 'none' });
      }
    } catch (e: any) {
      const { message: msg } = resolveApiErrorMessage(e, '查询状态失败');
      uni.showToast({ title: msg, icon: 'none' });
    } finally {
      bindingIdentity.value = false;
    }
  };

  return {
    bindingIdentity,
    identityScanTicketId,
    identityScanQrUrl,
    identityScanBotInfo,
    openTelegramLink,
    openTelegramWeb,
    resetScanState,
    startIdentityScan,
    checkIdentityScanStatus,
  };
}
