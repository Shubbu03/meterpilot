import { describe, expect, test } from "bun:test";

import {
  createUsageEventBatchSchema,
  createUsageEventSchema,
  decimalStringSchema,
  eventIngestionResponseSchema,
  storedUsageEventSchema,
  MAX_EVENT_BATCH_SIZE,
  usageEventBatchEnvelopeSchema,
  usageEventSchema,
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
      ...validEvent,
      processingState: "pending",
      receivedAt: NOW.toISOString(),
    });
    expect(
      storedUsageEventSchema.safeParse({
        ...validEvent,
        jobId: "internal",
        processingState: "pending",
        receivedAt: NOW.toISOString(),
      }).success,
    ).toBeFalse();
  });
});
