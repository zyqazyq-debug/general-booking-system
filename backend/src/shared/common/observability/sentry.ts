import * as Sentry from '@sentry/node';
import type { Request } from 'express';

let initialized = false;
let sentryEnabled = false;

const parseSampleRate = (raw: string | undefined, fallback: number) => {
  const value = Number(raw);
  if (Number.isFinite(value) && value >= 0 && value <= 1) {
    return value;
  }
  return fallback;
};

export const isBackendSentryEnabled = () => sentryEnabled;

export const initBackendSentry = () => {
  if (initialized) {
    return sentryEnabled;
  }
  initialized = true;
  const dsn = (process.env.SENTRY_DSN || '').trim();
  if (!dsn) {
    sentryEnabled = false;
    return sentryEnabled;
  }
  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || process.env.npm_package_version,
    tracesSampleRate: parseSampleRate(
      process.env.SENTRY_TRACES_SAMPLE_RATE,
      0.1,
    ),
    profilesSampleRate: parseSampleRate(
      process.env.SENTRY_PROFILES_SAMPLE_RATE,
      0,
    ),
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
  sentryEnabled = true;
  return sentryEnabled;
};

export const captureBackendException = (error: unknown, request?: Request) => {
  if (!sentryEnabled) {
    return;
  }
  Sentry.withScope((scope) => {
    if (request) {
      scope.setTag('http.method', request.method);
      scope.setTag('http.path', request.path || request.url || '');
      scope.setContext('request', {
        method: request.method,
        path: request.path || request.url || '',
        query: request.query as Record<string, unknown>,
      });
    }
    if (error instanceof Error) {
      Sentry.captureException(error);
      return;
    }
    Sentry.captureMessage(String(error), 'error');
  });
};
