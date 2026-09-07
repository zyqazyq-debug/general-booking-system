type EnvMap = Record<string, unknown>;

const readString = (env: EnvMap, key: string): string =>
  typeof env[key] === 'string' ? env[key].trim() : '';

const readBoolean = (env: EnvMap, key: string): boolean =>
  readString(env, key).toLowerCase() === 'true';

const WEBHOOK_PATH = '/telegram/webhook';
const WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const TELEGRAM_BOT_MODES = new Set(['polling', 'webhook']);

const requireWhen = (condition: boolean, key: string, env: EnvMap) => {
  if (condition && !readString(env, key)) {
    throw new Error(`${key} is required`);
  }
};

export const validateEnv = (env: EnvMap): EnvMap => {
  const nodeEnv = readString(env, 'NODE_ENV') || 'development';
  const isProd = nodeEnv === 'production';
  const activeJwtIndex = readString(env, 'JWT_SECRET_ACTIVE_INDEX') || '1';
  const hasSecret1 = !!readString(env, 'JWT_SECRET1');
  const hasSecret2 = !!readString(env, 'JWT_SECRET2');
  const hasLegacySecret = !!readString(env, 'JWT_SECRET');
  const hasActiveSecret =
    activeJwtIndex === '2'
      ? hasSecret2 || hasLegacySecret
      : hasSecret1 || hasLegacySecret;

  if (!hasActiveSecret) {
    throw new Error(
      'JWT secret is required. Set JWT_SECRET1/2 (+JWT_SECRET_ACTIVE_INDEX) or JWT_SECRET',
    );
  }

  if (isProd && readBoolean(env, 'TYPEORM_SYNCHRONIZE')) {
    throw new Error('TYPEORM_SYNCHRONIZE must be false in production');
  }

  requireWhen(isProd, 'ALLOWED_ORIGINS', env);
  const webhookEnabled = readBoolean(env, 'TELEGRAM_ENABLE_WEBHOOK');
  const botMode =
    readString(env, 'TELEGRAM_BOT_MODE').toLowerCase() || 'polling';
  if (!TELEGRAM_BOT_MODES.has(botMode)) {
    throw new Error('TELEGRAM_BOT_MODE must be polling or webhook');
  }
  if (botMode === 'polling' && webhookEnabled) {
    throw new Error(
      'TELEGRAM_ENABLE_WEBHOOK must be false when TELEGRAM_BOT_MODE is polling',
    );
  }
  if (botMode === 'webhook' && !webhookEnabled) {
    throw new Error(
      'TELEGRAM_ENABLE_WEBHOOK must be true when TELEGRAM_BOT_MODE is webhook',
    );
  }
  if (
    isProd &&
    readBoolean(env, 'TELEGRAM_POLLING_DELETE_WEBHOOK_ON_STARTUP')
  ) {
    throw new Error(
      'TELEGRAM_POLLING_DELETE_WEBHOOK_ON_STARTUP is forbidden in production',
    );
  }

  if (botMode === 'webhook') {
    requireWhen(true, 'TELEGRAM_WEBHOOK_URL', env);
    requireWhen(true, 'TELEGRAM_WEBHOOK_SECRET_TOKEN', env);

    const webhookUrl = readString(env, 'TELEGRAM_WEBHOOK_URL');
    try {
      const parsed = new URL(webhookUrl);
      if (parsed.protocol !== 'https:' || parsed.pathname !== WEBHOOK_PATH) {
        throw new Error('invalid Telegram webhook URL');
      }
    } catch {
      throw new Error(
        `TELEGRAM_WEBHOOK_URL must be an HTTPS URL ending in ${WEBHOOK_PATH}`,
      );
    }

    if (
      !WEBHOOK_SECRET_PATTERN.test(
        readString(env, 'TELEGRAM_WEBHOOK_SECRET_TOKEN'),
      )
    ) {
      throw new Error(
        'TELEGRAM_WEBHOOK_SECRET_TOKEN must be 1-256 URL-safe characters',
      );
    }
  }

  return env;
};
