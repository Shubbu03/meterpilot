import { describe, expect, test } from "bun:test";
import type { MeterPilotMetrics } from "@meterpilot/observability";

import { createRebuildUsageAggregatesHandler } from "../src/jobs/rebuild-usage-aggregates";
import type { ClaimedJob } from "../src/jobs/repository";

const job: ClaimedJob = {
  attemptCount: 1,
  createdAt: new Date("2026-08-20T09:00:00.000Z"),
  id: "11111111-1111-4111-8111-111111111111",
  leaseExpiresAt: new Date("2026-08-20T10:01:00.000Z"),
  organizationId: "22222222-2222-4222-8222-222222222222",
  payload: {
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    effectiveTo: null,
    meterVersionId: "33333333-3333-4333-8333-333333333333",
    requestId: "request-rebuild",
  },
  resourceId: "33333333-3333-4333-8333-333333333333",
  resourceType: "meter_version",
  type: "usage_aggregate.rebuild",
};

function metrics(record: (durationMs: number) => void): MeterPilotMetrics {
  return { recordBucketRebuild: record } as MeterPilotMetrics;
}

describe("rebuild usage aggregates handler", () => {
  test("validates durable meter-version identity before rebuilding", async () => {
    let calls = 0;
    const handler = createRebuildUsageAggregatesHandler({
      metrics: metrics(() => undefined),
      rebuilder: {
        rebuild: () => {
          calls++;
          return Promise.resolve({ eventCount: 0, status: "rebuilt" });
        },
      },
    });

    await expect(
      handler.handle(
        { ...job, resourceId: "44444444-4444-4444-8444-444444444444" },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: "invalid_job_payload", retryable: false });
    expect(calls).toBe(0);
  });

  test("records rebuild duration after a successful scan", async () => {
    const durations: number[] = [];
    let clock = 100;
    const handler = createRebuildUsageAggregatesHandler({
      metrics: metrics((duration) => durations.push(duration)),
      now: () => {
        clock += 25;
        return clock;
      },
      rebuilder: {
        rebuild: () => Promise.resolve({ eventCount: 42, status: "rebuilt" }),
      },
    });

    await handler.handle(job, { signal: new AbortController().signal });

    expect(durations).toEqual([25]);
  });

  test("permanently fails orphaned meter-version jobs", async () => {
    const handler = createRebuildUsageAggregatesHandler({
      metrics: metrics(() => undefined),
      rebuilder: { rebuild: () => Promise.resolve({ status: "not_found" }) },
    });

    await expect(
      handler.handle(job, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "meter_version_not_found", retryable: false });
  });
});
