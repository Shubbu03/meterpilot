import { describe, expect, test } from "bun:test";
import type { MeterPilotMetrics } from "@meterpilot/observability";
import { createProcessUsageEventHandler } from "../src/jobs/process-usage-event";
import type { ClaimedJob } from "../src/jobs/repository";

const job: ClaimedJob = {
  attemptCount: 1,
  createdAt: new Date("2026-08-20T09:00:00.000Z"),
  id: "11111111-1111-4111-8111-111111111111",
  leaseExpiresAt: new Date("2026-08-20T10:01:00.000Z"),
  organizationId: "22222222-2222-4222-8222-222222222222",
  payload: {
    eventId: "33333333-3333-4333-8333-333333333333",
    eventKey: "event-1",
    requestId: "request-1",
  },
  resourceId: "33333333-3333-4333-8333-333333333333",
  resourceType: "usage_event",
  type: "usage_event.process",
};

function metrics(
  record: (receivedLagMs: number, occurredLagMs: number) => void,
): MeterPilotMetrics {
  return { recordAggregationLag: record } as MeterPilotMetrics;
}

describe("process usage event handler", () => {
  test("validates persisted payload and resource identity before database work", async () => {
    let calls = 0;
    const handler = createProcessUsageEventHandler({
      metrics: metrics(() => undefined),
      processor: {
        process: () => {
          calls++;
          return Promise.resolve({ status: "not_found" });
        },
      },
    });

    await expect(
      handler.handle(
        { ...job, resourceId: "44444444-4444-4444-8444-444444444444" },
        {
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_job_payload", retryable: false });
    expect(calls).toBe(0);
  });

  test("records aggregation freshness after successful processing", async () => {
    const lags: number[][] = [];
    const handler = createProcessUsageEventHandler({
      metrics: metrics((...values) => lags.push(values)),
      now: () => new Date("2026-08-20T10:00:10.000Z"),
      processor: {
        process: () =>
          Promise.resolve({
            bucketCount: 1,
            occurredAt: new Date("2026-08-20T09:59:00.000Z"),
            receivedAt: new Date("2026-08-20T10:00:00.000Z"),
            status: "processed",
          }),
      },
    });

    await handler.handle(job, { signal: new AbortController().signal });

    expect(lags).toEqual([[10_000, 70_000]]);
  });

  test("distinguishes late preview revisions from exported-preview adjustments", async () => {
    const lateUsage: Array<[string, number | undefined]> = [];
    const handler = createProcessUsageEventHandler({
      metrics: {
        recordAggregationLag: () => undefined,
        recordLateUsage: (kind: "adjustment" | "late_event", count?: number) => {
          lateUsage.push([kind, count]);
        },
      } as unknown as MeterPilotMetrics,
      processor: {
        process: () =>
          Promise.resolve({
            adjustmentPreviewRevisionCount: 1,
            bucketCount: 1,
            occurredAt: new Date("2026-08-20T09:59:00.000Z"),
            previewRevisionCount: 2,
            receivedAt: new Date("2026-08-20T10:00:00.000Z"),
            status: "processed",
          }),
      },
    });

    await handler.handle(job, { signal: new AbortController().signal });

    expect(lateUsage).toEqual([
      ["late_event", 2],
      ["adjustment", 1],
    ]);
  });

  test("permanently fails orphaned event jobs", async () => {
    const handler = createProcessUsageEventHandler({
      metrics: metrics(() => undefined),
      processor: { process: () => Promise.resolve({ status: "not_found" }) },
    });

    await expect(
      handler.handle(job, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "usage_event_not_found", retryable: false });
  });
});
