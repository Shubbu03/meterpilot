import { describe, expect, test } from "bun:test";

import { JobHandlerError } from "../src/jobs/errors";
import {
  aggregateBucket,
  dimensionsHash,
  matchesMeterFilters,
  meterDimensions,
  startOfUtcHour,
} from "../src/jobs/usage-event-aggregation";

const receivedAt = new Date("2026-08-20T10:30:00.000Z");

describe("usage-event aggregation", () => {
  test("applies exact filters and groups count meters deterministically", () => {
    const filters = [
      { operation: "equals", property: "model", value: "small" },
      { operation: "exists", property: "cached", value: true },
    ] as const;
    const properties = { cached: false, model: "small", region: "ap-south" };
    const dimensions = meterDimensions(properties, ["region"]);
    const aggregate = aggregateBucket(
      {
        aggregation: "count",
        effectiveFrom: new Date("2026-08-20T00:00:00.000Z"),
        effectiveTo: null,
        filterDefinition: filters,
        groupByKeys: ["region"],
        id: "meter-version-1",
        valueProperty: null,
      },
      [
        { properties, receivedAt },
        {
          properties: { cached: true, model: "small", region: "us-east" },
          receivedAt,
        },
        {
          properties: { cached: true, model: "large", region: "ap-south" },
          receivedAt,
        },
      ],
      dimensions,
    );

    expect(matchesMeterFilters(properties, filters)).toBe(true);
    expect(aggregate).toEqual({
      dimensions: { region: "ap-south" },
      dimensionsHash: dimensionsHash({ region: "ap-south" }),
      eventCount: 1,
      maxReceivedAt: receivedAt,
      quantity: "1",
    });
  });

  test("sums decimal strings without binary floating-point loss", () => {
    const aggregate = aggregateBucket(
      {
        aggregation: "sum",
        effectiveFrom: new Date("2026-08-20T00:00:00.000Z"),
        effectiveTo: null,
        filterDefinition: [],
        groupByKeys: [],
        id: "meter-version-2",
        valueProperty: "tokens",
      },
      [
        { properties: { tokens: "9007199254740993.123456789" }, receivedAt },
        { properties: { tokens: "0.876543211" }, receivedAt },
      ],
      {},
    );

    expect(aggregate?.quantity).toBe("9007199254740994");
    expect(aggregate?.eventCount).toBe(2);
  });

  test("rejects structured dimensions and invalid sum values", () => {
    expect(() => meterDimensions({ region: { code: "IN" } }, ["region"])).toThrow(JobHandlerError);
    expect(() =>
      aggregateBucket(
        {
          aggregation: "sum",
          effectiveFrom: new Date("2026-08-20T00:00:00.000Z"),
          effectiveTo: null,
          filterDefinition: [],
          groupByKeys: [],
          id: "meter-version-3",
          valueProperty: "tokens",
        },
        [{ properties: { tokens: 12.5 }, receivedAt }],
        {},
      ),
    ).toThrow(JobHandlerError);
  });

  test("uses UTC half-open hourly buckets", () => {
    expect(startOfUtcHour(new Date("2026-08-20T10:59:59.999Z")).toISOString()).toBe(
      "2026-08-20T10:00:00.000Z",
    );
  });
});
