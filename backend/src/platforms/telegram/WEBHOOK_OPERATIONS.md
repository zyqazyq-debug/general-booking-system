# Telegram Webhook Operation Boundary

Webhook delivery uses Nest at `POST /telegram/webhook`, without the `/api`
prefix. Configure the complete URL explicitly:

```text
TELEGRAM_BOT_MODE=webhook
TELEGRAM_ENABLE_WEBHOOK=true
TELEGRAM_WEBHOOK_URL=https://your-public-host/telegram/webhook
TELEGRAM_WEBHOOK_SECRET_TOKEN=<1-256 chars: A-Z a-z 0-9 _ ->
```

`TELEGRAM_WEBHOOK_URL` must be HTTPS and its path must be exactly
`/telegram/webhook`; it is never derived from `API_URL`. Incoming requests
must include the matching `X-Telegram-Bot-Api-Secret-Token` header.

`TELEGRAM_BOT_MODE` is a mutually exclusive delivery choice. In `webhook`
mode, `TELEGRAM_ENABLE_WEBHOOK` must be `true` and the URL and secret above
are required. In `polling` mode, `TELEGRAM_ENABLE_WEBHOOK` must be `false`.
Polling itself is separately opt-in as described below.

Normal starts do not call Telegram `setWebhook` or `deleteWebhook`. The
application does not import or invoke the one-shot operator command. Register
the webhook only through the explicit Compose profile after the candidate is
healthy and its ingress probe has passed. The operation requires `action=set`,
an exact environment, an expected bot id and/or username, and the environment's
exact HTTPS URL: `https://booking-preprod.happybooking.uk/telegram/webhook`
for preproduction or `https://app.happybooking.uk/telegram/webhook` for
production. Arbitrary HTTPS hosts are rejected. Before contacting Telegram it
calls that host's exact `/readyz` URL and requires the expected release ID,
full Git SHA, manifest digest, config schema, migration catalog digest and
migration floor. Readiness itself checks the database migration-ledger head.
It then calls `getMe` and fails if the bot identity differs; after `setWebhook` it calls
`getWebhookInfo` and fails if the URL differs. There is deliberately no
automatic delete action.

Credentials must be supplied as `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_WEBHOOK_SECRET_TOKEN`, and the stable
`TELEGRAM_DATA_ENCRYPTION_SECRET`, or by their corresponding `_FILE`
variables. The data-encryption secret is independent from JWT signing-key
rotation and must be preserved while encrypted login or mutation results can
still exist.
Never pass either secret on the command line. The success output is a
non-sensitive one-line JSON receipt; archive that receipt with the release
evidence.

Preproduction example (the two expected identity variables may be set, or one
may be left empty):

```sh
docker compose -f ops/compose/compose.preprod.yml \
  --profile telegram-webhook-set run --rm telegram-webhook-set
```

Production uses the same service name in `compose.release.yml` and is allowed
only after the release gates, database backup, migration, candidate health,
and rollback verification have passed. The profile pins the backend image by
digest and forces `BOOKING_RUNTIME_ROLE=standby`,
`BOOKING_WORKERS_ENABLED=false`, and `TELEGRAM_ENABLE_WEBHOOK=false` so the
one-shot process cannot also start workers or the application webhook runtime.

Polling is disabled unless
`TELEGRAM_POLLING_DELETE_WEBHOOK_ON_STARTUP=true` is intentionally set. This
prevents a process started with a shared production token from silently
removing a live webhook. This flag is forbidden in production: production
startup never registers or deletes a webhook. Development, staging, and
production must use different bot tokens.
