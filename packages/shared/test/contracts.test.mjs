import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import {
  ZActorSchema,
  ZCommandEnvelopeSchema,
  ZEventEnvelopeSchema,
  ZAuthUserStatusEnum,
  ZAgencyNodeStatusEnum,
  ZOrderStatusEnum,
  ZPaymentTransactionStatusEnum,
  ZServiceLifecycleStatusEnum,
} from '@app/shared';

const metadata = {
  idempotencyKey: 'request-01',
  actor: { kind: 'user', id: 'user-01' },
  occurredAt: '2026-09-07T10:00:00+08:00',
  correlationId: 'workflow-01',
  causationId: null,
};
const command = {
  ...metadata,
  commandId: 'command-01',
  commandVersion: 1,
  commandType: 'order.cancel',
  payload: { orderId: 'order-01', reason: 'changed plans' },
};
const event = {
  ...metadata,
  eventId: 'event-01',
  eventVersion: 1,
  eventType: 'order.cancelled',
  causationId: command.commandId,
  payload: { orderId: 'order-01', nested: [null, true, 12.5] },
};

test('built package supports native ESM and CommonJS consumers', () => {
  const required = createRequire(import.meta.url)('@app/shared');
  assert.equal(required.OrderStatus.RESERVED, 'RESERVED');
  assert.equal(required.ZEventEnvelopeSchema, ZEventEnvelopeSchema);
});

test('command and event metadata survive a JSON round trip without defaults', () => {
  assert.deepEqual(ZCommandEnvelopeSchema.parse(JSON.parse(JSON.stringify(command))), command);
  assert.deepEqual(ZEventEnvelopeSchema.parse(JSON.parse(JSON.stringify(event))), event);
  assert.equal(ZEventEnvelopeSchema.safeParse({ ...event, occurredAt: '2026-09-07T02:00:00Z' }).success, true);
});

test('every audit field and the concrete message identity are mandatory', () => {
  for (const [schema, value] of [[ZCommandEnvelopeSchema, command], [ZEventEnvelopeSchema, event]]) {
    for (const key of Object.keys(value)) {
      const candidate = { ...value };
      delete candidate[key];
      assert.equal(schema.safeParse(candidate).success, false, `missing ${key}`);
    }
  }
});

test('invalid identity, version, actor, timestamp and unknown headers fail', () => {
  const invalid = [
    { eventId: '' }, { eventVersion: 0 }, { eventVersion: 1.5 },
    { idempotencyKey: '   ' }, { correlationId: ' padded ' },
    { causationId: undefined }, { occurredAt: '2026-09-07T10:00:00' },
    { actor: { kind: 'user', id: null } },
    { actor: { kind: 'anonymous', id: 'spoofed-user' } },
    { actor: { kind: 'system', id: 'worker', roles: ['ADMIN'] } },
    { unexpectedHeader: true },
  ];
  for (const patch of invalid) {
    assert.equal(ZEventEnvelopeSchema.safeParse({ ...event, ...patch }).success, false);
  }
  assert.equal(ZActorSchema.safeParse({ kind: 'anonymous', id: null }).success, true);
  assert.equal(ZActorSchema.safeParse({ kind: 'system', id: 'payment-worker' }).success, true);
});

test('payloads reject values which cannot be faithfully represented on the wire', () => {
  for (const value of [undefined, NaN, Infinity, -0, 1n, () => 1, new Date()]) {
    assert.equal(ZEventEnvelopeSchema.safeParse({ ...event, payload: { nested: value } }).success, false);
  }
});

test('public state vocabularies preserve current wire casing and reject drift', () => {
  const vocabularies = [
    [ZAuthUserStatusEnum, ['ACTIVE', 'MERGED', 'DISABLED']],
    [ZAgencyNodeStatusEnum, ['ACTIVE', 'INACTIVE', 'DELETED']],
    [ZOrderStatusEnum, ['PENDING', 'RESERVED', 'COMPLETED', 'CANCELLED', 'FORFEITED', 'DISPUTED']],
    [ZPaymentTransactionStatusEnum, ['pending', 'success', 'failed', 'cancelled']],
    [ZServiceLifecycleStatusEnum, ['ACTIVE', 'INACTIVE', 'DELETED']],
  ];
  for (const [schema, expected] of vocabularies) {
    assert.deepEqual(schema.options, expected);
    assert.equal(schema.safeParse('UNKNOWN').success, false);
  }
  assert.equal(ZPaymentTransactionStatusEnum.safeParse('SUCCESS').success, false);
  assert.equal(ZAgencyNodeStatusEnum.safeParse('SUSPENDED').success, false);
});
