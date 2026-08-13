import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { UserProfile } from '@/types/api';

export interface UserStoreApiProvider {
  getUserById: (id: string) => Promise<UserProfile>;
  updateUserById?: (id: string, data: any) => Promise<any>;
  loginTelegramWebappApi?: (initData: string) => Promise<any>;
}

let apiProvider: UserStoreApiProvider | null = null;

export const injectUserApi = (provider: UserStoreApiProvider) => {
  apiProvider = provider;
};

const CACHE_TTL = 300000;
const DEFAULT_ROLE = 'CONSUMER';
const DEFAULT_LOCALE = 'zh-CN';

const parseStoredUser = (value: any): UserProfile | null => {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as UserProfile;
    } catch {
      return null;
    }
  }
  return value as UserProfile;
};

const resolveInitialLocale = (user: UserProfile | null) => {
  const storedLocale = String(uni.getStorageSync('locale') || '');
  if (storedLocale) return storedLocale;
  if (user?.locale) return user.locale;
  const sys = uni.getSystemInfoSync();
  const language = String(sys.language || DEFAULT_LOCALE);
  return language.startsWith('zh') ? 'zh-CN' : 'en-US';
};

export const useUserStore = defineStore('user', () => {
  const initialUser = parseStoredUser(uni.getStorageSync('userInfo'));
  const userInfo = ref<UserProfile | null>(initialUser);
  const token = ref<string>(String(uni.getStorageSync('token') || ''));
  const refreshToken = ref<string>(String(uni.getStorageSync('refreshToken') || ''));
  const currentRole = ref<string>(initialUser?.roles?.[0] || DEFAULT_ROLE);
  const locale = ref<string>(resolveInitialLocale(initialUser));
  const lastRefreshTime = ref(0);

  const availableRoles = computed<string[]>(() => userInfo.value?.roles || ['CONSUMER']);
  const isLoggedIn = computed(() => !!token.value);

  const setLocaleState = (newLocale: string) => {
    locale.value = newLocale || DEFAULT_LOCALE;
  };

  const setToken = (accessToken: string, newRefreshToken: string) => {
    token.value = accessToken;
    refreshToken.value = newRefreshToken;
    uni.setStorageSync('token', accessToken);
    uni.setStorageSync('refreshToken', newRefreshToken);
  };

  const login = (user: UserProfile, accessToken: string, newRefreshToken: string) => {
    if (!accessToken) {
      console.error('[UserStore] Login called with empty access token!');
      return;
    }
    console.log('[UserStore] Login success for user:', user?.id, 'Token length:', accessToken.length);
    userInfo.value = user;
    token.value = accessToken;
    refreshToken.value = newRefreshToken;
    currentRole.value = user.roles?.[0] || DEFAULT_ROLE;
    if (user.locale) {
      setLocaleState(user.locale);
    }

    uni.setStorageSync('userInfo', user);
    uni.setStorageSync('token', accessToken);
    uni.setStorageSync('refreshToken', newRefreshToken);
  };

  const syncFromStorage = () => {
    const storedToken = uni.getStorageSync('token');
    const storedRefreshToken = uni.getStorageSync('refreshToken');
    const storedUserInfo = parseStoredUser(uni.getStorageSync('userInfo'));
    const storedLocale = String(uni.getStorageSync('locale') || '');

    if (storedToken) {
      token.value = storedToken;
    }
    if (storedRefreshToken) {
      refreshToken.value = storedRefreshToken;
    }
    if (storedLocale) {
      setLocaleState(storedLocale);
    }
    if (storedUserInfo) {
      userInfo.value = storedUserInfo;
      currentRole.value = storedUserInfo.roles?.[0] || DEFAULT_ROLE;
      if (!storedLocale && storedUserInfo.locale) {
        setLocaleState(storedUserInfo.locale);
      }
    }
  };

  const setUserInfo = (user: UserProfile) => {
    userInfo.value = user;
    currentRole.value = user?.roles?.[0] || DEFAULT_ROLE;
    if (user?.locale) {
      setLocaleState(user.locale);
    }
    uni.setStorageSync('userInfo', user);
  };

  const invalidate = () => {
    lastRefreshTime.value = 0;
  };

  const refreshUserInfo = async (force = false) => {
    if (!userInfo.value?.id || !apiProvider) return null;
    const now = Date.now();
    if (!force && lastRefreshTime.value > 0 && (now - lastRefreshTime.value < CACHE_TTL)) {
      return userInfo.value;
    }

    const fresh = await apiProvider.getUserById(userInfo.value.id);
    setUserInfo(fresh);
    lastRefreshTime.value = Date.now();
    return fresh;
  };

  const fetchUserInfo = async () => {
    return refreshUserInfo(true);
  };

  const logout = () => {
    userInfo.value = null;
    token.value = '';
    refreshToken.value = '';
    currentRole.value = DEFAULT_ROLE;
    lastRefreshTime.value = 0;
    uni.removeStorageSync('userInfo');
    uni.removeStorageSync('token');
    uni.removeStorageSync('refreshToken');
  };

  const setRole = (role: string) => {
    if (userInfo.value?.roles.includes(role)) {
      currentRole.value = role;
    }
  };

  return {
    userInfo,
    token,
    refreshToken,
    currentRole,
    availableRoles,
    isLoggedIn,
    locale,
    login,
    setUserInfo,
    syncFromStorage,
    refreshUserInfo,
    fetchUserInfo,
    logout,
    setLocaleState,
    setRole,
    lastRefreshTime,
    invalidate,
    setToken,
  };
});
