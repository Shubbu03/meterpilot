import { describe, expect, test } from "bun:test";

import { retryDelayMs, shouldRetry } from "../src/jobs/retry-policy";

const policy = { baseDelayMs: 1_000, maxAttempts: 4, maxDelayMs: 10_000 };

describe("job retry policy", () => {
  test("uses bounded exponential delay with equal jitter", () => {
    expect(retryDelayMs(1, policy, () => 0)).toBe(500);
    expect(retryDelayMs(2, policy, () => 0.5)).toBe(1_500);
    expect(retryDelayMs(10, policy, () => 0.999)).toBeLessThanOrEqual(10_000);
  });

  test("stops at the configured attempt limit and never retries permanent failures", () => {
    expect(shouldRetry(3, true, policy)).toBe(true);
    expect(shouldRetry(4, true, policy)).toBe(false);
    expect(shouldRetry(1, false, policy)).toBe(false);
  });

  test("rejects an invalid random source", () => {
    expect(() => retryDelayMs(1, policy, () => 1)).toThrow("random source");
  });
});
