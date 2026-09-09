import { ConfigService } from '@nestjs/config';
import {
  decryptTelegramData,
  encryptTelegramData,
  getTelegramDataEncryptionKey,
} from './telegram-data-encryption';

const config = (secret = 'telegram-data-encryption-secret-at-least-32-bytes') =>
  ({ get: jest.fn(() => secret) }) as unknown as ConfigService;

describe('Telegram data encryption', () => {
  it('derives one 256-bit key and round-trips an authenticated payload', () => {
    const service = config();
    expect(getTelegramDataEncryptionKey(service)).toHaveLength(32);
    const payload = encryptTelegramData(
      { access_token: 'sensitive' },
      'binding-token-hash',
      service,
    );
    expect(payload).not.toContain('sensitive');
    expect(
      decryptTelegramData(payload, 'binding-token-hash', service),
    ).toEqual({ access_token: 'sensitive' });
  });

  it('rejects a different context, key, extra segment, short IV or truncated tag', () => {
    const service = config();
    const payload = encryptTelegramData({ ok: true }, 'context-a', service);
    const [iv, tag, ciphertext] = payload.split('.');
    const shortTag = Buffer.from(tag, 'base64url')
      .subarray(0, 4)
      .toString('base64url');
    for (const attempt of [
      () => decryptTelegramData(payload, 'context-b', service),
      () => decryptTelegramData(payload, 'context-a', config('another-independent-secret-at-least-32-bytes')),
      () => decryptTelegramData(`${payload}.ignored`, 'context-a', service),
      () => decryptTelegramData(`AA.${tag}.${ciphertext}`, 'context-a', service),
      () => decryptTelegramData(`${iv}.${shortTag}.${ciphertext}`, 'context-a', service),
    ]) {
      expect(attempt).toThrow();
    }
  });
});
