import { describe, expect, test } from "bun:test";

import {
  commitQuotaReservationRequestSchema,
  configureEntitlementRequestSchema,
  createFeatureRequestSchema,
  createQuotaGrantRequestSchema,
  createQuotaReservationRequestSchema,
  featureListQuerySchema,
} from "../src/entitlements";

describe("entitlement contracts", () => {
  test("accepts bounded feature collection pagination", () => {
    expect(featureListQuerySchema.parse({ limit: "25" })).toEqual({ limit: 25 });
  });

  test("normalizes feature and entitlement configuration", () => {
    expect(createFeatureRequestSchema.parse({ key: "ai.tokens", name: " AI tokens " })).toEqual({
      key: "ai.tokens",
      meterKey: null,
      name: "AI tokens",
    });
    expect(
      configureEntitlementRequestSchema.parse({
        mode: "hard",
        periodEnd: "2026-09-01T00:00:00.000Z",
        periodStart: "2026-08-01T00:00:00.000Z",
      }).enabled,
    ).toBe(true);
  });

  test("rejects invalid periods and imprecise numeric inputs", () => {
    expect(
      configureEntitlementRequestSchema.safeParse({
        mode: "hard",
        periodEnd: "2026-08-01T00:00:00.000Z",
        periodStart: "2026-09-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
    for (const quantity of [-1, "-1", "0", "1e3"] as const) {
      expect(
        createQuotaGrantRequestSchema.safeParse({
          effectiveAt: "2026-08-01T00:00:00.000Z",
          quantity,
          reason: "Monthly allowance",
        }).success,
      ).toBe(false);
    }
  });

  test("accepts exact positive decimal grants with bounded validity", () => {
    expect(
      createQuotaGrantRequestSchema.parse({
        effectiveAt: "2026-08-01T00:00:00.000Z",
        expiresAt: "2026-09-01T00:00:00.000Z",
        quantity: "9007199254740993.125",
        reason: "Monthly allowance",
      }).quantity,
    ).toBe("9007199254740993.125");
  });

  test("validates exact reservation and commit inputs", () => {
    expect(
      createQuotaReservationRequestSchema.parse({
        expiresAt: "2026-08-20T06:00:00.000Z",
        featureKey: "ai.tokens",
        idempotencyKey: "request-1",
        quantity: "2.5",
      }),
    ).toEqual({
      expiresAt: "2026-08-20T06:00:00.000Z",
      featureKey: "ai.tokens",
      idempotencyKey: "request-1",
      quantity: "2.5",
    });
    expect(
      commitQuotaReservationRequestSchema.parse({
        occurredAt: "2026-08-20T05:30:00.000Z",
        quantity: "2",
      }),
    ).toEqual({
      occurredAt: "2026-08-20T05:30:00.000Z",
      properties: {},
      quantity: "2",
    });
  });

  test("rejects malformed reservation identifiers and quantities", () => {
    expect(
      createQuotaReservationRequestSchema.safeParse({
        expiresAt: "2026-08-20T06:00:00.000Z",
        featureKey: "ai.tokens",
        idempotencyKey: "spaces are unsafe",
        quantity: "0",
      }).success,
    ).toBe(false);
  });
});
