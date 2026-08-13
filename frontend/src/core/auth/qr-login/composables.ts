import { ref } from 'vue';
import { QrLoginStatus, type QrLoginProvider } from './types';
import { simulateQrScanLogin } from './simulate';

export function useQrLogin() {
  const status = ref<QrLoginStatus>(QrLoginStatus.INIT);
  const user = ref<any>(null);
  const providerRef = ref<QrLoginProvider | null>(null);

  const start = (provider?: QrLoginProvider) => {
    providerRef.value = provider ?? null;
    status.value = QrLoginStatus.SCANNED;
    user.value = null;
  };

  const cancel = () => {
    status.value = QrLoginStatus.CANCELLED;
    user.value = null;
    providerRef.value = null;
  };

  const manualConfirm = async () => {
    if (!providerRef.value) {
      status.value = QrLoginStatus.INIT;
      return;
    }
    try {
      const res = await simulateQrScanLogin(providerRef.value);
      user.value = {
        user: res.user,
        access_token: res.access_token,
        refresh_token: res.refresh_token,
      };
      status.value = QrLoginStatus.CONFIRMED;
    } catch (e) {
      status.value = QrLoginStatus.CANCELLED;
      user.value = null;
      console.error('[QrLogin] simulate confirm failed', e);
    }
  };

  return { status, user, start, cancel, manualConfirm };
}
