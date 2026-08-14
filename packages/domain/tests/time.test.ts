import { describe, expect, test } from "bun:test";

import { halfOpenInterval, instant, intervalContains, intervalsOverlap } from "../src/time";

describe("time semantics", () => {
  test("normalizes instants and enforces a valid interval", () => {
    const start = instant("2026-08-01T05:30:00+05:30");
    const end = instant("2026-09-01T00:00:00.000Z");

    expect(String(start)).toBe("2026-08-01T00:00:00.000Z");
    expect(halfOpenInterval(start, end)).toEqual({ end, start });
    expect(() => halfOpenInterval(end, start)).toThrow("start to be before end");
  });

  test("includes the start and excludes the end", () => {
    const start = instant("2026-08-01T00:00:00.000Z");
    const end = instant("2026-09-01T00:00:00.000Z");
    const interval = halfOpenInterval(start, end);

    expect(intervalContains(interval, start)).toBeTrue();
    expect(intervalContains(interval, end)).toBeFalse();
  });

  test("does not treat adjacent periods as overlapping", () => {
    const first = halfOpenInterval(
      instant("2026-08-01T00:00:00.000Z"),
      instant("2026-09-01T00:00:00.000Z"),
    );
    const second = halfOpenInterval(
      instant("2026-09-01T00:00:00.000Z"),
      instant("2026-10-01T00:00:00.000Z"),
    );

    expect(intervalsOverlap(first, second)).toBeFalse();
  });
});
