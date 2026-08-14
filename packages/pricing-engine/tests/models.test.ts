import { describe, expect, test } from "bun:test";

import { halfOpenInterval, instant, planVersionId } from "@meterpilot/domain";

import { price } from "../src";
import type { PriceModel, PricingRequest } from "../src/types";

const PERIOD = halfOpenInterval(
  instant("2026-08-01T00:00:00.000Z"),
  instant("2026-09-01T00:00:00.000Z"),
);

function request(priceModel: PriceModel, quantity: string): PricingRequest {
  return {
    components: [
      {
        componentKey: "api_requests",
        price: priceModel,
        quantity,
      },
    ],
    currency: "USD",
    period: PERIOD,
    planVersionId: planVersionId("plan_version_1"),
    rounding: { minorUnitScale: 2, mode: "half_away_from_zero" },
  };
}

describe("V1 price models", () => {
  test("prices a flat recurring fee", () => {
    const result = price(request({ amount: "29", model: "flat" }, "0"));

    expect(result.subtotalMinor).toBe("2900");
    expect(result.lines[0]?.preRoundAmount).toBe("29");
    expect(result.lines[0]?.roundedAmount).toBe("29.00");
  });

  test("prices exact per-unit usage", () => {
    const result = price(request({ model: "per_unit", unitRate: "0.4" }, "2.5"));

    expect(result.subtotalMinor).toBe("100");
    expect(result.lines[0]?.preRoundAmount).toBe("1");
  });

  test("prices only usage above the included quantity", () => {
    const result = price(
      request(
        {
          includedQuantity: "100",
          model: "included_overage",
          overageRate: "0.25",
        },
        "120",
      ),
    );

    expect(result.subtotalMinor).toBe("500");
    expect(result.lines[0]?.trace).toEqual({
      amount: "5",
      includedQuantity: "100",
      model: "included_overage",
      overageQuantity: "20",
      overageRate: "0.25",
    });
  });

  test("prices graduated units within each tier", () => {
    const result = price(
      request(
        {
          model: "graduated",
          tiers: [
            { unitRate: "0.10", upTo: "100" },
            { unitRate: "0.08", upTo: "200" },
            { unitRate: "0.05", upTo: null },
          ],
        },
        "250",
      ),
    );

    expect(result.subtotalMinor).toBe("2050");
    expect(result.lines[0]?.trace).toEqual({
      model: "graduated",
      tiers: [
        { amount: "10", quantity: "100", unitRate: "0.1", upTo: "100" },
        { amount: "8", quantity: "100", unitRate: "0.08", upTo: "200" },
        { amount: "2.5", quantity: "50", unitRate: "0.05", upTo: null },
      ],
    });
  });

  test("handles zero usage and an exact tier boundary", () => {
    const model: PriceModel = {
      model: "graduated",
      tiers: [
        { unitRate: "0.10", upTo: "100" },
        { unitRate: "0.05", upTo: null },
      ],
    };

    expect(price(request(model, "0")).subtotalMinor).toBe("0");
    expect(price(request(model, "100")).subtotalMinor).toBe("1000");
  });
});
