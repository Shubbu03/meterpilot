import { describe, expect, test } from "bun:test";

import { createMeterVersionRequestSchema, meterVersionParamSchema } from "../src/meters";

describe("meter contracts", () => {
  test("normalizes a bounded count-meter version", () => {
    expect(
      createMeterVersionRequestSchema.parse({
        aggregation: "count",
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        eventType: "api.request",
      }),
    ).toEqual({
      aggregation: "count",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      effectiveTo: null,
      eventType: "api.request",
      filters: [],
      groupByKeys: [],
      valueProperty: null,
    });
  });

  test("requires a value property only for sum aggregation", () => {
    expect(
      createMeterVersionRequestSchema.safeParse({
        aggregation: "sum",
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        eventType: "llm.tokens",
      }).success,
    ).toBe(false);
    expect(
      createMeterVersionRequestSchema.safeParse({
        aggregation: "count",
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        eventType: "api.request",
        valueProperty: "tokens",
      }).success,
    ).toBe(false);
  });

  test("rejects overlapping bounds and duplicate group keys", () => {
    expect(
      createMeterVersionRequestSchema.safeParse({
        aggregation: "sum",
        effectiveFrom: "2026-08-02T00:00:00.000Z",
        effectiveTo: "2026-08-01T00:00:00.000Z",
        eventType: "llm.tokens",
        groupByKeys: ["model", "model"],
        valueProperty: "tokens",
      }).success,
    ).toBe(false);
  });

  test("coerces a positive URL version number", () => {
    expect(
      meterVersionParamSchema.parse({
        meterKey: "api.requests",
        organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        version: "2",
      }).version,
    ).toBe(2);
  });
});
