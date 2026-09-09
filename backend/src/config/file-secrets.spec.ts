import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveFileSecrets } from './file-secrets';

describe('resolveFileSecrets', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'booking-secrets-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('loads a mounted secret and removes its trailing newline', () => {
    const file = join(directory, 'postgres-password');
    writeFileSync(file, 'mounted-secret\n', { mode: 0o600 });

    expect(resolveFileSecrets({ POSTGRES_PASSWORD_FILE: file })).toMatchObject({
      POSTGRES_PASSWORD: 'mounted-secret',
    });
  });

  it('maps the dedicated Telegram data encryption secret file', () => {
    const file = join(directory, 'telegram-data-encryption-secret');
    writeFileSync(file, 'independent-telegram-data-key-material\n', {
      mode: 0o600,
    });
    expect(
      resolveFileSecrets({ TELEGRAM_DATA_ENCRYPTION_SECRET_FILE: file }),
    ).toMatchObject({
      TELEGRAM_DATA_ENCRYPTION_SECRET:
        'independent-telegram-data-key-material',
    });
  });

  it('rejects ambiguous inline and file-backed values', () => {
    const file = join(directory, 'jwt-secret');
    writeFileSync(file, 'mounted-secret', { mode: 0o600 });

    expect(() =>
      resolveFileSecrets({ JWT_SECRET1: 'inline', JWT_SECRET1_FILE: file }),
    ).toThrow('cannot both be set');
  });

  it('fails closed for a missing or relative secret file', () => {
    expect(() =>
      resolveFileSecrets({ TELEGRAM_BOT_TOKEN_FILE: 'relative/token' }),
    ).toThrow('must be an absolute path');
    expect(() =>
      resolveFileSecrets({ REDIS_PASSWORD_FILE: join(directory, 'missing') }),
    ).toThrow('cannot be read');
  });

  it('rejects writable or symbolic-link secret files', () => {
    const writable = join(directory, 'writable-secret');
    writeFileSync(writable, 'secret', { mode: 0o600 });
    chmodSync(writable, 0o622);
    if (process.platform !== 'win32') {
      expect(() =>
        resolveFileSecrets({ POSTGRES_PASSWORD_FILE: writable }),
      ).toThrow('cannot be read');
    }

    const link = join(directory, 'secret-link');
    symlinkSync(writable, link);
    expect(() =>
      resolveFileSecrets({ REDIS_PASSWORD_FILE: link }),
    ).toThrow('cannot be read');
  });
});
