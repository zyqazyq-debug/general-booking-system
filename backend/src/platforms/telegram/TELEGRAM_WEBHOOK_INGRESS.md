# Telegram Webhook External Ingress Declaration

| Field               | Audited value                                  |
| ------------------- | ---------------------------------------------- |
| Endpoint            | `POST /telegram/webhook`                       |
| Owner               | `platforms/telegram`                           |
| External adapter    | Telegram Bot API to durable inbox to Telegraf  |
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
  timing-safe comparison before claiming `update_id` in the durable inbox.
- Completed updates are acknowledged without re-entering Telegraf. Failed
  handlers release only their fenced claim and return HTTP 500 for retry.
- While a handler is running, the inbox renews its fenced lease every one-third
  of the configured lease period. A failed renewal or lost fencing token is
  never acknowledged as success.
- Concurrent deliveries for an update that is still processing return HTTP
  503, so a crash cannot turn an in-flight duplicate into a false success.
- Nest records successful completion before HTTP 200; Telegraf interprets the
  Update through `handleUpdate` but does not own the HTTP response.
- `@ApiExcludeEndpoint()` is intentional and tested: it records that Swagger
  and generated clients must not silently treat this external ingress as a
  public API operation.
- Release operations separately check the root path, webhook secret, and
  external Telegram configuration; this declaration does not authorize any
  BotFather, NAS, or webhook mutation.

## Delivery semantics and remaining boundary

This ingress provides **at-least-once processing with durable `update_id`
deduplication**. It deliberately does not claim exactly-once execution.

The database row prevents a normal concurrent/repeated delivery from entering
Telegraf twice, and renewal prevents a legitimately long handler from losing
its lease under normal database availability. There is still an unavoidable
crash window after a handler performs an external Telegram API call and before
the inbox row is marked `processed`. A retry can repeat that external call.
Similarly, a database outage lasting longer than the lease can prevent the
running process from proving continued ownership; Telegraf handlers do not
support cooperative cancellation once arbitrary business/external work has
started.

Consequences:

- Telegram message send/edit/delete, callback answers, chat actions and file
  downloads are not exactly-once. Their output must be safe for users to see
  more than once.
- Business writes should additionally use a domain-owned idempotency key where
  the domain supports one. The natural key is
  `telegram:update:<bot-identity>:<update_id>:<operation>`; never use a bot
  token as part of the key or log value.
- HTTP 200 means Telegraf returned and the durable inbox was completed. HTTP
  500/503 requests retry and does not prove that every earlier side effect was
  rolled back.

## Handler side-effect inventory

| Handler path | Database/business effects | External Telegram/network effects | Replay control |
| --- | --- | --- | --- |
| booking `book_date_*` | availability reads only | callback answer; message edit/reply | none needed for reads |
| booking `book_slot_*` | creates an order and freezes booking/credit state through the order domain | callback answer; success/error message edit/reply | stable bot identity + `update_id`; Order owns a unique source key and returns the matching existing order |
| import photo/text/start/confirm | may create/import an agency collection and related service data | Telegram file lookup; HTTPS image download; chat action; replies/cards | persistent `import_collection` attempt fence; replay of completed/failed/uncertain attempts is stopped with an explicit status message |
| markup edit text | updates collection markup | deletes messages; sends replacement card | persistent `update_markup` attempt fence; uncertain replay fails closed |
| referral start | may save `referrer_id` | main keyboard reply | conditional domain update plus persistent `bind_referral` attempt fence |
| login/bind/merge start actions | consumes deep-link/binding token; may bind users or transactionally merge accounts | replies, callback answer, message edits | persistent operation-specific attempt fence; uncertain replay fails closed and directs the user to verify in H5 |
| menu/help/pricing/promote/book prompt | reads/config/session-memory only | replies, callback answers, message edits | none for business state; external output can repeat |
| QR/photo pipeline | no write until delegated import | Telegram file API and remote file download | download/output can repeat; delegated import key as above |

The inbox owns transport deduplication. Order booking additionally owns a true
domain idempotency key and matching replay result. Other Telegram mutations use
an adapter-side durable **single-attempt fence**: the fence is committed before
the business call and is intentionally not deleted when an inbox claim is
released. A completed, failed, or crash-left `started` record prevents another
business attempt. Because these domains cannot atomically commit their result
with the Telegram fence, a retry reports “result pending confirmation” instead
of guessing whether the first attempt committed. This is safe against duplicate
writes but is not exactly-once completion.

Login and binding tickets are durable separately from the process-local cache:
only a SHA-256 ticket hash is stored, and successful login payloads are
AES-256-GCM encrypted with environment key material. A completed recoverable
operation stores its encrypted result before returning. If the process stops
before ticket completion, the same Telegram update can recover that result,
rebuild an empty ticket cache and idempotently complete the H5 ticket without
creating another authentication session.

Before `setWebhook`, the one-shot setter requires `/readyz` to prove all of the
following for the exact candidate identity: `telegramBotMode=webhook`,
`telegramWebhookEnabled=true`, the exact configured public webhook URL, and
the presence of both inbox and operation tables. A generic healthy candidate
running with polling or disabled webhook configuration is not eligible for
Telegram cutover.

## Safe logging contract

Webhook ingress failures log only the controlled fields `event`, `phase`,
decimal `update_id`, and sanitized error class name. Do not log request bodies,
headers, bot/webhook tokens, handler error messages, stack traces, Telegram file
URLs, deep-link tokens, callback payloads, or user text at this boundary.
