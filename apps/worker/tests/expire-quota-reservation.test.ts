import { describe, expect, test } from "bun:test";
import { QUOTA_RESERVATION_EXPIRE_JOB_TYPE } from "@meterpilot/db/schema";
import { createObservability } from "@meterpilot/observability";

import { createExpireQuotaReservationHandler } from "../src/jobs/expire-quota-reservation";

const NOW = new Date("2026-08-20T06:00:00.000Z");
const RESERVATION_ID = "11111111-1111-4111-8111-111111111111";

function job(payload: Record<string, unknown> = {}) {
  return {
    attemptCount: 1,
    createdAt: new Date("2026-08-20T05:00:00.000Z"),
    id: "22222222-2222-4222-8222-222222222222",
    leaseExpiresAt: new Date("2026-08-20T06:01:00.000Z"),
    organizationId: "33333333-3333-4333-8333-333333333333",
    payload: {
      expiresAt: NOW.toISOString(),
      requestId: "request-1",
      reservationId: RESERVATION_ID,
      ...payload,
    },
    resourceId: RESERVATION_ID,
    resourceType: "quota_reservation",
    type: QUOTA_RESERVATION_EXPIRE_JOB_TYPE,
  };
}

function metrics() {
  return createObservability({
    environment: "test",
    level: "error",
    service: "meterpilot-worker",
    write: () => undefined,
  }).metrics;
}

describe("expire quota reservation handler", () => {
  test("expires a due reservation with tenant-scoped metadata", async () => {
    let received: readonly unknown[] = [];
    const handler = createExpireQuotaReservationHandler({
      expirer: {
        expire(...input) {
          received = input;
          return Promise.resolve({ status: "expired" });
        },
      },
      metrics: metrics(),
      now: () => NOW,
      timer: () => 10,
    });

    await handler.handle(job(), { signal: new AbortController().signal });

    expect(received.slice(0, 3)).toEqual([
      "33333333-3333-4333-8333-333333333333",
      RESERVATION_ID,
      NOW,
    ]);
  });

  test("rejects tampered durable job metadata permanently", async () => {
    const handler = createExpireQuotaReservationHandler({
      expirer: { expire: () => Promise.resolve({ status: "terminal" }) },
      metrics: metrics(),
    });

    await expect(
      handler.handle(
        { ...job(), resourceId: crypto.randomUUID() },
        {
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_job_payload", retryable: false });
  });

  test("treats an early claim as retryable", async () => {
    const handler = createExpireQuotaReservationHandler({
      expirer: {
        expire: () =>
          Promise.resolve({
            expiresAt: new Date("2026-08-20T06:01:00.000Z"),
            status: "not_due",
          }),
      },
      metrics: metrics(),
    });

    await expect(
      handler.handle(job(), { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "quota_reservation_not_due", retryable: true });
  });
});
