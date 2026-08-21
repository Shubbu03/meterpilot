import { describe, expect, test } from "bun:test";

import {
  createUsageEventCorrectionRequestSchema,
  createUsageEventBatchSchema,
  createUsageEventSchema,
  decimalStringSchema,
  eventIngestionResponseSchema,
  storedUsageEventSchema,
  MAX_EVENT_BATCH_SIZE,
  usageEventBatchEnvelopeSchema,
  usageEventSchema,
  usageEventCorrectionResponseSchema,
  usageEventListQuerySchema,
} from "../src/events";

const NOW = new Date("2026-08-13T12:00:00.000Z");
const validEvent = {
  id: "evt_01JZ",
  occurredAt: "2026-08-13T11:59:00.000Z",
  properties: {
    inputTokens: "820",
    model: "gpt-x-small",
    outputTokens: "233",
  },
  subject: "workspace_acme",
  type: "llm.tokens.consumed",
};

describe("usage event contracts", () => {
  test("validates bounded event-explorer filters and half-open occurrence ranges", () => {
    expect(
      usageEventListQuerySchema.parse({
        limit: "25",
        occurredAfter: "2026-08-01T00:00:00.000Z",
        occurredBefore: "2026-09-01T00:00:00.000Z",
        processingState: "processed",
      }),
    ).toEqual({
      limit: 25,
      occurredAfter: "2026-08-01T00:00:00.000Z",
      occurredBefore: "2026-09-01T00:00:00.000Z",
      processingState: "processed",
    });
    expect(
      usageEventListQuerySchema.safeParse({
        occurredAfter: "2026-09-01T00:00:00.000Z",
        occurredBefore: "2026-08-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  test("parses the documented event shape", () => {
    expect(createUsageEventSchema({ now: NOW }).parse(validEvent)).toEqual(validEvent);
  });

  test("requires strict safe identifiers and event types", () => {
    expect(usageEventSchema.safeParse({ ...validEvent, unexpected: true }).success).toBeFalse();
    expect(usageEventSchema.safeParse({ ...validEvent, subject: "../other-tenant" }).success).toBe(
      false,
    );
    expect(
      usageEventSchema.safeParse({ ...validEvent, type: "Invalid Event" }).success,
    ).toBeFalse();
  });

  test("accepts plain decimal strings without floating-point coercion", () => {
    expect(decimalStringSchema.parse("1234567890.123456789")).toBe("1234567890.123456789");
    expect(decimalStringSchema.safeParse("1e9").success).toBeFalse();
  });

  test("rejects events outside the occurrence-time window", () => {
    const schema = createUsageEventSchema({ now: NOW });

    expect(
      schema.safeParse({ ...validEvent, occurredAt: "2026-08-13T12:06:00.000Z" }).success,
    ).toBeFalse();
    expect(
      schema.safeParse({ ...validEvent, occurredAt: "2026-05-01T00:00:00.000Z" }).success,
    ).toBeFalse();
  });

  test("rejects oversized and deeply nested properties", () => {
    expect(
      usageEventSchema.safeParse({
        ...validEvent,
        properties: { payload: "x".repeat(64 * 1024) },
      }).success,
    ).toBeFalse();
    expect(
      usageEventSchema.safeParse({
        ...validEvent,
        properties: { one: { two: { three: { four: { five: { six: true } } } } } },
      }).success,
    ).toBeFalse();
  });

  test("enforces the documented batch limit", () => {
    const schema = createUsageEventBatchSchema({ now: NOW });
    const events = Array.from({ length: MAX_EVENT_BATCH_SIZE + 1 }, (_, index) => ({
      ...validEvent,
      id: `evt_${index}`,
    }));

    expect(schema.safeParse({ events }).success).toBeFalse();
    expect(usageEventBatchEnvelopeSchema.safeParse({ events }).success).toBeFalse();
  });

  test("models accepted, duplicate, conflict, and rejected results", () => {
    expect(
      eventIngestionResponseSchema
        .parse({
          requestId: "request_03",
          results: [
            { id: "evt_01", status: "accepted" },
            { id: "evt_02", status: "duplicate" },
            { id: "evt_03", status: "idempotency_conflict" },
            {
              code: "invalid_event",
              id: "evt_04",
              message: "The event is invalid.",
              status: "rejected",
            },
          ],
        })
        .results.map((result) => result.status),
    ).toEqual(["accepted", "duplicate", "idempotency_conflict", "rejected"]);
  });

  test("models persisted event processing state without internal job fields", () => {
    expect(
      storedUsageEventSchema.parse({
        ...validEvent,
        processingState: "pending",
        receivedAt: NOW.toISOString(),
      }),
    ).toEqual({
      correctedBy: null,
      correctionOf: null,
      ...validEvent,
      processingState: "pending",
      propertiesRedactedAt: null,
      receivedAt: NOW.toISOString(),
    });
    expect(
      storedUsageEventSchema.safeParse({
        ...validEvent,
        jobId: "internal",
        processingState: "pending",
        propertiesRedactedAt: null,
        receivedAt: NOW.toISOString(),
      }).success,
    ).toBeFalse();
  });

  test("models bounded reverse and replacement corrections without an age cutoff", () => {
    const correctionSchema = createUsageEventCorrectionRequestSchema({ now: NOW });

    expect(correctionSchema.parse({ id: "evt_reverse", kind: "reverse" })).toEqual({
      id: "evt_reverse",
      kind: "reverse",
    });
    expect(
      correctionSchema.parse({
        event: { ...validEvent, id: "evt_replacement", occurredAt: "2020-01-01T00:00:00.000Z" },
        kind: "replace",
      }),
    ).toMatchObject({ event: { id: "evt_replacement" }, kind: "replace" });
    expect(
      correctionSchema.safeParse({
        event: { ...validEvent, id: "evt_future", occurredAt: "2026-08-13T12:06:00.000Z" },
        kind: "replace",
      }).success,
    ).toBeFalse();
    expect(
      correctionSchema.safeParse({ id: "evt_reverse", kind: "reverse", extra: true }).success,
    ).toBeFalse();
  });

  test("models correction acceptance and event relationships", () => {
    expect(
      usageEventCorrectionResponseSchema.parse({
        correction: {
          correctedEventId: "evt_original",
          correctionEventId: "evt_reversal",
          kind: "reverse",
          status: "accepted",
        },
        requestId: "request_correction",
      }),
    ).toMatchObject({ correction: { kind: "reverse", status: "accepted" } });
    expect(
      storedUsageEventSchema.parse({
        ...validEvent,
        correctedBy: { eventId: "evt_reversal", kind: "reverse" },
        correctionOf: null,
        processingState: "processed",
        receivedAt: NOW.toISOString(),
      }),
    ).toMatchObject({ correctedBy: { eventId: "evt_reversal", kind: "reverse" } });
  });
});
