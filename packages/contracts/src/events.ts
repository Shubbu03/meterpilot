import { z } from "zod";

import { requestIdSchema } from "./common";

export const MAX_EVENT_BATCH_SIZE = 500;
export const MAX_EVENT_SIZE_BYTES = 64 * 1024;
export const MAX_EVENT_SINGLE_BODY_SIZE_BYTES = MAX_EVENT_SIZE_BYTES + 4 * 1024;
export const MAX_EVENT_BATCH_BODY_SIZE_BYTES =
  MAX_EVENT_BATCH_SIZE * MAX_EVENT_SIZE_BYTES + 1024 * 1024;
export const MAX_EVENT_PROPERTY_DEPTH = 5;
export const MAX_EVENT_PROPERTY_KEYS = 100;
export const MAX_EVENT_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const MAX_EVENT_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const SAFE_EXTERNAL_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export const eventIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(SAFE_EXTERNAL_KEY_PATTERN, "must contain only safe identifier characters");

export const eventParamSchema = z.strictObject({
  eventKey: eventIdSchema,
});

export const eventTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(EVENT_TYPE_PATTERN, "must be a lowercase dotted event type");

export const subjectKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(SAFE_EXTERNAL_KEY_PATTERN, "must contain only safe identifier characters");

export const decimalStringSchema = z
  .string()
  .max(128)
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/, "must be a plain decimal string");

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

function inspectProperties(value: JsonValue, depth = 0): { depth: number; keys: number } {
  if (value === null || typeof value !== "object") {
    return { depth, keys: 0 };
  }

  if (Array.isArray(value)) {
    return value.reduce<{ depth: number; keys: number }>(
      (result, item) => {
        const inspected = inspectProperties(item, depth + 1);
        return {
          depth: Math.max(result.depth, inspected.depth),
          keys: result.keys + inspected.keys,
        };
      },
      { depth, keys: 0 },
    );
  }

  return Object.entries(value).reduce(
    (result, [, item]) => {
      const inspected = inspectProperties(item, depth + 1);
      return {
        depth: Math.max(result.depth, inspected.depth),
        keys: result.keys + inspected.keys + 1,
      };
    },
    { depth, keys: 0 },
  );
}

export const eventPropertiesSchema = z
  .record(z.string().min(1).max(128), jsonValueSchema)
  .superRefine((properties, context) => {
    const inspected = inspectProperties(properties);

    if (inspected.depth > MAX_EVENT_PROPERTY_DEPTH) {
      context.addIssue({
        code: "custom",
        message: `must not exceed ${MAX_EVENT_PROPERTY_DEPTH} nested levels`,
      });
    }

    if (inspected.keys > MAX_EVENT_PROPERTY_KEYS) {
      context.addIssue({
        code: "custom",
        message: `must not contain more than ${MAX_EVENT_PROPERTY_KEYS} keys`,
      });
    }
  });

export const usageEventSchema = z
  .strictObject({
    id: eventIdSchema,
    occurredAt: z.iso.datetime({ offset: true }),
    properties: eventPropertiesSchema.default({}),
    subject: subjectKeySchema,
    type: eventTypeSchema,
  })
  .superRefine((event, context) => {
    const size = new TextEncoder().encode(JSON.stringify(event)).byteLength;

    if (size > MAX_EVENT_SIZE_BYTES) {
      context.addIssue({
        code: "custom",
        message: `must not exceed ${MAX_EVENT_SIZE_BYTES} bytes`,
      });
    }
  });

export type UsageEvent = z.output<typeof usageEventSchema>;

export type EventTimeValidationOptions = Readonly<{
  maxAgeMs?: number;
  maxFutureSkewMs?: number;
  now: Date;
}>;

export function createUsageEventSchema(options: EventTimeValidationOptions) {
  const now = options.now.getTime();
  const maxAgeMs = options.maxAgeMs ?? MAX_EVENT_AGE_MS;
  const maxFutureSkewMs = options.maxFutureSkewMs ?? MAX_EVENT_FUTURE_SKEW_MS;

  if (!Number.isFinite(now)) {
    throw new TypeError("Event validation requires a valid current time.");
  }

  if (maxAgeMs < 0 || maxFutureSkewMs < 0) {
    throw new RangeError("Event time limits must not be negative.");
  }

  return usageEventSchema.superRefine((event, context) => {
    const occurredAt = Date.parse(event.occurredAt);

    if (occurredAt > now + maxFutureSkewMs) {
      context.addIssue({
        code: "custom",
        message: "must not be more than five minutes in the future",
        path: ["occurredAt"],
      });
    }

    if (occurredAt < now - maxAgeMs) {
      context.addIssue({
        code: "custom",
        message: "is outside the accepted late-event window",
        path: ["occurredAt"],
      });
    }
  });
}

export function createUsageEventBatchSchema(options: EventTimeValidationOptions) {
  return z.strictObject({
    events: z.array(createUsageEventSchema(options)).min(1).max(MAX_EVENT_BATCH_SIZE),
  });
}

export const usageEventBatchEnvelopeSchema = z.strictObject({
  events: z.array(z.unknown()).min(1).max(MAX_EVENT_BATCH_SIZE),
});

export const eventProcessingStateSchema = z.enum(["pending", "processing", "processed", "failed"]);

export const storedUsageEventSchema = z.strictObject({
  id: eventIdSchema,
  occurredAt: z.iso.datetime({ offset: true }),
  processingState: eventProcessingStateSchema,
  properties: eventPropertiesSchema,
  receivedAt: z.iso.datetime({ offset: true }),
  subject: subjectKeySchema,
  type: eventTypeSchema,
});

export const usageEventResponseSchema = z.strictObject({
  event: storedUsageEventSchema,
  requestId: requestIdSchema,
});

const acceptedEventResultSchema = z.strictObject({
  id: eventIdSchema,
  status: z.literal("accepted"),
});

const duplicateEventResultSchema = z.strictObject({
  id: eventIdSchema,
  status: z.literal("duplicate"),
});

const conflictedEventResultSchema = z.strictObject({
  id: eventIdSchema,
  status: z.literal("idempotency_conflict"),
});

const rejectedEventResultSchema = z.strictObject({
  code: z.string().min(1).max(128),
  id: eventIdSchema.optional(),
  message: z.string().min(1).max(512),
  status: z.literal("rejected"),
});

export const eventIngestionResultSchema = z.discriminatedUnion("status", [
  acceptedEventResultSchema,
  duplicateEventResultSchema,
  conflictedEventResultSchema,
  rejectedEventResultSchema,
]);

export const eventIngestionResponseSchema = z.strictObject({
  requestId: requestIdSchema,
  results: z.array(eventIngestionResultSchema).min(1).max(MAX_EVENT_BATCH_SIZE),
});

export type EventIngestionResult = z.infer<typeof eventIngestionResultSchema>;
export type EventIngestionResponse = z.infer<typeof eventIngestionResponseSchema>;
export type EventProcessingState = z.infer<typeof eventProcessingStateSchema>;
export type StoredUsageEvent = z.infer<typeof storedUsageEventSchema>;
