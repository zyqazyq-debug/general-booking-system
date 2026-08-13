import { performRedirect, resolveOnShowRedirect } from '@/core/guards/route-guard';
import { syncSessionFromStorage } from '@/core/auth/session';
import { waitForAuthInit } from '@/core/auth/auth-init-state';
import type { CoreUserStore } from '@/core/types/user-store';

export const handleAppShowGuard = async (userStore: Pick<CoreUserStore, 'token' | 'userInfo'>) => {
  await waitForAuthInit();

  const pages = getCurrentPages();
  if (pages.length === 0) {
    return;
  }

  const currentPage = pages[pages.length - 1];
  const route = currentPage?.route || '';
  const { token } = syncSessionFromStorage(userStore);
  const roles = Array.isArray(userStore.userInfo?.roles) ? userStore.userInfo.roles : [];
  const redirectUrl = resolveOnShowRedirect(route, token, roles);
  performRedirect(redirectUrl);
};
