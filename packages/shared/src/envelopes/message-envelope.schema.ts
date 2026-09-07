import { z } from 'zod';

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export const ZJsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite().refine((value) => !Object.is(value, -0), 'Negative zero is not preserved by JSON'),
    z.boolean(),
    z.null(),
    z.array(ZJsonValueSchema),
    z.record(ZJsonValueSchema),
  ]),
);

const Identifier = z.string().min(1).max(200).refine(
  (value) => value.trim() === value,
  'Identifiers must not contain leading or trailing whitespace',
);

/** The transport resolves this actor; client-supplied identity is not authority. */
export const ZActorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), id: Identifier }).strict(),
  z.object({ kind: z.literal('system'), id: Identifier }).strict(),
  z.object({ kind: z.literal('anonymous'), id: z.null() }).strict(),
]);
export type Actor = z.infer<typeof ZActorSchema>;

/** No generated IDs, clocks or defaults: callers must supply auditable metadata. */
export const ZEnvelopeMetadataSchema = z.object({
  idempotencyKey: Identifier,
  actor: ZActorSchema,
  occurredAt: z.string().datetime({ offset: true }),
  correlationId: Identifier,
  // Explicit null marks a root message; omission is not equivalent.
  causationId: Identifier.nullable(),
}).strict();

export const ZCommandEnvelopeSchema = ZEnvelopeMetadataSchema.extend({
  commandId: Identifier,
  commandVersion: z.number().int().positive(),
  commandType: Identifier,
  payload: z.record(ZJsonValueSchema),
}).strict();

export const ZEventEnvelopeSchema = ZEnvelopeMetadataSchema.extend({
  eventId: Identifier,
  eventVersion: z.number().int().positive(),
  eventType: Identifier,
  payload: z.record(ZJsonValueSchema),
}).strict();

export type EnvelopeMetadata = z.infer<typeof ZEnvelopeMetadataSchema>;
export type CommandEnvelope = z.infer<typeof ZCommandEnvelopeSchema>;
export type EventEnvelope = z.infer<typeof ZEventEnvelopeSchema>;
