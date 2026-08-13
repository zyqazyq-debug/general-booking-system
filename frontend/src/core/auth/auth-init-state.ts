let authInitPromise: Promise<void> | null = null;
export type AuthInitStatus = 'idle' | 'pending' | 'success' | 'failed' | 'timeout' | 'error';
export type AuthInitState = { 
  status: AuthInitStatus; 
  startedAt?: number; 
  finishedAt?: number; 
  error?: string;
  isReady: boolean; // NEW: Explicit ready flag
};

let authInitState: AuthInitState = {
  status: 'idle',
  isReady: false,
};

export const hasPendingAuthInit = () => !!authInitPromise;
export const isAuthInitReady = () => authInitState.isReady;

export const getAuthInitState = () => authInitState;
export const getAuthInitStatus = () => authInitState.status;

export const isAuthInitBlocked = () => {
  const status = authInitState.status;
  return status === 'failed' || status === 'timeout' || status === 'error';
};

export const markAuthInitIdle = () => {
  authInitState = { status: 'idle', isReady: false };
};

export const markAuthInitPending = (startedAt = Date.now()) => {
  authInitState = { status: 'pending', startedAt, isReady: false };
};

export const finishAuthInit = (status: Exclude<AuthInitStatus, 'idle' | 'pending'>, error?: string) => {
  const shouldLog =
    import.meta.env.DEV &&
    ((typeof window !== 'undefined' && /debugLog=1/.test(window.location.href)) ||
      (typeof uni !== 'undefined' && uni.getStorageSync('debug_log') === '1'));
  if (shouldLog) {
    console.log(`🏁 [AuthInit] Finished with status: ${status}${error ? `, error: ${error}` : ''}`);
  }
  authInitState = { 
    status, 
    finishedAt: Date.now(), 
    error,
    isReady: true 
  };
  authInitPromise = null;
};

export const beginAuthInit = (promise: Promise<void>) => {
  const shouldLog =
    import.meta.env.DEV &&
    ((typeof window !== 'undefined' && /debugLog=1/.test(window.location.href)) ||
      (typeof uni !== 'undefined' && uni.getStorageSync('debug_log') === '1'));
  if (shouldLog) {
    console.log('🚀 [AuthInit] Started');
  }
  authInitPromise = promise;
};

/**
 * High-level wait function.
 * Ensures the app has finished its initial auth check.
 */
export const waitForAuthInit = async (timeoutMs?: number) => {
  if (authInitState.isReady) return;
  if (!authInitPromise) return;

  try {
    if (timeoutMs) {
      await Promise.race([
        authInitPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
      ]).catch(e => {
        if (e.message === 'timeout') {
          console.warn(`[AuthInit] Wait timed out after ${timeoutMs}ms`);
        } else {
          throw e;
        }
      });
    } else {
      await authInitPromise;
    }
  } catch (e) {
    console.error('[AuthInit] Promise rejected', e);
  }
};
