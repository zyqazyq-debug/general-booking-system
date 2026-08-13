import { startPlatformAutoLogin } from '@/core/auth/platform-auto-login';
import { restoreSessionFromStorage } from '@/core/auth/session';
import { initBrowserShell } from '@/core/ui/browser-shell';
import {
  handleNavigateGuard,
  handlePageNotFoundRedirect,
  registerNavigateInterceptor,
} from '@/core/guards/route-guard';
import type { CoreUserStore } from '@/core/types/user-store';
import { getAuthInitStatus } from '@/core/auth/auth-init-state';

export const bootstrapAppLaunch = (
  userStore: CoreUserStore,
  actions: {
    loginWithTelegramWebApp: (token: string) => Promise<boolean>;
  },
) => {
  restoreSessionFromStorage(userStore);
  startPlatformAutoLogin(actions.loginWithTelegramWebApp);
  // registerNavigateInterceptor is enough for all platforms
  registerNavigateInterceptor(() => !!userStore.token, () => getAuthInitStatus());
  initBrowserShell();
};

export const bootstrapAppShow = async (userStore: Pick<CoreUserStore, 'token' | 'userInfo' | 'isLoggedIn'>) => {
  // Ensure the initial landing page is checked
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  const route = page ? page.route : '';
  if (route) {
    handleNavigateGuard(route, !!userStore.token);
  }
};

export const bootstrapPageNotFound = (path: string) => {
  const token = uni.getStorageSync('token');
  handlePageNotFoundRedirect(path, !!token);
};
