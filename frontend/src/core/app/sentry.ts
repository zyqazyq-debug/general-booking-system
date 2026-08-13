import type { App as VueApp } from 'vue';
import * as Sentry from '@sentry/vue';

let sentryInited = false;

const parseSampleRate = (raw: string | undefined, fallback: number) => {
  const value = Number(raw);
  if (Number.isFinite(value) && value >= 0 && value <= 1) {
    return value;
  }
  return fallback;
};

export const initFrontendSentry = (app: VueApp<Element>) => {
  if (sentryInited) {
    return false;
  }
  const dsn = String(import.meta.env.VITE_SENTRY_DSN || '').trim();
  if (!dsn) {
    return false;
  }
  Sentry.init({
    app,
    dsn,
    environment: String(import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE || 'development'),
    release: String(import.meta.env.VITE_SENTRY_RELEASE || 'frontend'),
    tracesSampleRate: parseSampleRate(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE, 0.1),
    replaysSessionSampleRate: parseSampleRate(import.meta.env.VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE, 0),
    replaysOnErrorSampleRate: parseSampleRate(import.meta.env.VITE_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE, 0),
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers) {
        const headers = { ...event.request.headers };
        delete headers.authorization;
        delete headers.cookie;
        event.request.headers = headers;
      }
      return event;
    },
  });
  sentryInited = true;
  return true;
};

