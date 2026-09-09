import axios from 'axios';
import { resolveFileSecrets } from '../config/file-secrets';
import {
  createTelegramHttpConfig,
  type TelegramHttpConfig,
} from '../platforms/telegram/telegram-http-config';

const USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

type TelegramGetMeResponse = {
  ok: true;
  result: { id: number; username: string };
};

function isExpectedBotIdentity(
  value: unknown,
  expectedUsername: string,
): value is TelegramGetMeResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Record<string, unknown>;
  if (
    response.ok !== true ||
    !response.result ||
    typeof response.result !== 'object'
  ) {
    return false;
  }
  const result = response.result as Record<string, unknown>;
  return (
    Number.isSafeInteger(result.id) &&
    (result.id as number) > 0 &&
    result.username === expectedUsername
  );
}

export class TelegramIdentityVerificationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'TelegramIdentityVerificationError';
  }
}

export async function verifyTelegramBotIdentity(
  argv: string[],
  inputEnv: Record<string, unknown> = process.env,
) {
  if (argv.length !== 1 || !argv[0].startsWith('--expected-bot-username=')) {
    throw new TelegramIdentityVerificationError('INVALID_ARGUMENTS');
  }
  const expected = argv[0].slice('--expected-bot-username='.length);
  if (!USERNAME.test(expected))
    throw new TelegramIdentityVerificationError(
      'INVALID_EXPECTED_BOT_USERNAME',
    );
  const env = resolveFileSecrets(inputEnv);
  const token =
    typeof env.TELEGRAM_BOT_TOKEN === 'string'
      ? env.TELEGRAM_BOT_TOKEN.trim()
      : '';
  if (!token)
    throw new TelegramIdentityVerificationError('TELEGRAM_BOT_TOKEN_REQUIRED');
  let httpConfig: TelegramHttpConfig;
  try {
    httpConfig = createTelegramHttpConfig(env.TELEGRAM_PROXY_URL);
  } catch {
    throw new TelegramIdentityVerificationError(
      'TELEGRAM_PROXY_CONFIG_INVALID',
    );
  }
  let body: unknown;
  try {
    const response = await axios.get<unknown>(
      `https://api.telegram.org/bot${token}/getMe`,
      {
        ...httpConfig.axios,
        timeout: 10_000,
        maxContentLength: 64 * 1024,
        maxBodyLength: 64 * 1024,
        validateStatus: (status) => status === 200,
      },
    );
    body = response.data;
  } catch {
    throw new TelegramIdentityVerificationError('TELEGRAM_GETME_FAILED');
  }
  if (!isExpectedBotIdentity(body, expected)) {
    throw new TelegramIdentityVerificationError(
      'TELEGRAM_BOT_IDENTITY_MISMATCH',
    );
  }
  return {
    schema: 'booking.telegram-bot-identity/v1',
    action: 'getMe',
    botId: body.result.id,
    botUsername: expected,
    observedAt: new Date().toISOString(),
  };
}

if (require.main === module) {
  verifyTelegramBotIdentity(process.argv.slice(2))
    .then((receipt) => process.stdout.write(`${JSON.stringify(receipt)}\n`))
    .catch((error) => {
      const code =
        error instanceof TelegramIdentityVerificationError
          ? error.code
          : 'TELEGRAM_IDENTITY_UNEXPECTED_FAILURE';
      process.stderr.write(
        `${JSON.stringify({ schema: 'booking.telegram-bot-identity-error/v1', status: 'fail', code })}\n`,
      );
      process.exitCode = 1;
    });
}
