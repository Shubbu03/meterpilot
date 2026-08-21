import { describe, expect, test } from "bun:test";

import {
  createPlanVersionRequestSchema,
  createSubscriptionRequestSchema,
  duplicatePlanVersionRequestSchema,
} from "../src/catalog";

describe("catalog contracts", () => {
  test("normalizes a complete exact-decimal plan version", () => {
    const result = createPlanVersionRequestSchema.parse({
      components: [
        {
          componentKey: "base",
          entitlement: { mode: "hard", quantity: "1000" },
          featureKey: "api.calls",
          price: { includedQuantity: "1000", model: "included_overage", overageRate: "0.01" },
        },
      ],
      currency: "USD",
      effectiveFrom: "2026-09-01T00:00:00.000Z",
    });

    expect(result.components[0]).toMatchObject({
      billingInterval: "month",
      entitlement: { enabled: true, mode: "hard", quantity: "1000" },
      rounding: { minorUnitScale: 2, mode: "half_away_from_zero" },
    });
  });

  test("rejects multiple entitlement definitions for the same feature", () => {
    const result = createPlanVersionRequestSchema.safeParse({
      components: [
        {
          componentKey: "api.base",
          entitlement: { mode: "advisory", quantity: "10" },
          featureKey: "api.calls",
          price: { amount: "5", model: "flat" },
        },
        {
          componentKey: "api.overage",
          entitlement: { mode: "hard", quantity: "20" },
          featureKey: "api.calls",
          price: { model: "per_unit", unitRate: "1" },
        },
      ],
      currency: "USD",
      effectiveFrom: "2026-09-01T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });

  test("rejects invalid subscription periods and future billing anchors", () => {
    expect(
      createSubscriptionRequestSchema.safeParse({
        billingAnchor: "2026-10-02T00:00:00.000Z",
        customerKey: "acme",
        endsAt: "2026-09-01T00:00:00.000Z",
        planKey: "starter",
        planVersion: 1,
        startsAt: "2026-10-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  test("normalizes selective candidate-plan price overrides", () => {
    expect(
      duplicatePlanVersionRequestSchema.parse({
        effectiveFrom: "2026-10-01T00:00:00.000Z",
        priceOverrides: {
          "api.calls": { model: "per_unit", unitRate: "0.02" },
        },
      }),
    ).toEqual({
      effectiveFrom: "2026-10-01T00:00:00.000Z",
      priceOverrides: {
        "api.calls": { model: "per_unit", unitRate: "0.02" },
      },
    });
  });
});
