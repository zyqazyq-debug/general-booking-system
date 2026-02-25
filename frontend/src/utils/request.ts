import { useUserStore } from '@/stores/user';
import type { ApiResponse } from '@/types/api';
const BASE_URL =
  typeof window !== 'undefined' && window.location?.protocol !== 'file:'
    ? '/api'
    : 'http://localhost:3000';

const request = (options: any): Promise<any> => {
  return new Promise((resolve, reject) => {
    const userStore = useUserStore();
    
    if (!options.hideLoading) {
        uni.showLoading({ title: 'Loading...', mask: true });
    }

    uni.request({
      ...options,
      url: BASE_URL + options.url,
      header: {
        ...options.header,
        Authorization: userStore.token ? `Bearer ${userStore.token}` : '',
      },
      success: (res: UniApp.RequestSuccessCallbackResult) => {
        if (!options.hideLoading) uni.hideLoading();
        
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const data = res.data as any;
          // Support unified response { code, message, data } and plain payloads
          if (data && typeof data === 'object' && 'code' in data && 'message' in data) {
            const wrapped = data as ApiResponse<any>;
            if (wrapped.code === 0) {
               resolve(wrapped.data);
            } else {
               uni.showToast({ title: wrapped.message || '请求失败', icon: 'none' });
               reject(wrapped);
            }
          } else {
            resolve(data);
          }
        } else {
          let msg = (res.data as any).message || 'Request failed';
           
          // Handle NestJS validation array error
          if (Array.isArray(msg)) {
               msg = msg[0];
          }

          uni.showToast({ title: msg, icon: 'none' });
          
          if (res.statusCode === 401) {
              // Check if current page is public
              const pages = getCurrentPages();
              const currentPage = pages[pages.length - 1];
              const whiteList = ['pages/login/login', 'pages/login/register', 'pages/booking/detail', 'pages/share/view'];
              
              if (currentPage && !whiteList.includes(currentPage.route || '')) {
                  userStore.logout();
                  uni.reLaunch({ url: '/pages/login/login' });
              }
          }
          reject(res.data);
        }
      },
      fail: (err: any) => {
        if (!options.hideLoading) uni.hideLoading();
        uni.showToast({ title: 'Network Error', icon: 'none' });
        reject(err);
      }
    });
  });
};

export { request };
