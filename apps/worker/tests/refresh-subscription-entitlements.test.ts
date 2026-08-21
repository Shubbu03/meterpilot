import { describe, expect, test } from "bun:test";
import { SUBSCRIPTION_ENTITLEMENT_REFRESH_JOB_TYPE } from "@meterpilot/db/schema";

import { createRefreshSubscriptionEntitlementsHandler } from "../src/jobs/refresh-subscription-entitlements";

const NOW = new Date("2026-09-01T00:00:00.000Z");
const SUBSCRIPTION_ID = "11111111-1111-4111-8111-111111111111";

function job() {
  return {
    attemptCount: 1,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    id: "22222222-2222-4222-8222-222222222222",
    leaseExpiresAt: new Date("2026-09-01T00:01:00.000Z"),
    organizationId: "33333333-3333-4333-8333-333333333333",
    payload: {
      periodStart: NOW.toISOString(),
      requestId: "request_subscription_refresh",
      subscriptionId: SUBSCRIPTION_ID,
    },
    resourceId: `${SUBSCRIPTION_ID}:${NOW.toISOString()}`,
    resourceType: "subscription_period",
    type: SUBSCRIPTION_ENTITLEMENT_REFRESH_JOB_TYPE,
  };
}

describe("refresh subscription entitlements handler", () => {
  test("passes trusted tenant and period metadata to the refresher", async () => {
    let received: readonly unknown[] = [];
    const handler = createRefreshSubscriptionEntitlementsHandler({
      now: () => NOW,
      refresher: {
        refresh(...input) {
          received = input;
          return Promise.resolve({ status: "refreshed" });
        },
      },
    });

    await handler.handle(job(), { signal: new AbortController().signal });

    expect(received.slice(0, 4)).toEqual([
      "33333333-3333-4333-8333-333333333333",
      SUBSCRIPTION_ID,
      NOW,
      "request_subscription_refresh",
    ]);
  });

  test("rejects tampered resource metadata permanently", async () => {
    const handler = createRefreshSubscriptionEntitlementsHandler({
      refresher: { refresh: () => Promise.resolve({ status: "terminal" }) },
    });

    await expect(
      handler.handle(
        { ...job(), resourceId: "tampered" },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: "invalid_job_payload", retryable: false });
  });

  test("treats an entitlement collision as a permanent data conflict", async () => {
    const handler = createRefreshSubscriptionEntitlementsHandler({
      now: () => NOW,
      refresher: { refresh: () => Promise.resolve({ status: "conflict" }) },
    });

    await expect(
      handler.handle(job(), { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "entitlement_period_conflict", retryable: false });
  });
});
