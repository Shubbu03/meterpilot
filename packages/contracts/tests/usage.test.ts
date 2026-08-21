import { describe, expect, test } from "bun:test";

import { usageQuerySchema, usageTotalResponseSchema } from "../src/usage";

describe("usage contracts", () => {
  test("accepts a bounded half-open hourly range", () => {
    expect(
      usageQuerySchema.parse({
        customerKey: "customer_acme",
        from: "2026-08-01T00:00:00.000Z",
        meterKey: "llm.tokens",
        to: "2026-09-01T00:00:00.000Z",
      }),
    ).toEqual({
      customerKey: "customer_acme",
      from: "2026-08-01T00:00:00.000Z",
      meterKey: "llm.tokens",
      to: "2026-09-01T00:00:00.000Z",
    });
  });

  test("rejects partial buckets, reversed ranges, and excessive ranges", () => {
    for (const query of [
      {
        customerKey: "customer_acme",
        from: "2026-08-01T00:30:00.000Z",
        meterKey: "llm.tokens",
        to: "2026-08-02T00:00:00.000Z",
      },
      {
        customerKey: "customer_acme",
        from: "2026-08-02T00:00:00.000Z",
        meterKey: "llm.tokens",
        to: "2026-08-01T00:00:00.000Z",
      },
      {
        customerKey: "customer_acme",
        from: "2025-01-01T00:00:00.000Z",
        meterKey: "llm.tokens",
        to: "2026-08-01T00:00:00.000Z",
      },
    ]) {
      expect(usageQuerySchema.safeParse(query).success).toBe(false);
    }
  });

  test("keeps exact decimal quantities and explicit freshness", () => {
    expect(
      usageTotalResponseSchema.parse({
        requestId: "request_usage",
        usage: {
          customerKey: "customer_acme",
          eventCount: "2",
          freshness: {
            lagSeconds: 60,
            maxReceivedAt: "2026-08-01T01:00:00.000Z",
            updatedAt: "2026-08-01T01:01:00.000Z",
          },
          from: "2026-08-01T00:00:00.000Z",
          meterKey: "llm.tokens",
          quantity: "9007199254740993.1",
          to: "2026-08-02T00:00:00.000Z",
        },
      }).usage.quantity,
    ).toBe("9007199254740993.1");
  });
});
