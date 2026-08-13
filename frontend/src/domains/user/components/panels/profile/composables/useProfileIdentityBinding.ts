import { computed, ref } from 'vue';
import { detectRuntimeProfile } from '@/utils/runtime-env';
import { unbindIdentityApi } from '../../../../api/identity';
import { showAppConfirm } from '@/utils/app-confirm';
import { useProfilePhoneMerge } from './useProfilePhoneMerge';
import { useProfileScanBinding } from './useProfileScanBinding';

type BindProvider = 'wechat' | 'qq' | 'telegram';

interface UseProfileIdentityBindingOptions {
  t: (key: string) => string;
  userStore: any;
  onSaved: () => void;
  onClose: () => void;
  onGenerateQr: (data: string) => void;
}

export function useProfileIdentityBinding(options: UseProfileIdentityBindingOptions) {
  const showIdentityModal = ref(false);
  const runtimeProfile = ref(detectRuntimeProfile());
  const isMobile = computed(() => runtimeProfile.value.os !== 'other');
  const currentBindProvider = ref<BindProvider>('telegram');
  const phoneModalTitle = computed(() => '绑定或修改手机号');

  const normalizeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const maskAccount = (value: string) => {
    if (!value) return '';
    if (value.length <= 6) return value;
    return `${value.slice(0, 3)}***${value.slice(-3)}`;
  };

  const telegramRuntimeUser = computed(() => {
    if (typeof window === 'undefined') return null;
    return (window as any).Telegram?.WebApp?.initDataUnsafe?.user || null;
  });

  const telegramUsername = computed(() => {
    return normalizeText(options.userStore.userInfo?.telegram_username) || normalizeText(telegramRuntimeUser.value?.username);
  });

  const telegramChatId = computed(() => {
    const profileId = normalizeText(options.userStore.userInfo?.telegram_chat_id);
    if (profileId) return profileId;
    const runtimeId = telegramRuntimeUser.value?.id;
    return runtimeId ? String(runtimeId) : '';
  });

  const telegramAccountDisplay = computed(() => {
    if (telegramUsername.value) return `@${telegramUsername.value}`;
    if (telegramChatId.value) return `ID: ${telegramChatId.value}`;
    const accountUsername = normalizeText(options.userStore.userInfo?.username);
    const tgIdMatch = accountUsername.match(/^tg_(\d+)_/i);
    if (tgIdMatch?.[1]) return `ID: ${tgIdMatch[1]}`;
    return options.t('profile.click_to_bind');
  });

  const wechatAccountDisplay = computed(() => {
    const openid = normalizeText(options.userStore.userInfo?.wechat_openid);
    if (openid) return maskAccount(openid);
    return options.t('profile.click_to_bind');
  });

  const qqAccountDisplay = computed(() => {
    const openid = normalizeText(options.userStore.userInfo?.qq_openid);
    if (openid) return maskAccount(openid);
    return options.t('profile.click_to_bind');
  });

  const providerLabelMap: Record<BindProvider, string> = {
    telegram: 'Telegram',
    wechat: options.t('profile.bind_wechat'),
    qq: 'QQ',
  };

  const identityModalTitle = computed(() => `${providerLabelMap[currentBindProvider.value]}扫码绑定`);
  const identityModalHint = computed(() => {
    if (currentBindProvider.value === 'telegram') {
      return '请使用手机扫描下方二维码，或点击按钮跳转到 Telegram 机器人完成账号确认。';
    }
    if (currentBindProvider.value === 'wechat') {
      return '请使用微信扫码授权绑定。若该微信已绑定其他账号，将提示是否合并。';
    }
    return '请使用QQ扫码授权绑定。若该QQ已绑定其他账号，将提示是否合并。';
  });

  const {
    showMergeModal,
    mergingAccount,
    sendingCode,
    countdown,
    mergeForm,
    bindPhone,
    sendMergeCode,
    submitMerge,
    cleanup: cleanupPhoneMerge,
  } = useProfilePhoneMerge({
    userStore: options.userStore,
    onSaved: options.onSaved,
    onClose: options.onClose,
  });

  const {
    bindingIdentity,
    identityScanTicketId,
    identityScanQrUrl,
    identityScanBotInfo,
    openTelegramLink,
    openTelegramWeb,
    resetScanState,
    startIdentityScan,
    checkIdentityScanStatus: checkScanStatusCore,
  } = useProfileScanBinding({
    userStore: options.userStore,
    currentBindProvider,
    isMobile,
    onGenerateQr: options.onGenerateQr,
  });

  const openIdentityBindModal = (provider: BindProvider) => {
    currentBindProvider.value = provider;
    resetScanState();
    runtimeProfile.value = detectRuntimeProfile();
    showIdentityModal.value = true;
    if (provider === 'telegram') {
      void startIdentityScan(true);
    }
  };

  const handleUnbind = async (provider: BindProvider) => {
    const res = await showAppConfirm({
      title: '确认解绑',
      content: `确定要解绑当前的 ${providerLabelMap[provider]} 账号吗？`
    });
    if (!res.confirm) return;
    try {
      await unbindIdentityApi({ provider });
      uni.showToast({ title: '解绑成功', icon: 'success' });
      await options.userStore.fetchUserInfo();
    } catch (e: any) {
      const msg = e?.data?.message || e?.message || '解绑失败';
      uni.showToast({ title: msg, icon: 'none' });
    }
  };

  const closeIdentityBindModal = () => {
    showIdentityModal.value = false;
    resetScanState();
  };

  const checkIdentityScanStatus = async () => {
    await checkScanStatusCore(closeIdentityBindModal);
  };

  const cleanup = () => {
    cleanupPhoneMerge();
  };

  return {
    showMergeModal,
    showIdentityModal,
    identityScanQrUrl,
    identityScanBotInfo,
    isMobile,
    mergingAccount,
    bindingIdentity,
    sendingCode,
    countdown,
    currentBindProvider,
    mergeForm,
    identityScanTicketId,
    phoneModalTitle,
    telegramAccountDisplay,
    wechatAccountDisplay,
    qqAccountDisplay,
    providerLabelMap,
    identityModalTitle,
    identityModalHint,
    bindPhone,
    openIdentityBindModal,
    handleUnbind,
    openTelegramLink,
    openTelegramWeb,
    closeIdentityBindModal,
    sendMergeCode,
    submitMerge,
    startIdentityScan,
    checkIdentityScanStatus,
    cleanup,
  };
}
