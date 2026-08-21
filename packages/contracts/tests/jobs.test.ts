import { describe, expect, test } from "bun:test";

import { failedJobSchema, MAX_MANUAL_JOB_RETRIES, retryFailedJobRequestSchema } from "../src/jobs";

describe("failed job contracts", () => {
  test("exposes bounded failure and allowlisted payload metadata", () => {
    expect(
      failedJobSchema.parse({
        attemptCount: 8,
        createdAt: "2026-08-20T00:00:00.000Z",
        failedAt: "2026-08-20T00:05:00.000Z",
        failure: { code: "database_unavailable", message: "Database operation failed." },
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        manualRetryCount: 0,
        payloadMetadata: { previewId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
        resourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        resourceType: "invoice_preview",
        retryable: true,
        type: "invoice_preview.generate",
      }).failure.code,
    ).toBe("database_unavailable");
  });

  test("requires an exact failure acknowledgement and bounds manual retries", () => {
    expect(
      retryFailedJobRequestSchema.parse({
        acknowledgedAttemptCount: 8,
        acknowledgedFailureCode: "database_unavailable",
        acknowledgedManualRetryCount: 0,
      }),
    ).toEqual({
      acknowledgedAttemptCount: 8,
      acknowledgedFailureCode: "database_unavailable",
      acknowledgedManualRetryCount: 0,
    });
    expect(
      failedJobSchema.safeParse({
        attemptCount: 1,
        createdAt: "2026-08-20T00:00:00.000Z",
        failedAt: "2026-08-20T00:05:00.000Z",
        failure: { code: "failure", message: "failed" },
        id: crypto.randomUUID(),
        manualRetryCount: MAX_MANUAL_JOB_RETRIES + 1,
        payloadMetadata: {},
        resourceId: "resource",
        resourceType: "resource",
        retryable: false,
        type: "job.type",
      }).success,
    ).toBe(false);
    expect(
      retryFailedJobRequestSchema.safeParse({
        acknowledgedAttemptCount: 8,
        acknowledgedFailureCode: "database_unavailable",
        acknowledgedManualRetryCount: MAX_MANUAL_JOB_RETRIES,
      }).success,
    ).toBe(false);
  });
});
