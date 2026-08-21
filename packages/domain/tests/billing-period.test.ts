import { describe, expect, test } from "bun:test";

import { billingPeriodAt } from "../src/billing-period";

describe("billingPeriodAt", () => {
  test("uses calendar months and clips the first period to the subscription start", () => {
    const period = billingPeriodAt({
      at: new Date("2026-02-20T00:00:00.000Z"),
      billingAnchor: new Date("2026-01-31T00:00:00.000Z"),
      subscriptionStart: new Date("2026-02-15T00:00:00.000Z"),
      timeZone: "UTC",
    });

    expect(period.start.toISOString()).toBe("2026-02-15T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(period.nextCycleStart.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  test("preserves local billing time across daylight-saving changes", () => {
    const period = billingPeriodAt({
      at: new Date("2026-03-20T12:00:00.000Z"),
      billingAnchor: new Date("2026-02-08T14:00:00.000Z"),
      subscriptionStart: new Date("2026-02-08T14:00:00.000Z"),
      timeZone: "America/New_York",
    });

    expect(period.start.toISOString()).toBe("2026-03-08T13:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-04-08T13:00:00.000Z");
  });

  test("clips the final period to the subscription end", () => {
    const period = billingPeriodAt({
      at: new Date("2026-04-01T00:00:00.000Z"),
      billingAnchor: new Date("2026-01-15T00:00:00.000Z"),
      subscriptionEnd: new Date("2026-04-10T12:00:00.000Z"),
      subscriptionStart: new Date("2026-01-20T00:00:00.000Z"),
      timeZone: "UTC",
    });

    expect(period.start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-04-10T12:00:00.000Z");
    expect(period.nextCycleStart.toISOString()).toBe("2026-04-15T00:00:00.000Z");
  });

  test("rejects instants outside the subscription", () => {
    expect(() =>
      billingPeriodAt({
        at: new Date("2026-01-31T00:00:00.000Z"),
        billingAnchor: new Date("2026-01-01T00:00:00.000Z"),
        subscriptionEnd: new Date("2026-01-31T00:00:00.000Z"),
        subscriptionStart: new Date("2026-01-01T00:00:00.000Z"),
        timeZone: "UTC",
      }),
    ).toThrow("before the subscription end");
  });
});
