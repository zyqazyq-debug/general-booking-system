import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { isAbsolute } from 'node:path';

type EnvMap = Record<string, unknown>;

const MAX_SECRET_BYTES = 16 * 1024;
const FILE_SECRET_BINDINGS = Object.freeze({
  POSTGRES_PASSWORD: 'POSTGRES_PASSWORD_FILE',
  REDIS_PASSWORD: 'REDIS_PASSWORD_FILE',
  JWT_SECRET1: 'JWT_SECRET1_FILE',
  JWT_SECRET2: 'JWT_SECRET2_FILE',
  TELEGRAM_BOT_TOKEN: 'TELEGRAM_BOT_TOKEN_FILE',
  TELEGRAM_WEBHOOK_SECRET_TOKEN: 'TELEGRAM_WEBHOOK_SECRET_TOKEN_FILE',
  TELEGRAM_DATA_ENCRYPTION_SECRET: 'TELEGRAM_DATA_ENCRYPTION_SECRET_FILE',
});

const value = (env: EnvMap, key: string): string =>
  typeof env[key] === 'string' ? env[key].trim() : '';

export function resolveFileSecrets(input: EnvMap): EnvMap {
  const env = { ...input };
  for (const [secretKey, fileKey] of Object.entries(FILE_SECRET_BINDINGS)) {
    const inline = value(env, secretKey);
    const filePath = value(env, fileKey);
    if (inline && filePath) {
      throw new Error(`${secretKey} and ${fileKey} cannot both be set`);
    }
    if (!filePath) continue;
    if (!isAbsolute(filePath)) {
      throw new Error(`${fileKey} must be an absolute path`);
    }

    let secret: string;
    let descriptor: number | undefined;
    try {
      if (lstatSync(filePath).isSymbolicLink()) {
        throw new Error('invalid secret file');
      }
      descriptor = openSync(
        filePath,
        constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
      );
      const stats = fstatSync(descriptor);
      if (
        !stats.isFile() ||
        stats.size <= 0 ||
        stats.size > MAX_SECRET_BYTES ||
        (process.platform !== 'win32' && (stats.mode & 0o022) !== 0)
      ) {
        throw new Error('invalid secret file');
      }
      secret = readFileSync(descriptor, 'utf8').replace(/[\r\n]+$/, '');
    } catch {
      throw new Error(`${fileKey} cannot be read as a non-empty secret file`);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
    if (!secret || secret.includes('\0')) {
      throw new Error(`${fileKey} cannot be read as a non-empty secret file`);
    }
    env[secretKey] = secret;
  }
  return env;
}
