/**
 * Explicitly records the non-SDK external ingress that owns this raw request.
 * This is an audit declaration, not a Telegram Update DTO: Telegram owns the
 * payload schema and Telegraf is the adapter responsible for interpreting it.
 */
export const TELEGRAM_WEBHOOK_INGRESS_AUDIT = {
  endpoint: 'POST /telegram/webhook',
  owner: 'platforms/telegram',
  externalAdapter: 'Telegram Bot API -> durable inbox -> Telegraf handleUpdate',
  sdkExposure: 'excluded: external adapter ingress, not a public API client',
  reviewDueOn: '2026-12-07',
  verificationResponsibilities: {
    route: 'main.ts excludes telegram/webhook from the api global prefix',
    secret:
      'controller validates X-Telegram-Bot-Api-Secret-Token before Telegraf',
    schema:
      'controller does not model Telegram Update as a public DTO or SDK input',
    idempotency:
      'at-least-once: update_id is durably claimed and lease-renewed before completion; external Telegram effects are not exactly-once',
    operations:
      'Telegram deployment operations verify the root path and secret separately',
  },
} as const;
