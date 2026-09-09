import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { resolveFileSecrets } from '../config/file-secrets';

type EnvMap = Record<string, unknown>;

type TelegramBotIdentity = {
  id: number;
  username?: string;
};

type TelegramWebhookInfo = {
  url: string;
  pending_update_count: number;
  max_connections?: number;
};

type TelegramResponse<T> = {
  ok: boolean;
  result: T;
};

type CandidateReadiness = {
  status: string;
  releaseId: string;
  gitSha: string;
  manifestDigest: string;
  configSchema: string;
  migrationFloor: string;
  migrationCatalogDigest: string;
  telegramBotMode: string;
  telegramWebhookEnabled: boolean;
  telegramWebhookUrl: string;
};

export type TelegramWebhookArguments = {
  action: 'set' | 'verify';
  environment: 'preproduction' | 'production';
  expectedBotId?: number;
  expectedBotUsername?: string;
  url: string;
  readyUrl: string;
  expectedReleaseId: string;
  expectedGitSha: string;
  expectedManifestDigest: string;
  expectedConfigSchema: string;
  expectedMigrationFloor: string;
  expectedMigrationCatalogDigest: string;
};

export type TelegramWebhookReceipt = {
  schemaVersion: 1;
  action: 'set' | 'verify';
  environment: 'preproduction' | 'production';
  completedAt: string;
  bot: {
    id: number;
    username: string;
  };
  candidate: {
    releaseId: string;
    gitSha: string;
    manifestDigest: string;
    configSchema: string;
    migrationFloor: string;
    migrationCatalogDigest: string;
  };
  webhook: {
    url: string;
    pendingUpdateCount: number;
    maxConnections?: number;
  };
  verification: {
    candidateReady: true;
    getMeIdentityMatched: true;
    setWebhookAccepted?: true;
    readBackUrlMatched: true;
  };
};

export class TelegramWebhookOperationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'TelegramWebhookOperationError';
  }
}

const EXPECTED_WEBHOOK_PATH = '/telegram/webhook';
const WEBHOOK_HOST_BY_ENVIRONMENT = Object.freeze({
  preproduction: 'booking-preprod.happybooking.uk',
  production: 'app.happybooking.uk',
});
const BOT_USERNAME_PATTERN = /^[A-Za-z0-9_]{5,32}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const RELEASE_ID_PATTERN = /^booking-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const MIGRATION_FLOOR_PATTERN = /^[0-9]{10,}-[A-Za-z0-9][A-Za-z0-9-]*$/;

function parseNamedArguments(argv: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const item of argv) {
    const match = /^--([a-z0-9-]+)=(.*)$/.exec(item);
    if (!match || Object.hasOwn(parsed, match[1])) {
      throw new TelegramWebhookOperationError('INVALID_ARGUMENTS');
    }
    parsed[match[1]] = match[2];
  }
  return parsed;
}

export function validateTelegramWebhookArguments(
  argv: string[],
): TelegramWebhookArguments {
  const parsed = parseNamedArguments(argv);
  const allowed = new Set([
    'action',
    'environment',
    'expected-bot-id',
    'expected-bot-username',
    'url',
    'ready-url',
    'expected-release-id',
    'expected-git-sha',
    'expected-manifest-digest',
    'expected-config-schema',
    'expected-migration-floor',
    'expected-migration-catalog-digest',
  ]);
  if (Object.keys(parsed).some((key) => !allowed.has(key))) {
    throw new TelegramWebhookOperationError('INVALID_ARGUMENTS');
  }
  if (!['set', 'verify'].includes(parsed.action)) {
    throw new TelegramWebhookOperationError('INVALID_ACTION');
  }
  if (!['preproduction', 'production'].includes(parsed.environment)) {
    throw new TelegramWebhookOperationError('INVALID_ENVIRONMENT');
  }

  const expectedBotIdText = parsed['expected-bot-id'];
  const expectedBotUsername = parsed['expected-bot-username'];
  if (!expectedBotIdText && !expectedBotUsername) {
    throw new TelegramWebhookOperationError('EXPECTED_BOT_IDENTITY_REQUIRED');
  }
  let expectedBotId: number | undefined;
  if (expectedBotIdText) {
    expectedBotId = Number(expectedBotIdText);
    if (!Number.isSafeInteger(expectedBotId) || expectedBotId <= 0) {
      throw new TelegramWebhookOperationError('INVALID_EXPECTED_BOT_ID');
    }
  }
  if (expectedBotUsername && !BOT_USERNAME_PATTERN.test(expectedBotUsername)) {
    throw new TelegramWebhookOperationError('INVALID_EXPECTED_BOT_USERNAME');
  }

  const expectedHost =
    WEBHOOK_HOST_BY_ENVIRONMENT[
      parsed.environment as keyof typeof WEBHOOK_HOST_BY_ENVIRONMENT
    ];
  try {
    const url = new URL(parsed.url);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== expectedHost ||
      url.username ||
      url.password ||
      url.pathname !== EXPECTED_WEBHOOK_PATH ||
      url.search ||
      url.hash ||
      url.toString() !== parsed.url
    ) {
      throw new Error('invalid URL');
    }
  } catch {
    throw new TelegramWebhookOperationError('INVALID_WEBHOOK_URL');
  }
  try {
    const readyUrl = new URL(parsed['ready-url']);
    if (
      readyUrl.protocol !== 'https:' ||
      readyUrl.hostname !== expectedHost ||
      readyUrl.username ||
      readyUrl.password ||
      readyUrl.pathname !== '/readyz' ||
      readyUrl.search ||
      readyUrl.hash ||
      readyUrl.toString() !== parsed['ready-url']
    ) {
      throw new Error();
    }
  } catch {
    throw new TelegramWebhookOperationError('INVALID_READY_URL');
  }
  if (!RELEASE_ID_PATTERN.test(parsed['expected-release-id'])) {
    throw new TelegramWebhookOperationError('INVALID_EXPECTED_RELEASE_ID');
  }
  if (!GIT_SHA_PATTERN.test(parsed['expected-git-sha'])) {
    throw new TelegramWebhookOperationError('INVALID_EXPECTED_GIT_SHA');
  }
  if (!DIGEST_PATTERN.test(parsed['expected-manifest-digest'])) {
    throw new TelegramWebhookOperationError('INVALID_EXPECTED_MANIFEST_DIGEST');
  }
  if (
    !/^booking\.config\/v[1-9][0-9]*$/.test(parsed['expected-config-schema'])
  ) {
    throw new TelegramWebhookOperationError('INVALID_EXPECTED_CONFIG_SCHEMA');
  }
  if (!MIGRATION_FLOOR_PATTERN.test(parsed['expected-migration-floor'])) {
    throw new TelegramWebhookOperationError('INVALID_EXPECTED_MIGRATION_FLOOR');
  }
  if (!DIGEST_PATTERN.test(parsed['expected-migration-catalog-digest'])) {
    throw new TelegramWebhookOperationError(
      'INVALID_EXPECTED_MIGRATION_CATALOG_DIGEST',
    );
  }

  return {
    action: parsed.action as 'set' | 'verify',
    environment: parsed.environment as 'preproduction' | 'production',
    expectedBotId,
    expectedBotUsername,
    url: parsed.url,
    readyUrl: parsed['ready-url'],
    expectedReleaseId: parsed['expected-release-id'],
    expectedGitSha: parsed['expected-git-sha'],
    expectedManifestDigest: parsed['expected-manifest-digest'],
    expectedConfigSchema: parsed['expected-config-schema'],
    expectedMigrationFloor: parsed['expected-migration-floor'],
    expectedMigrationCatalogDigest: parsed['expected-migration-catalog-digest'],
  };
}

function verifiedResult<T>(value: unknown, code: string): T {
  if (!value || typeof value !== 'object') {
    throw new TelegramWebhookOperationError(code);
  }
  const response = value as TelegramResponse<T>;
  if (response.ok !== true || response.result === undefined) {
    throw new TelegramWebhookOperationError(code);
  }
  return response.result;
}

export async function setTelegramWebhook(
  argv: string[],
  input: EnvMap = process.env,
  now: () => Date = () => new Date(),
): Promise<TelegramWebhookReceipt> {
  const args = validateTelegramWebhookArguments(argv);
  const resolved = resolveFileSecrets(input);
  const config = new ConfigService(resolved);
  if (config.get<string>('NODE_ENV')?.trim() !== args.environment) {
    throw new TelegramWebhookOperationError('RUNTIME_ENVIRONMENT_MISMATCH');
  }
  const token = config.get<string>('TELEGRAM_BOT_TOKEN')?.trim();
  const secret = config.get<string>('TELEGRAM_WEBHOOK_SECRET_TOKEN')?.trim();
  if (!token) {
    throw new TelegramWebhookOperationError('BOT_TOKEN_REQUIRED');
  }
  if (args.action === 'set' && (!secret || !SECRET_PATTERN.test(secret))) {
    throw new TelegramWebhookOperationError('WEBHOOK_SECRET_REQUIRED');
  }

  // Telegram requires the token in the Bot API path. Errors are deliberately
  // collapsed below so neither the URL nor an Axios diagnostic can disclose it.
  const apiBase = `https://api.telegram.org/bot${token}`;
  try {
    const readyResponse = await axios.get(args.readyUrl, { timeout: 15_000 });
    const ready = readyResponse.data as CandidateReadiness;
    if (
      !ready ||
      ready.status !== 'ready' ||
      ready.releaseId !== args.expectedReleaseId ||
      ready.gitSha !== args.expectedGitSha ||
      ready.manifestDigest !== args.expectedManifestDigest ||
      ready.configSchema !== args.expectedConfigSchema ||
      ready.migrationFloor !== args.expectedMigrationFloor ||
      ready.migrationCatalogDigest !== args.expectedMigrationCatalogDigest ||
      ready.telegramBotMode !== 'webhook' ||
      ready.telegramWebhookEnabled !== true ||
      ready.telegramWebhookUrl !== args.url
    ) {
      throw new TelegramWebhookOperationError(
        'CANDIDATE_READINESS_IDENTITY_MISMATCH',
      );
    }
    const identityResponse = await axios.get(`${apiBase}/getMe`, {
      timeout: 15_000,
    });
    const identity = verifiedResult<TelegramBotIdentity>(
      identityResponse.data,
      'GET_ME_REJECTED',
    );
    if (
      !Number.isSafeInteger(identity.id) ||
      !identity.username ||
      !BOT_USERNAME_PATTERN.test(identity.username)
    ) {
      throw new TelegramWebhookOperationError('INVALID_BOT_IDENTITY_RESPONSE');
    }
    if (
      (args.expectedBotId !== undefined &&
        identity.id !== args.expectedBotId) ||
      (args.expectedBotUsername !== undefined &&
        identity.username !== args.expectedBotUsername)
    ) {
      throw new TelegramWebhookOperationError('BOT_IDENTITY_MISMATCH');
    }

    if (args.action === 'set') {
      const setResponse = await axios.post(
        `${apiBase}/setWebhook`,
        {
          url: args.url,
          secret_token: secret,
          drop_pending_updates: false,
        },
        { timeout: 15_000 },
      );
      if (
        verifiedResult<boolean>(setResponse.data, 'SET_WEBHOOK_REJECTED') !==
        true
      ) {
        throw new TelegramWebhookOperationError('SET_WEBHOOK_REJECTED');
      }
    }

    const infoResponse = await axios.get(`${apiBase}/getWebhookInfo`, {
      timeout: 15_000,
    });
    const info = verifiedResult<TelegramWebhookInfo>(
      infoResponse.data,
      'GET_WEBHOOK_INFO_REJECTED',
    );
    if (
      info.url !== args.url ||
      !Number.isSafeInteger(info.pending_update_count) ||
      info.pending_update_count < 0
    ) {
      throw new TelegramWebhookOperationError('WEBHOOK_READ_BACK_MISMATCH');
    }

    return {
      schemaVersion: 1,
      action: args.action,
      environment: args.environment,
      completedAt: now().toISOString(),
      bot: { id: identity.id, username: identity.username },
      candidate: {
        releaseId: args.expectedReleaseId,
        gitSha: args.expectedGitSha,
        manifestDigest: args.expectedManifestDigest,
        configSchema: args.expectedConfigSchema,
        migrationFloor: args.expectedMigrationFloor,
        migrationCatalogDigest: args.expectedMigrationCatalogDigest,
      },
      webhook: {
        url: info.url,
        pendingUpdateCount: info.pending_update_count,
        ...(Number.isSafeInteger(info.max_connections)
          ? { maxConnections: info.max_connections }
          : {}),
      },
      verification: {
        candidateReady: true,
        getMeIdentityMatched: true,
        ...(args.action === 'set' ? { setWebhookAccepted: true as const } : {}),
        readBackUrlMatched: true,
      },
    };
  } catch (error) {
    if (error instanceof TelegramWebhookOperationError) throw error;
    throw new TelegramWebhookOperationError('TELEGRAM_API_OPERATION_FAILED');
  }
}

if (require.main === module) {
  void setTelegramWebhook(process.argv.slice(2))
    .then((receipt) => {
      process.stdout.write(`${JSON.stringify(receipt)}\n`);
    })
    .catch((error: unknown) => {
      const code =
        error instanceof TelegramWebhookOperationError
          ? error.code
          : 'TELEGRAM_WEBHOOK_OPERATION_FAILED';
      process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
      process.exitCode = 1;
    });
}
