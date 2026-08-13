import { i18n } from '@/core/i18n/instance';

const ERROR_CODE_I18N_KEY: Record<string, string> = {
  INSUFFICIENT_CREDIT: 'error.insufficient_credit',
  COLLECTION_ACTIVE_LIMIT_EXCEEDED: 'error.collection_active_limit_exceeded',
  PAYMENT_INIT_FAILED: 'error.payment_init_failed',
  PAYMENT_TRANSACTION_NOT_FOUND: 'error.payment_transaction_not_found',
  SELF_COLLECTION_NOT_ALLOWED: 'error.self_collection_not_allowed',
  COLLECTION_ALREADY_EXISTS: 'error.collection_already_exists',
};

const pickMessage = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized ? normalized : null;
  }
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === 'string');
    return typeof first === 'string' && first.trim() ? first.trim() : null;
  }
  return null;
};

const pickErrorCode = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const candidates = [
    record.error_code,
    record.code,
    (record.data as Record<string, unknown> | undefined)?.error_code,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
};

export const resolveApiErrorMessage = (
  errorPayload: unknown,
  fallback = 'Request failed',
) => {
  const errorCode = pickErrorCode(errorPayload);
  if (errorCode && ERROR_CODE_I18N_KEY[errorCode]) {
    const key = ERROR_CODE_I18N_KEY[errorCode];
    const translated = i18n.global.t(key);
    if (translated && translated !== key) {
      return { message: translated, errorCode };
    }
  }

  if (errorPayload && typeof errorPayload === 'object') {
    const record = errorPayload as Record<string, unknown>;
    const directMessage = pickMessage(record.message) || pickMessage(record.error);
    if (directMessage) {
      return { message: directMessage, errorCode };
    }
  }

  if (typeof errorPayload === 'string' && errorPayload.trim()) {
    return { message: errorPayload.trim(), errorCode };
  }

  return { message: fallback, errorCode };
};

export const extractApiErrorCode = (errorPayload: unknown) =>
  pickErrorCode(errorPayload);

const extractApiMessage = (errorPayload: unknown) => {
  if (errorPayload && typeof errorPayload === 'object') {
    const record = errorPayload as Record<string, unknown>;
    return pickMessage(record.message) || pickMessage(record.error) || '';
  }
  if (typeof errorPayload === 'string') {
    return errorPayload.trim();
  }
  return '';
};

export const isSelfCollectionError = (errorPayload: unknown) => {
  const errorCode = extractApiErrorCode(errorPayload);
  if (errorCode === 'SELF_COLLECTION_NOT_ALLOWED') {
    return true;
  }
  const message = extractApiMessage(errorPayload);
  return /Cannot collect from yourself|自己/.test(message);
};

export const isCollectionExistsError = (errorPayload: unknown) => {
  const errorCode = extractApiErrorCode(errorPayload);
  if (errorCode === 'COLLECTION_ALREADY_EXISTS') {
    return true;
  }
  const message = extractApiMessage(errorPayload);
  return /already|exists|已收藏/i.test(message);
};
