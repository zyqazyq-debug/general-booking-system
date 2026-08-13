import { useUserStore } from '@/shared/stores/user';
import type { ApiResponse } from '@/types/api';
import { showAppConfirm } from '@/utils/app-confirm';
import { getAuthInitStatus, hasPendingAuthInit, isAuthInitBlocked, waitForAuthInit } from '@/core/auth/auth-init-state';
import { getApiBaseUrl } from '@/utils/env';
import { resolveApiErrorMessage } from '@/utils/error-code';

// Use environment variable for API base URL
const BASE_URL = getApiBaseUrl() || import.meta.env.VITE_API_BASE_URL || '/api';

// Refresh Token Lock
let isRefreshing = false;
let requestsQueue: Array<(token: string) => void> = [];

export interface RequestOptions {
  url: string;
  method?: UniApp.RequestOptions['method'] | 'PATCH';
  data?: any;
  params?: any;
  header?: any;
  silent?: boolean;
  hideLoading?: boolean;
  hideErrorToast?: boolean;
  _retry?: boolean;
}

const isPublicRequest = (url: string) => {
  return (
    url.includes('/debug/log') || 
    url.includes('/auth/telegram/webapp-login') || 
    url.includes('/auth/refresh') ||
    url.includes('/auth/login') ||
    url.includes('/auth/register') ||
    url.includes('/auth/wechat') ||
    url.includes('/auth/qq') ||
    url.includes('/auth/phone') ||
    url.includes('/auth/telegram')
  );
};

const request = <T = any>(options: RequestOptions): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const userStore = useUserStore();
    
    // Default to showing loading unless silent or hideLoading is true
    // TODO: In the future, consider changing default to false for better UX
    const shouldShowLoading = !options.silent && !options.hideLoading;
    
    if (shouldShowLoading) {
        uni.showLoading({ title: '加载中...', mask: true });
    }

    // Clean up double slashes if any (except protocol)
    const finalUrl = options.url.startsWith('http') 
        ? options.url 
        : (BASE_URL.replace(/\/+$/, '') + '/' + options.url.replace(/^\/+/, ''));

    console.log(`[Request] ${options.method || 'GET'} ${finalUrl}`);

    // Handle params vs data for GET requests in uni.request
    let requestData = options.data;
    if (options.method === 'GET' && options.params) {
        requestData = options.params;
    }

    const doRequest = async (token?: string) => {
      const shouldWaitAuth = hasPendingAuthInit() && !isPublicRequest(finalUrl);
      if (shouldWaitAuth) {
          try {
              console.log('⏳ [Request] Waiting for TG Auto-login...');
              // Show a specialized loading message
              if (shouldShowLoading) {
                  uni.showLoading({ title: '正在安全登录...', mask: true });
              }
              await waitForAuthInit(3000); // Wait at most 3s for a single request
              console.log('✅ [Request] TG Auto-login wait finished');
              
              // Restore normal loading message
              if (shouldShowLoading) {
                  uni.showLoading({ title: '加载中...', mask: true });
              }
          } catch (e) {
              console.error('Auth wait failed', e);
          }
      }

      const storedToken = uni.getStorageSync('token');
      if (storedToken && !userStore.token) {
          userStore.token = storedToken;
      }
      
      const currentStoreToken = userStore.token;
      const authToken = token || currentStoreToken || storedToken;

      const tgAuthStatus = getAuthInitStatus();
      if (!authToken && !isPublicRequest(finalUrl) && isAuthInitBlocked()) {
          if (shouldShowLoading) uni.hideLoading();
          // Don't show toast for every request to avoid spam
          console.warn('Telegram auth failed, aborting request:', finalUrl);
          reject({ message: 'Telegram auth failed', tgAuthStatus });
          return;
      }
      
      const shouldSendDebugLog = import.meta.env.DEV && !options.url.includes('/debug/log');
      if (shouldSendDebugLog) {
          uni.request({
              url: BASE_URL + '/debug/log',
              method: 'POST',
              data: { 
                  event: 'REQUEST_START', 
                  url: finalUrl, 
                  hasToken: !!authToken,
                  isWaiting: hasPendingAuthInit()
              }
          });
      }

      console.log('🚀 [Request Start]', {
          url: finalUrl,
          hasToken: !!authToken,
          isWaiting: hasPendingAuthInit()
      });

      uni.request({
        ...options,
        method: options.method as any,
        url: finalUrl,
        data: requestData, // Unified data field
        header: {
          ...options.header,
          'Authorization': authToken ? `Bearer ${authToken}` : '',
        },
        success: async (res: any) => {
          if (shouldShowLoading) uni.hideLoading();
          
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const data = res.data;
            // Support unified response { code, message, data } and plain payloads
            // Loosen check: if it has 'code' (number) and 'data', treat as wrapped
            // console.log('[Request Debug]', options.url, 'IsObject:', typeof data === 'object', 'HasCode:', 'code' in data, 'CodeType:', typeof data?.code);
            
            if (data && typeof data === 'object' && 'code' in data && (typeof data.code === 'number')) {
               // If standard wrapped response
               if (data.code === 0 || data.code === 200) {
                   // Return data.data if exists, otherwise return null/undefined (for void responses)
                   resolve(data.data as T);
               } else {
                   const resolved = resolveApiErrorMessage(data, '请求失败');
                   uni.showToast({ title: resolved.message, icon: 'none' });
                   reject(data);
               }
            } else {
              // If plain payload (NestJS default)
              // Log payload type for debugging
              if (options.url.includes('/auth/qq') || options.url.includes('/auth/wechat')) {
                  console.log('[Auth Response Debug]', options.url, data);
              }
              resolve(data as T);
            }
          } else {
            // Enhanced Error Extraction
            const resolved = resolveApiErrorMessage(res.data, 'Request failed');
            let msg = resolved.message;
            
            // Log full details for debugging
            console.error('❌ [API Error]', {
                url: finalUrl,
                method: options.method || 'GET',
                statusCode: res.statusCode,
                data: res.data,
                requestData
            });

            if (res.statusCode === 401) {
                console.warn('[API 401] Auth failure for url:', finalUrl, 'Retry:', options._retry);
                // If this request was already a retry, fail immediately
                if (options._retry) {
                    userStore.logout();
                    uni.reLaunch({ url: '/pages/login/login' });
                    return reject(res.data);
                }

                if (shouldSendDebugLog) {
                    uni.request({
                        url: BASE_URL + '/debug/log',
                        method: 'POST',
                        data: { 
                            event: '401_ERROR', 
                            url: finalUrl, 
                            hasToken: !!authToken
                        }
                    });
                }

                // Case 1: Refresh is already in progress -> Queue this request
                if (isRefreshing) {
                  return new Promise<T>((resolve) => {
                    requestsQueue.push((newToken) => {
                      options._retry = true;
                      options.header = { ...options.header, Authorization: `Bearer ${newToken}` };
                      resolve(request<T>(options));
                    });
                  }).then(resolve).catch(reject);
                }

                // Case 2: No refresh in progress -> Start refresh
                if (userStore.refreshToken) {
                  isRefreshing = true;
                  
                  try {
                    // Call refresh API
                    const refreshRes = await new Promise<any>((resolve, reject) => {
                      uni.request({
                        url: BASE_URL + '/auth/refresh',
                        method: 'POST',
                        data: { refresh_token: userStore.refreshToken },
                        success: (r) => resolve(r),
                        fail: (e) => reject(e)
                      });
                    });

                    if (refreshRes.statusCode === 201 || refreshRes.statusCode === 200) {
                      let refreshPayload = refreshRes.data;
                      if (refreshPayload && typeof refreshPayload === 'object' && 'code' in refreshPayload && 'data' in refreshPayload) {
                        refreshPayload = refreshPayload.data;
                      }
                      const accessToken = refreshPayload?.access_token;
                      if (!accessToken || typeof accessToken !== 'string') {
                        throw new Error('Refresh token response invalid');
                      }
                      
                      userStore.token = accessToken;
                      uni.setStorageSync('token', accessToken);
                      
                      requestsQueue.forEach(cb => cb(accessToken));
                      requestsQueue = [];
                      isRefreshing = false;

                      options._retry = true;
                      options.header = { ...options.header, Authorization: `Bearer ${accessToken}` };
                      return resolve(request<T>(options));
                    } else {
                      throw new Error('Refresh failed');
                    }
                  } catch (e) {
                    // Refresh failed completely -> Logout
                    isRefreshing = false;
                    requestsQueue = [];
                    userStore.logout();
                    uni.reLaunch({ url: '/pages/login/login' });
                    return reject(res.data);
                  }
                } else {
                    // No refresh token available -> Logout
                    userStore.logout();
                    uni.reLaunch({ url: '/pages/login/login' });
                    return reject(res.data);
                }
            }
  
            if (!options.hideErrorToast) {
              const displayTitle = `[${res.statusCode}] ${msg}`;
              uni.showToast({ title: displayTitle, icon: 'none', duration: 3000 });
              
              // In development mode, reduce noise for server errors (500+)
              if (import.meta.env.DEV && res.statusCode >= 500) {
                  console.error(`[Server Error ${res.statusCode}]`, res.data);
              }
            }
            
            // Redundant 401 check removed here (handled above)
            
            reject(res.data);
          }
        },
        fail: (err: any) => {
          if (shouldShowLoading) uni.hideLoading();
          
          const errMsg = String(err?.errMsg || err?.message || '');
          const isAborted = /abort|aborted|ERR_ABORTED/i.test(errMsg);
          if (isAborted) {
            return reject(err);
          }

          console.error('❌ [Network Error]', {
              url: finalUrl,
              method: options.method || 'GET',
              error: err,
              requestData
          });

          uni.showToast({ title: `Network Error: ${errMsg || 'Unknown error'}`, icon: 'none', duration: 3000 });
          reject(err);
        }
      });
    };

    doRequest();
  });
};

export { request };
