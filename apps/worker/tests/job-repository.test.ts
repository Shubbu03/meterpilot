import { describe, expect, test } from "bun:test";

import { createDrizzleJobRepository } from "../src/jobs/drizzle-repository";

describe("durable job repository", () => {
  test("rejects invalid claim bounds before database access", async () => {
    const repository = createDrizzleJobRepository({} as never);

    await expect(
      repository.claim({
        leaseDurationMs: 30_000,
        limit: 0,
        now: new Date("2026-08-20T00:00:00.000Z"),
        workerId: "worker-1",
      }),
    ).rejects.toThrow("Claim limit");

    await expect(
      repository.claim({
        leaseDurationMs: 999,
        limit: 1,
        now: new Date("2026-08-20T00:00:00.000Z"),
        workerId: "worker-1",
      }),
    ).rejects.toThrow("Lease duration");
  });

  test("rejects unsafe transition metadata before database access", async () => {
    const repository = createDrizzleJobRepository({} as never);
    const now = new Date("2026-08-20T00:00:00.000Z");

    await expect(repository.complete({ jobId: "", now, workerId: "worker-1" })).rejects.toThrow(
      "Job ID",
    );
    await expect(
      repository.retry({
        jobId: "job-1",
        lastError: "temporary",
        nextAttemptAt: now,
        now,
        workerId: "worker-1",
      }),
    ).rejects.toThrow("Next attempt time");
    await expect(
      repository.fail({
        jobId: "job-1",
        lastError: "",
        now,
        retryable: false,
        workerId: "worker-1",
      }),
    ).rejects.toThrow("Last error");
  });
});
