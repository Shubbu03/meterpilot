import { describe, expect, test } from "bun:test";
import { createObservability, type Observability } from "@meterpilot/observability";

import { createJobDispatcher, type RegisteredJobHandler } from "../src/jobs/dispatcher";
import { permanentJobError, retryableJobError } from "../src/jobs/errors";
import type {
  ClaimedJob,
  FailJobOptions,
  JobRepository,
  RetryJobOptions,
} from "../src/jobs/repository";
import { runWorker, type WorkerRuntimeConfig } from "../src/runtime/worker";

const NOW = new Date("2026-08-20T00:00:00.000Z");

const config: WorkerRuntimeConfig = {
  claimLimit: 10,
  leaseDurationMs: 60_000,
  maxAttempts: 3,
  pollIntervalMs: 1_000,
  retryBaseDelayMs: 1_000,
  retryMaxDelayMs: 10_000,
};

const claimedJob: ClaimedJob = {
  attemptCount: 1,
  createdAt: new Date("2026-08-19T23:59:00.000Z"),
  id: "11111111-1111-4111-8111-111111111111",
  leaseExpiresAt: new Date("2026-08-20T00:01:00.000Z"),
  organizationId: "22222222-2222-4222-8222-222222222222",
  payload: {},
  resourceId: "33333333-3333-4333-8333-333333333333",
  resourceType: "usage_event",
  type: "usage_event.process",
};

function createRepository(overrides: Partial<JobRepository> = {}): JobRepository {
  return {
    claim: () => Promise.resolve([]),
    complete: () => Promise.resolve("updated"),
    fail: () => Promise.resolve("updated"),
    inspect: () => Promise.resolve({ depth: 0, oldestAgeMs: 0 }),
    retry: () => Promise.resolve("updated"),
    ...overrides,
  };
}

function createTestObservability(): Readonly<{
  entries: Record<string, unknown>[];
  observability: Observability;
}> {
  const entries: Record<string, unknown>[] = [];
  const observability = createObservability({
    environment: "test",
    level: "debug",
    service: "meterpilot-worker",
    write(line) {
      entries.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  return { entries, observability };
}

function runtimeOptions(options: {
  handlers?: readonly RegisteredJobHandler[];
  observability: Observability;
  random?: () => number;
  repository: JobRepository;
  shutdown: AbortController;
}) {
  return {
    config,
    dispatcher: createJobDispatcher(options.handlers ?? []),
    now: () => NOW,
    observability: options.observability,
    ...(options.random ? { random: options.random } : {}),
    repository: options.repository,
    signal: options.shutdown.signal,
    sleep: (_durationMs: number, _signal: AbortSignal) => {
      options.shutdown.abort();
      return Promise.resolve();
    },
    workerId: "worker-1",
  };
}

describe("worker runtime", () => {
  test("polls until shutdown when no jobs are available", async () => {
    const shutdown = new AbortController();
    const { entries, observability } = createTestObservability();

    await runWorker(runtimeOptions({ observability, repository: createRepository(), shutdown }));

    expect(entries.map((entry) => entry.event)).toEqual(["worker_started", "worker_stopped"]);
  });

  test("dispatches and completes a claimed job", async () => {
    const shutdown = new AbortController();
    const { entries, observability } = createTestObservability();
    const handled: string[] = [];
    const completed: string[] = [];
    const repository = createRepository({
      claim: () => Promise.resolve([claimedJob]),
      complete(options) {
        completed.push(options.jobId);
        shutdown.abort();
        return Promise.resolve("updated");
      },
      inspect: () => Promise.resolve({ depth: 1, oldestAgeMs: 60_000 }),
    });

    await runWorker(
      runtimeOptions({
        handlers: [
          {
            handle(job) {
              handled.push(job.id);
              return Promise.resolve();
            },
            type: "usage_event.process",
          },
        ],
        observability,
        repository,
        shutdown,
      }),
    );

    expect(handled).toEqual([claimedJob.id]);
    expect(completed).toEqual([claimedJob.id]);
    expect(entries).toContainEqual(expect.objectContaining({ event: "worker_job_completed" }));
  });

  test("schedules transient failures with bounded jitter", async () => {
    const shutdown = new AbortController();
    const { entries, observability } = createTestObservability();
    let retry: RetryJobOptions | undefined;
    const repository = createRepository({
      claim: () => Promise.resolve([claimedJob]),
      retry(options) {
        retry = options;
        shutdown.abort();
        return Promise.resolve("updated");
      },
    });

    await runWorker(
      runtimeOptions({
        handlers: [
          {
            handle() {
              throw retryableJobError("database_unavailable", "Database temporarily unavailable.");
            },
            type: "usage_event.process",
          },
        ],
        observability,
        random: () => 0.5,
        repository,
        shutdown,
      }),
    );

    expect(retry).toMatchObject({
      jobId: claimedJob.id,
      lastError: "database_unavailable: Database temporarily unavailable.",
      workerId: "worker-1",
    });
    expect(retry?.nextAttemptAt.toISOString()).toBe("2026-08-20T00:00:00.750Z");
    expect(entries).toContainEqual(
      expect.objectContaining({ delayMs: 750, event: "worker_job_retry_scheduled" }),
    );
  });

  test("moves permanent failures to the failed state", async () => {
    const shutdown = new AbortController();
    const { entries, observability } = createTestObservability();
    let failure: FailJobOptions | undefined;
    const repository = createRepository({
      claim: () => Promise.resolve([claimedJob]),
      fail(options) {
        failure = options;
        shutdown.abort();
        return Promise.resolve("updated");
      },
    });

    await runWorker(
      runtimeOptions({
        handlers: [
          {
            handle() {
              throw permanentJobError("invalid_payload", "Stored job payload is invalid.");
            },
            type: "usage_event.process",
          },
        ],
        observability,
        repository,
        shutdown,
      }),
    );

    expect(failure?.lastError).toBe("invalid_payload: Stored job payload is invalid.");
    expect(failure?.retryable).toBe(false);
    expect(entries).toContainEqual(expect.objectContaining({ event: "worker_job_failed" }));
  });

  test("preserves retry eligibility when a transient failure exhausts automatic attempts", async () => {
    const shutdown = new AbortController();
    const { observability } = createTestObservability();
    let failure: FailJobOptions | undefined;
    const repository = createRepository({
      claim: () => Promise.resolve([{ ...claimedJob, attemptCount: config.maxAttempts }]),
      fail(options) {
        failure = options;
        shutdown.abort();
        return Promise.resolve("updated");
      },
    });

    await runWorker(
      runtimeOptions({
        handlers: [
          {
            handle() {
              throw retryableJobError("database_unavailable", "Database temporarily unavailable.");
            },
            type: "usage_event.process",
          },
        ],
        observability,
        repository,
        shutdown,
      }),
    );

    expect(failure).toMatchObject({
      lastError: "database_unavailable: Database temporarily unavailable.",
      retryable: true,
    });
  });

  test("fails unknown job types without exposing their payload", async () => {
    const shutdown = new AbortController();
    const { entries, observability } = createTestObservability();
    let failure: FailJobOptions | undefined;
    const repository = createRepository({
      claim: () =>
        Promise.resolve([{ ...claimedJob, payload: { secret: "do-not-log" }, type: "x.y" }]),
      fail(options) {
        failure = options;
        shutdown.abort();
        return Promise.resolve("updated");
      },
    });

    await runWorker(runtimeOptions({ observability, repository, shutdown }));

    expect(failure?.lastError).toBe(
      "unsupported_job_type: No handler is registered for this job type.",
    );
    expect(failure?.retryable).toBe(false);
    expect(JSON.stringify(entries)).not.toContain("do-not-log");
  });
});
