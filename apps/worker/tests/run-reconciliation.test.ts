import { describe, expect, test } from "bun:test";
import { RECONCILIATION_RUN_JOB_TYPE } from "@meterpilot/db/schema";
import type { MeterPilotMetrics } from "@meterpilot/observability";

import { permanentJobError } from "../src/jobs/errors";
import { createRunReconciliationHandler } from "../src/jobs/run-reconciliation";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

function job() {
  return {
    attemptCount: 1,
    createdAt: new Date("2026-09-02T00:00:00.000Z"),
    id: "22222222-2222-4222-8222-222222222222",
    leaseExpiresAt: new Date("2026-09-02T00:01:00.000Z"),
    organizationId: "33333333-3333-4333-8333-333333333333",
    payload: { requestId: "reconciliation-request", runId: RUN_ID },
    resourceId: RUN_ID,
    resourceType: "reconciliation_run",
    type: RECONCILIATION_RUN_JOB_TYPE,
  };
}

function metrics(record: (count: number, magnitude: number) => void): MeterPilotMetrics {
  return { recordReconciliationDrift: record } as MeterPilotMetrics;
}

describe("run reconciliation handler", () => {
  test("dispatches trusted metadata and records drift", async () => {
    let received: readonly unknown[] = [];
    const measurements: number[][] = [];
    const handler = createRunReconciliationHandler({
      metrics: metrics((...values) => measurements.push(values)),
      runner: {
        fail: () => Promise.resolve(),
        run(...input) {
          received = input;
          return Promise.resolve({ driftCount: 2, status: "completed", totalMagnitude: "3.5" });
        },
      },
    });

    await handler.handle(job(), { signal: new AbortController().signal });

    expect(received.slice(0, 3)).toEqual([
      "33333333-3333-4333-8333-333333333333",
      RUN_ID,
      "reconciliation-request",
    ]);
    expect(measurements).toEqual([[2, 3.5]]);
  });

  test("rejects tampered resource identity before running", async () => {
    let calls = 0;
    const handler = createRunReconciliationHandler({
      metrics: metrics(() => undefined),
      runner: {
        fail: () => Promise.resolve(),
        run: () => {
          calls++;
          return Promise.resolve({ status: "terminal" });
        },
      },
    });

    await expect(
      handler.handle(
        { ...job(), resourceType: "usage_event" },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: "invalid_job_payload", retryable: false });
    expect(calls).toBe(0);
  });

  test("persists a permanent reconciliation failure", async () => {
    let failedWith: string | undefined;
    const handler = createRunReconciliationHandler({
      metrics: metrics(() => undefined),
      runner: {
        fail(_organizationId, _runId, failureCode) {
          failedWith = failureCode;
          return Promise.resolve();
        },
        run: () => {
          throw permanentJobError("invalid_meter_definition", "The meter is invalid.");
        },
      },
    });

    await expect(
      handler.handle(job(), { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "invalid_meter_definition", retryable: false });
    expect(failedWith).toBe("invalid_meter_definition");
  });
});
