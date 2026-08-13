/**
 * 环境自适应工具
 * 前端配置现在完全收敛到 Vite 环境变量 (VITE_ 前缀)
 * 编译时由 Vite 根据 .env (或 .env.production) 自动注入
 */

export const getApiBaseUrl = () => {
  // 优先使用环境变量，如果没有则回退到 /api
  return import.meta.env.VITE_API_BASE_URL || '/api';
};

export const getBotName = () => {
  return import.meta.env.VITE_TELEGRAM_BOT_NAME || 'happybookingdevbot';
};

export const getBotDisplayName = () => {
  return import.meta.env.VITE_TELEGRAM_BOT_DISPLAY_NAME || 'BookingDevBot';
};

// 兼容性保留，但内部逻辑改为基于 Vite 环境判断
export const isProd = () => {
  return import.meta.env.PROD;
};

export const isDev = () => {
  return import.meta.env.DEV;
};

export const getHostname = () => {
  if (typeof window === 'undefined') return '';
  return window.location.hostname;
};
