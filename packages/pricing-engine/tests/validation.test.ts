import { describe, expect, test } from "bun:test";

import { halfOpenInterval, instant, planVersionId } from "@meterpilot/domain";

import { price } from "../src";

const BASE_REQUEST = {
  currency: "USD",
  period: halfOpenInterval(
    instant("2026-08-01T00:00:00.000Z"),
    instant("2026-09-01T00:00:00.000Z"),
  ),
  planVersionId: planVersionId("plan_version_1"),
  rounding: { minorUnitScale: 2, mode: "half_away_from_zero" } as const,
};

describe("pricing input invariants", () => {
  test("rejects negative quantities and rates", () => {
    expect(() =>
      price({
        ...BASE_REQUEST,
        components: [
          {
            componentKey: "requests",
            price: { model: "per_unit", unitRate: "0.01" },
            quantity: "-1",
          },
        ],
      }),
    ).toThrow("must not be negative");
  });

  test("rejects gaps above the final graduated tier", () => {
    expect(() =>
      price({
        ...BASE_REQUEST,
        components: [
          {
            componentKey: "requests",
            price: {
              model: "graduated",
              tiers: [{ unitRate: "0.01", upTo: "100" }],
            },
            quantity: "50",
          },
        ],
      }),
    ).toThrow("unbounded final tier");
  });

  test("rejects duplicate components", () => {
    const component = {
      componentKey: "requests",
      price: { model: "per_unit" as const, unitRate: "0.01" },
      quantity: "1",
    };

    expect(() => price({ ...BASE_REQUEST, components: [component, component] })).toThrow(
      "appears more than once",
    );
  });
});
