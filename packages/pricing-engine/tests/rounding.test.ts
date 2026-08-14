import { describe, expect, test } from "bun:test";

import { halfOpenInterval, instant, planVersionId } from "@meterpilot/domain";

import { price, roundDecimalAmount } from "../src";

const ROUNDING = { minorUnitScale: 2, mode: "half_away_from_zero" } as const;

describe("money and determinism", () => {
  test("rounds midpoint values away from zero", () => {
    expect(roundDecimalAmount("1.005", ROUNDING)).toEqual({
      amountMinor: "101",
      roundedAmount: "1.01",
    });
    expect(roundDecimalAmount("-1.005", ROUNDING)).toEqual({
      amountMinor: "-101",
      roundedAmount: "-1.01",
    });
  });

  test("sums already-rounded lines", () => {
    const result = price({
      components: [
        {
          componentKey: "first",
          price: { model: "per_unit", unitRate: "0.005" },
          quantity: "1",
        },
        {
          componentKey: "second",
          price: { model: "per_unit", unitRate: "0.005" },
          quantity: "1",
        },
      ],
      currency: "USD",
      period: halfOpenInterval(
        instant("2026-08-01T00:00:00.000Z"),
        instant("2026-09-01T00:00:00.000Z"),
      ),
      planVersionId: planVersionId("plan_version_1"),
      rounding: ROUNDING,
    });

    expect(result.lines.map((line) => line.amountMinor)).toEqual(["1", "1"]);
    expect(result.subtotalMinor).toBe("2");
  });

  test("repeated inputs produce the same calculation hashes", () => {
    const input = {
      components: [
        {
          componentKey: "tokens",
          price: { model: "per_unit" as const, unitRate: "0.0002" },
          quantity: "1053",
        },
      ],
      currency: "USD",
      period: halfOpenInterval(
        instant("2026-08-01T00:00:00.000Z"),
        instant("2026-09-01T00:00:00.000Z"),
      ),
      planVersionId: planVersionId("plan_version_1"),
      rounding: ROUNDING,
    };

    const first = price(input);
    const second = price(input);

    expect(first.calculationHash).toBe(second.calculationHash);
    expect(first.lines[0]?.calculationHash).toBe(second.lines[0]?.calculationHash);
    expect(first.calculationHash).toHaveLength(64);
  });
});
