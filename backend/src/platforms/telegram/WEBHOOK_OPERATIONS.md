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
application does not invoke the exported setup helpers; register the webhook
through a separately reviewed, one-shot deployment operation, passing the
same URL and secret token. If a future operator command uses the deletion
helper, it additionally requires `TELEGRAM_WEBHOOK_MANAGE_ON_STARTUP=true`
and `TELEGRAM_ALLOW_WEBHOOK_DELETE=true`.

Polling is disabled unless
`TELEGRAM_POLLING_DELETE_WEBHOOK_ON_STARTUP=true` is intentionally set. This
prevents a process started with a shared production token from silently
removing a live webhook. This flag is forbidden in production: production
startup never registers or deletes a webhook. Development, staging, and
production must use different bot tokens.
