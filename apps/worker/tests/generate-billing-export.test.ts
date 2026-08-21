import { describe, expect, test } from "bun:test";
import { STRIPE_INVOICE_LINE_EXPORT_JOB_TYPE } from "@meterpilot/db/schema";
import type { MeterPilotMetrics } from "@meterpilot/observability";

import { permanentJobError } from "../src/jobs/errors";
import { createGenerateBillingExportHandler } from "../src/jobs/generate-billing-export";

const EXPORT_ID = "11111111-1111-4111-8111-111111111111";

function job() {
  return {
    attemptCount: 1,
    createdAt: new Date("2026-09-02T00:00:00.000Z"),
    id: "22222222-2222-4222-8222-222222222222",
    leaseExpiresAt: new Date("2026-09-02T00:01:00.000Z"),
    organizationId: "33333333-3333-4333-8333-333333333333",
    payload: { exportId: EXPORT_ID, requestId: "export-request" },
    resourceId: EXPORT_ID,
    resourceType: "billing_export",
    type: STRIPE_INVOICE_LINE_EXPORT_JOB_TYPE,
  };
}

function metrics(recordFailure: (operation: "export" | "preview", count?: number) => void) {
  return { recordFailure } as MeterPilotMetrics;
}

describe("generate billing export handler", () => {
  test("dispatches trusted export metadata", async () => {
    let received: readonly unknown[] = [];
    const handler = createGenerateBillingExportHandler({
      generator: {
        fail: () => Promise.resolve(),
        generate(...input) {
          received = input;
          return Promise.resolve({ status: "completed" });
        },
      },
      metrics: metrics(() => undefined),
    });

    await handler.handle(job(), { signal: new AbortController().signal });

    expect(received.slice(0, 3)).toEqual([
      "33333333-3333-4333-8333-333333333333",
      EXPORT_ID,
      "export-request",
    ]);
  });

  test("rejects tampered export metadata", async () => {
    let calls = 0;
    const handler = createGenerateBillingExportHandler({
      generator: {
        fail: () => Promise.resolve(),
        generate: () => {
          calls++;
          return Promise.resolve({ status: "terminal" });
        },
      },
      metrics: metrics(() => undefined),
    });

    await expect(
      handler.handle(
        { ...job(), resourceId: crypto.randomUUID() },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: "invalid_job_payload", retryable: false });
    expect(calls).toBe(0);
  });

  test("records and persists a permanent export failure", async () => {
    let failedWith: string | undefined;
    const failures: string[] = [];
    const handler = createGenerateBillingExportHandler({
      generator: {
        fail(_organizationId, _exportId, failureCode) {
          failedWith = failureCode;
          return Promise.resolve();
        },
        generate: () => {
          throw permanentJobError("source_preview_changed", "The source preview changed.");
        },
      },
      metrics: metrics((operation) => failures.push(operation)),
    });

    await expect(
      handler.handle(job(), { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "source_preview_changed", retryable: false });
    expect(failedWith).toBe("source_preview_changed");
    expect(failures).toEqual(["export"]);
  });
});
