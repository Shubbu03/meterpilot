import { describe, expect, mock, test } from "bun:test";
import { createObservability } from "@meterpilot/observability";

import { createEnforceRetentionHandler } from "../src/jobs/enforce-retention";

const organizationId = "f49fab3b-41f0-45e7-a3f2-300d4ae2f910";

describe("retention enforcement handler", () => {
  test("validates tenant-owned metadata and records redacted events", async () => {
    const enforce = mock(() => Promise.resolve({ redactedCount: 42, status: "enforced" as const }));
    const metrics = createObservability({
      environment: "test",
      level: "debug",
      service: "retention-test",
      write: () => undefined,
    }).metrics;
    const recordRetention = mock(metrics.recordRetention);
    const handler = createEnforceRetentionHandler({
      enforcer: { enforce },
      metrics: { ...metrics, recordRetention },
    });
    const signal = new AbortController().signal;

    await handler.handle(
      {
        attemptCount: 1,
        createdAt: new Date("2026-08-20T00:00:00.000Z"),
        id: "06a635aa-e77e-4f08-9f05-c3bd2d408c4c",
        leaseExpiresAt: new Date("2026-08-20T00:01:00.000Z"),
        organizationId,
        payload: { organizationId, policyVersion: 3, requestId: "req-retention" },
        resourceId: "47a7d0f4-0864-480c-b3c8-8046713c76a4",
        resourceType: "retention_policy",
        type: "retention.enforce",
      },
      { signal },
    );

    expect(enforce).toHaveBeenCalledWith(
      organizationId,
      3,
      "req-retention",
      "06a635aa-e77e-4f08-9f05-c3bd2d408c4c",
      signal,
    );
    expect(recordRetention).toHaveBeenCalledWith(42);
  });

  test("rejects cross-tenant payload metadata before redaction", async () => {
    const handler = createEnforceRetentionHandler({
      enforcer: {
        enforce: () => Promise.resolve({ redactedCount: 0, status: "enforced" }),
      },
      metrics: createObservability({
        environment: "test",
        level: "debug",
        service: "retention-test",
        write: () => undefined,
      }).metrics,
    });

    await expect(
      handler.handle(
        {
          attemptCount: 1,
          createdAt: new Date(),
          id: crypto.randomUUID(),
          leaseExpiresAt: new Date(Date.now() + 60_000),
          organizationId,
          payload: {
            organizationId: "0cc805c2-224a-4fa2-965a-b8d3382ac18f",
            policyVersion: 1,
            requestId: "req-retention",
          },
          resourceId: crypto.randomUUID(),
          resourceType: "retention_policy",
          type: "retention.enforce",
        },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: "invalid_job_payload", retryable: false });
  });
});
