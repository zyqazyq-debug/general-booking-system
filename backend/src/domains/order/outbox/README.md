# Order transactional outbox

`order.created` is persisted in `order_outbox_events` by the same
`EntityManager` transaction that inserts the order and freezes customer credit.
The order transaction is rolled back if the outbox insert fails. A process crash
after commit therefore leaves a queryable `pending` event instead of losing the
domain event.

## Delivery contract

- Event identity is the outbox UUID in `payload.eventId`; logical uniqueness is
  `order.created:<order_id>`.
- A dispatcher atomically changes an eligible row from `pending` to
  `processing`, assigns a random claim token, increments `attempts`, and grants a
  60-second lease.
- The lease is renewed while in-process listeners run. Only the current claim
  token may mark the row `processed` or requeue it.
- Failure returns the row to `pending` with bounded exponential backoff and a
  sanitized diagnostic. An expired `processing` lease is reclaimable after a
  crashed worker.
- Dispatch is fail-closed. It starts only when both
  `BOOKING_WORKERS_ENABLED=true` and `ORDER_OUTBOX_DISPATCH_ENABLED=true`.
  Standby, migration and ordinary API containers must leave at least one flag
  false. When enabled, startup and a five-second poll recover due work.
  Replaying an idempotent order creation also looks up and attempts that
  order's outbox event immediately.
- Processed rows remain queryable. Retention must archive by policy; it must not
  delete pending or processing rows.

Delivery is **at least once**. A crash after a listener side effect but before
the processed compare-and-set can redeliver the same `eventId`. Every durable or
external consumer must therefore persist its own unique consumption key before
performing a non-repeatable effect. The outbox does not make Telegram/network
side effects exactly once by itself.

## Existing consumer audit

| Consumer                        | Redelivery safety                                          | Required action                                         |
| ------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| Availability cache invalidation | Naturally repeatable                                       | None                                                    |
| New-order notification          | Durable per-event/per-role recipient state                 | Reconcile `uncertain`; never auto-resend                |
| Agency commission calculation   | Receipt and commission rows share one database transaction | Duplicate receipt suppresses the complete recalculation |

The dispatcher can be explicitly enabled in isolated preproduction after
migrations `1788750000000` and `1788760000000` are verified. Its default must
remain false. Any notification delivery in `uncertain` keeps the outbox event
retrying but cannot trigger another external send; release operators must
reconcile that delivery row and the provider audit trail manually.

The preproduction compose file exposes this as an explicit, default-off pair:
`BOOKING_PREPROD_WORKERS_ENABLED=true` and
`BOOKING_PREPROD_ORDER_OUTBOX_DISPATCH_ENABLED=true`. Production blue/green
slots have separate default-off dispatcher flags and must not inherit the
preproduction decision.
