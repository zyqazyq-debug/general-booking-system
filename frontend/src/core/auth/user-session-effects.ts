import { watch } from 'vue';
import { i18n } from '@/core/i18n/instance';
import type { UserProfile } from '@/types/api';

interface TelegramWebappLoginResponse {
  user: UserProfile;
  access_token: string;
  refresh_token?: string;
}

interface UserSessionEffectsApiProvider {
  updateUserById: (id: string, data: any) => Promise<any>;
  loginTelegramWebappApi: (initData: string) => Promise<TelegramWebappLoginResponse>;
}

interface UserSessionStore {
  token: string;
  userInfo: UserProfile | null;
  locale: string;
  login: (user: UserProfile, accessToken: string, refreshToken: string) => void;
  setUserInfo: (user: UserProfile) => void;
  setLocaleState: (locale: string) => void;
  refreshUserInfo: (force?: boolean) => Promise<UserProfile | null>;
}

let apiProvider: UserSessionEffectsApiProvider | null = null;

export const injectUserSessionEffectsApi = (provider: UserSessionEffectsApiProvider) => {
  apiProvider = provider;
};

const mapUniLocale = (locale: string) => {
  const normalized = String(locale || '').toLowerCase();
  if (normalized.startsWith('zh')) return 'zh-Hans';
  if (normalized.startsWith('en')) return 'en';
  return locale;
};

const applyRuntimeLocale = (locale: string) => {
  const normalized = locale || 'zh-CN';
  if (i18n.global) {
    // @ts-ignore
    i18n.global.locale.value = normalized;
  }
  if (typeof (uni as any).setLocale === 'function') {
    const uniLocale = mapUniLocale(normalized);
    try {
      (uni as any).setLocale(uniLocale);
    } catch {
      try {
        (uni as any).setLocale({ locale: uniLocale });
      } catch {
        void 0;
      }
    }
  }
  uni.setStorageSync('locale', normalized);
};

const isGuestUnboundUser = (user: UserProfile | null) => {
  if (!user) return false;
  const candidate = user as UserProfile & Record<string, any>;
  const isGuest =
    String(user.username || '').startsWith('guest_') ||
    String(candidate.nickname || '') === '游客用户';
  const isVerified = Boolean(candidate.is_verified);
  const hasBind =
    Boolean(candidate.phone) ||
    Boolean(candidate.telegram_chat_id) ||
    Boolean(candidate.wechat_openid) ||
    Boolean(candidate.qq_openid);
  return isGuest && !isVerified && !hasBind;
};

const promptGuestBinding = (user: UserProfile | null) => {
  if (!isGuestUnboundUser(user)) return;
  const userId = String(user?.id || '');
  const key = `guest_bind_prompt_shown_${userId}`;
  if (uni.getStorageSync(key)) return;

  uni.setStorageSync(key, '1');
  setTimeout(() => {
    uni.showModal({
      title: '已创建临时账号',
      content:
        '你当前是临时访客账号（无密码/未绑定）。如果清理浏览器数据或换设备，将无法找回收藏/订单记录。建议立即绑定手机号或 Telegram/微信/QQ。',
      confirmText: '去绑定',
      cancelText: '稍后',
      success: (result) => {
        if (result.confirm) {
          uni.redirectTo({ url: '/pages/user/profile' });
        }
      },
    });
  }, 200);
};

export const initializeUserSessionEffects = (userStore: UserSessionStore) => {
  watch(
    () => userStore.locale,
    (locale) => {
      if (!locale) return;
      applyRuntimeLocale(locale);
    },
    { immediate: true },
  );

  let initialized = false;
  watch(
    () => `${userStore.token || ''}:${userStore.userInfo?.id || ''}`,
    () => {
      if (!initialized) {
        initialized = true;
        return;
      }
      if (!userStore.token || !userStore.userInfo) return;
      promptGuestBinding(userStore.userInfo);
    },
  );
};

export const syncUserLocale = async (userStore: UserSessionStore, locale: string) => {
  const previousLocale = userStore.locale;
  userStore.setLocaleState(locale);
  const user = userStore.userInfo;

  if (!user?.id || !apiProvider) {
    return;
  }

  try {
    const updated = await apiProvider.updateUserById(user.id, { locale });
    if (updated && typeof updated === 'object') {
      userStore.setUserInfo({
        ...user,
        ...updated,
        locale,
      });
      return;
    }
    userStore.setUserInfo({
      ...user,
      locale,
    });
  } catch (error) {
    userStore.setLocaleState(previousLocale);
    throw error;
  }
};

export const loginWithTelegramWebApp = async (userStore: UserSessionStore, initData: string) => {
  if (!apiProvider) {
    throw new Error('User session effects API provider not injected');
  }

  try {
    const result = await apiProvider.loginTelegramWebappApi(initData);
    if (!result?.access_token) {
      return false;
    }

    userStore.login(result.user, result.access_token, result.refresh_token || '');
    void userStore.refreshUserInfo();
    return true;
  } catch (error) {
    console.error('TG Login API Failed', error);
    throw error;
  }
};
