import { AUTH_REDIRECT_PATH, FORBIDDEN_REDIRECT_PATH, getRequiredRoles, isPublicRoute } from '@/config/route-access';
import type { AuthInitStatus } from '@/core/auth/auth-init-state';

let authRedirectLock = false;
let navigateInterceptorRegistered = false;
let guardRedirectInProgress = false;

const normalizeRoute = (route: string) => (route || '').split('?')[0].replace(/^\/+/, '');

const lockRedirect = (duration = 300) => {
  authRedirectLock = true;
  setTimeout(() => {
    authRedirectLock = false;
  }, duration);
};

export const isRedirectLocked = () => authRedirectLock;

export const handleNavigateGuard = (
  url: string,
  isLoggedIn: boolean,
  authInitStatus: AuthInitStatus = 'idle',
) => {
  if (guardRedirectInProgress) {
    return false;
  }
  if (isPublicRoute(url) || isLoggedIn) {
    return true;
  }
  if (authInitStatus === 'pending') {
    return true;
  }
  if (!authRedirectLock) {
    lockRedirect();
    guardRedirectInProgress = true;
    const fallbackTarget = '/pages/index/index';
    const targetUrl = url || fallbackTarget;
    const loginUrl = `${AUTH_REDIRECT_PATH}?redirect=${encodeURIComponent(targetUrl)}`;
    uni.reLaunch({ url: loginUrl });
    setTimeout(() => {
      guardRedirectInProgress = false;
    }, 350);
  }
  return false;
};

export const registerNavigateInterceptor = (
  isLoggedInGetter: () => boolean,
  authInitStatusGetter: () => AuthInitStatus = () => 'idle',
) => {
  if (navigateInterceptorRegistered) {
    return;
  }
  navigateInterceptorRegistered = true;
  const methods: Array<'navigateTo' | 'redirectTo' | 'reLaunch' | 'switchTab'> = [
    'navigateTo',
    'redirectTo',
    'reLaunch',
    'switchTab',
  ];
  methods.forEach((method) => {
    uni.addInterceptor(method, {
      invoke(args) {
        const url = args?.url || '';
        return handleNavigateGuard(url, isLoggedInGetter(), authInitStatusGetter());
      },
    });
  });
};

export const resolveOnShowRedirect = (
  route: string,
  token: string,
  roles: string[],
  authInitStatus: AuthInitStatus = 'idle',
) => {
  if (authInitStatus === 'pending') {
    return '';
  }
  const requiredRoles = getRequiredRoles(route);
  if (requiredRoles.length > 0) {
    if (!token) {
      return AUTH_REDIRECT_PATH;
    }
    const hasRequiredRole = requiredRoles.some((role) => roles.includes(role));
    if (!hasRequiredRole) {
      return FORBIDDEN_REDIRECT_PATH;
    }
  }
  if (!isPublicRoute(route) && !token) {
    return AUTH_REDIRECT_PATH;
  }
  return '';
};

export const performRedirect = (url: string, duration = 300, delay = 0) => {
  if (!url || authRedirectLock) {
    return;
  }
  lockRedirect(duration + delay);
  if (delay > 0) {
    setTimeout(() => {
      uni.reLaunch({ url });
    }, delay);
    return;
  }
  uni.reLaunch({ url });
};

export const handlePageNotFoundRedirect = (path: string, hasToken: boolean) => {
  const target = hasToken ? '/pages/library/index' : AUTH_REDIRECT_PATH;
  if (normalizeRoute(path) === normalizeRoute(target) || authRedirectLock) {
    return;
  }
  performRedirect(target, 300, 50);
};
