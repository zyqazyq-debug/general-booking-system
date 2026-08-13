type EnvMap = Record<string, unknown>;

const readString = (env: EnvMap, key: string): string =>
  typeof env[key] === 'string' ? env[key].trim() : '';

const readBoolean = (env: EnvMap, key: string): boolean =>
  readString(env, key).toLowerCase() === 'true';

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
  requireWhen(readBoolean(env, 'TELEGRAM_ENABLE_WEBHOOK'), 'API_URL', env);

  return env;
};
