import { createI18n } from 'vue-i18n';
import zhCN from '@/locale/zh-Hans.json';
import enUS from '@/locale/en.json';

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
});

