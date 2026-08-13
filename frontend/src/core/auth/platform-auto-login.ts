import { currentPlatform } from '@/platforms';
import { beginAuthInit, finishAuthInit } from '@/core/auth/auth-init-state';

export const startPlatformAutoLogin = (
  loginWithTelegramWebApp: (token: string) => Promise<boolean>,
) => {
  if (!currentPlatform) {
    console.error('[App] Critical: currentPlatform is undefined!');
    return;
  }

  console.log('[App] Current Platform:', currentPlatform.name);

  // IMMEDIATELY create the promise to block requests from starting too early
  const authPromise = new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    // 1. Safety Timeout (15s)
    setTimeout(() => {
      if (!settled) {
        console.warn('[App] Platform auto-login timed out (15s)');
        finishAuthInit('timeout');
        finish();
      }
    }, 15000);

    // 2. Start Login Process
    currentPlatform
      .login()
      .then(async (authData) => {
        if (!authData || !authData.platform_token) {
          if (currentPlatform.name === 'browser') {
            finishAuthInit('success');
            finish();
            return;
          }
          const shouldLog =
            import.meta.env.DEV &&
            ((typeof window !== 'undefined' && /debugLog=1/.test(window.location.href)) ||
              (typeof uni !== 'undefined' && uni.getStorageSync('debug_log') === '1'));
          if (shouldLog) console.log('[App] Platform login provided no credentials');
          finishAuthInit('failed');
          finish();
          return;
        }

        if (currentPlatform.name !== 'telegram') {
          // Future-proofing for other platforms like WeChat
          finishAuthInit('success');
          finish();
          return;
        }

        console.log('[App] Platform auto-login triggered:', currentPlatform.name);
        
        loginWithTelegramWebApp(authData.platform_token)
          .then((success) => {
            finishAuthInit(success ? 'success' : 'failed');
            finish();
            // REMOVED: Redundant redirect logic here.
            // Let the global request/route interceptors handle the 401 or no-token state.
          })
          .catch((err) => {
            console.error('TG Login failed', err);
            finishAuthInit('error', err.message);
            finish();
          });
      })
      .catch((e) => {
        console.error('[App] Platform login error:', e);
        finishAuthInit('error', e.message);
        finish();
      });
  });

  beginAuthInit(authPromise);
};
