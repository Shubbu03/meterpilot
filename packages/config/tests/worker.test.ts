import { describe, expect, test } from "bun:test";

import { parseWorkerConfig } from "../src/worker";

const DATABASE_URL = "postgresql://user:password@localhost:5432/meterpilot";

describe("worker configuration", () => {
  test("parses private worker settings", () => {
    expect(
      parseWorkerConfig({
        DATABASE_URL,
        LOG_LEVEL: "debug",
        NODE_ENV: "test",
      }),
    ).toEqual({
      claimLimit: 10,
      databaseUrl: DATABASE_URL,
      leaseDurationMs: 60_000,
      logLevel: "debug",
      maxAttempts: 8,
      nodeEnvironment: "test",
      pollIntervalMs: 1_000,
      retryBaseDelayMs: 1_000,
      retryMaxDelayMs: 300_000,
    });
  });

  test("parses bounded job execution settings", () => {
    expect(
      parseWorkerConfig({
        DATABASE_URL,
        JOB_CLAIM_LIMIT: "4",
        JOB_LEASE_DURATION_MS: "120000",
        JOB_MAX_ATTEMPTS: "5",
        JOB_POLL_INTERVAL_MS: "250",
        JOB_RETRY_BASE_DELAY_MS: "500",
        JOB_RETRY_MAX_DELAY_MS: "10000",
      }),
    ).toEqual({
      claimLimit: 4,
      databaseUrl: DATABASE_URL,
      leaseDurationMs: 120_000,
      logLevel: "info",
      maxAttempts: 5,
      nodeEnvironment: "development",
      pollIntervalMs: 250,
      retryBaseDelayMs: 500,
      retryMaxDelayMs: 10_000,
    });
  });

  test("rejects invalid retry bounds", () => {
    expect(() =>
      parseWorkerConfig({
        DATABASE_URL,
        JOB_RETRY_BASE_DELAY_MS: "2000",
        JOB_RETRY_MAX_DELAY_MS: "1000",
      }),
    ).toThrow("JOB_RETRY_MAX_DELAY_MS");
  });
});
