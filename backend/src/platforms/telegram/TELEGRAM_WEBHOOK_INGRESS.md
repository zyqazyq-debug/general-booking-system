# Telegram Webhook External Ingress Declaration

| Field               | Audited value                                  |
| ------------------- | ---------------------------------------------- |
| Endpoint            | `POST /telegram/webhook`                       |
| Owner               | `platforms/telegram`                           |
| External adapter    | Telegram Bot API to Telegraf `webhookCallback` |
| Public SDK exposure | Excluded from Swagger and generated clients    |
| Review due          | 2026-12-07                                     |

This is an external-provider ingress, not a public Booking System API. Its
request body stays as the raw Express request because Telegram owns the Update
schema and Telegraf is the sole adapter that interprets it. Do not introduce a
generic `object` DTO or publish a generated SDK operation for this endpoint.

Verification responsibilities:

- `backend/src/main.ts` excludes `telegram/webhook` from the `api` global
  prefix, so the real route is root `/telegram/webhook`.
- `TelegramWebhookController` checks the Telegram secret header using a
  timing-safe comparison before delegating to Telegraf.
- `@ApiExcludeEndpoint()` is intentional and tested: it records that Swagger
  and generated clients must not silently treat this external ingress as a
  public API operation.
- Release operations separately check the root path, webhook secret, and
  external Telegram configuration; this declaration does not authorize any
  BotFather, NAS, or webhook mutation.
