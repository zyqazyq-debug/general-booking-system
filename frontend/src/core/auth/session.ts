import type { CoreUserStore } from '@/core/types/user-store';

const parseStoredUser = (value: any) => {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
};

export const restoreSessionFromStorage = (userStore: Pick<CoreUserStore, 'token' | 'userInfo'>) => {
  const token = uni.getStorageSync('token');
  const rawUser = uni.getStorageSync('userInfo');
  const user = parseStoredUser(rawUser);

  if (token) {
    userStore.token = token;
  }
  if (user) {
    userStore.userInfo = user;
  }

  return { token, user };
};

export const syncSessionFromStorage = (userStore: Pick<CoreUserStore, 'token' | 'userInfo'>) => {
  if (userStore.token) {
    return { token: userStore.token, user: userStore.userInfo };
  }
  return restoreSessionFromStorage(userStore);
};
