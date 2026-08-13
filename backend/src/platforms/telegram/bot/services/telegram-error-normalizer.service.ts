import { Injectable } from '@nestjs/common';

@Injectable()
export class TelegramErrorNormalizerService {
  extractErrorText(error: unknown, fallback: string): string {
    const message = this.pickErrorMessage(error);
    if (message) return message;
    return fallback;
  }

  extractQueryErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const record = error as Record<string, unknown>;
    if (typeof record.code === 'string') return record.code;
    return undefined;
  }

  private pickErrorMessage(value: unknown): string | null {
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (!normalized) return null;
      const cleaned = normalized.replace(/\[object\s.+?\]/gi, '').trim();
      if (!cleaned) return null;
      return cleaned;
    }
    if (Array.isArray(value)) {
      const normalized = value
        .map((item) => this.pickErrorMessage(item))
        .filter((item): item is string => Boolean(item));
      if (normalized.length === 0) return null;
      return normalized.join('；');
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;

      // 1. Prioritize message field (standard error)
      if ('message' in record) {
        const fromMessage = this.pickErrorMessage(record.message);
        if (fromMessage) return fromMessage;
      }

      // 2. Check for nested Axios/HTTP response errors
      // Often in response.data or response.data.message
      const candidates = [
        record.data,
        record.response?.['data'],
        record.response,
        record.error,
      ];

      for (const cand of candidates) {
        if (cand) {
          const result = this.pickErrorMessage(cand);
          if (result) return result;
        }
      }

      // 3. Fallback: If it's a plain object but not an Error instance, try to stringify it
      // This prevents [object Object] by showing the actual JSON structure (truncated)
      try {
        if (!(value instanceof Error)) {
          const str = JSON.stringify(value);
          return str.length > 200 ? str.substring(0, 200) + '...' : str;
        }
      } catch {
        // Ignore circular reference errors etc.
      }
    }
    return null;
  }
}
