import { createSSRApp } from "vue";
import { createI18n } from 'vue-i18n';
import { createPinia } from 'pinia';
import App from "./App.vue";
import zhCN from './locale/zh-Hans.json';
import enUS from './locale/en.json';

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS
  }
});

const pinia = createPinia();

export function createApp() {
  const app = createSSRApp(App);
  app.use(i18n);
  app.use(pinia);
  return {
    app,
    pinia
  };
}
