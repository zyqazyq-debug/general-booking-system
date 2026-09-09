import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function getTelegramDataEncryptionKey(
  configService: Pick<ConfigService, 'get'>,
): Buffer {
  const secret = configService.get<string>(
    'TELEGRAM_DATA_ENCRYPTION_SECRET',
  );
  if (!secret || secret.length < 32) {
    throw new Error('Telegram data encryption key unavailable');
  }
  return createHash('sha256').update(secret).digest();
}

const decodeSegment = (value: string, expectedBytes?: number): Buffer => {
  if (!BASE64URL.test(value)) {
    throw new Error('Telegram encrypted payload is invalid');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.toString('base64url') !== value ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes)
  ) {
    throw new Error('Telegram encrypted payload is invalid');
  }
  return decoded;
};

export function encryptTelegramData(
  value: unknown,
  aad: string,
  configService: Pick<ConfigService, 'get'>,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(
    'aes-256-gcm',
    getTelegramDataEncryptionKey(configService),
    iv,
    { authTagLength: AUTH_TAG_BYTES },
  );
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString('base64url'))
    .join('.');
}

export function decryptTelegramData<T>(
  payload: string,
  aad: string,
  configService: Pick<ConfigService, 'get'>,
): T {
  const parts = payload.split('.');
  if (parts.length !== 3) {
    throw new Error('Telegram encrypted payload is invalid');
  }
  const iv = decodeSegment(parts[0], IV_BYTES);
  const tag = decodeSegment(parts[1], AUTH_TAG_BYTES);
  const ciphertext = decodeSegment(parts[2]);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    getTelegramDataEncryptionKey(configService),
    iv,
    { authTagLength: AUTH_TAG_BYTES },
  );
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext) as T;
}
