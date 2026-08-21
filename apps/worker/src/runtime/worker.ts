import type { WorkerConfig } from "@meterpilot/config/worker";
import type { Observability } from "@meterpilot/observability";

import type { JobDispatcher } from "../jobs/dispatcher";
import { classifyJobFailure, persistedJobError } from "../jobs/errors";
import type { ClaimedJob, JobRepository } from "../jobs/repository";
import { type RetryPolicy, retryDelayMs, shouldRetry } from "../jobs/retry-policy";

export type WorkerRuntimeConfig = Pick<
  WorkerConfig,
  | "claimLimit"
  | "leaseDurationMs"
  | "maxAttempts"
  | "pollIntervalMs"
  | "retryBaseDelayMs"
  | "retryMaxDelayMs"
>;

export type WorkerRuntimeOptions = Readonly<{
  config: WorkerRuntimeConfig;
  dispatcher: JobDispatcher;
  now?: () => Date;
  observability: Observability;
  random?: () => number;
  repository: JobRepository;
  signal: AbortSignal;
  sleep?: typeof waitForAbortableDelay;
  workerId: string;
}>;

export async function waitForAbortableDelay(
  durationMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
    throw new RangeError("Delay must be a non-negative safe integer.");
  }
  if (signal.aborted || durationMs === 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, durationMs);

    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }

    signal.addEventListener("abort", done, { once: true });
  });
}

async function executeJob(
  job: ClaimedJob,
  options: WorkerRuntimeOptions,
  retryPolicy: RetryPolicy,
  now: () => Date,
  random: () => number,
): Promise<void> {
  const attributes = {
    attemptCount: job.attemptCount,
    jobId: job.id,
    jobType: job.type,
    organizationId: job.organizationId,
  };

  try {
    await options.observability.withSpan(
      "worker.job.execute",
      () => options.dispatcher.dispatch(job, { signal: options.signal }),
      attributes,
    );

    const result = await options.repository.complete({
      jobId: job.id,
      now: now(),
      workerId: options.workerId,
    });
    if (result === "lease_lost") {
      options.observability.logger.warn("worker_job_lease_lost", attributes);
      return;
    }
    options.observability.logger.info("worker_job_completed", attributes);
  } catch (error) {
    const failure = classifyJobFailure(error);
    const lastError = persistedJobError(failure);
    const transitionTime = now();

    if (shouldRetry(job.attemptCount, failure.retryable, retryPolicy)) {
      const delayMs = retryDelayMs(job.attemptCount, retryPolicy, random);
      const result = await options.repository.retry({
        jobId: job.id,
        lastError,
        nextAttemptAt: new Date(transitionTime.getTime() + delayMs),
        now: transitionTime,
        workerId: options.workerId,
      });
      options.observability.logger.warn(
        result === "updated" ? "worker_job_retry_scheduled" : "worker_job_lease_lost",
        {
          ...attributes,
          delayMs,
          errorCode: failure.code,
        },
      );
      return;
    }

    const result = await options.repository.fail({
      jobId: job.id,
      lastError,
      now: transitionTime,
      retryable: failure.retryable,
      workerId: options.workerId,
    });
    options.observability.logger.error(
      result === "updated" ? "worker_job_failed" : "worker_job_lease_lost",
      {
        ...attributes,
        errorCode: failure.code,
      },
    );
  }
}

export async function runWorker(options: WorkerRuntimeOptions): Promise<void> {
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? waitForAbortableDelay;
  const retryPolicy: RetryPolicy = {
    baseDelayMs: options.config.retryBaseDelayMs,
    maxAttempts: options.config.maxAttempts,
    maxDelayMs: options.config.retryMaxDelayMs,
  };

  options.observability.logger.info("worker_started", { workerId: options.workerId });

  while (!options.signal.aborted) {
    try {
      const pollTime = now();
      const queue = await options.repository.inspect(pollTime);
      options.observability.metrics.recordJobQueue(queue.depth, queue.oldestAgeMs);
      const claimed = await options.repository.claim({
        leaseDurationMs: options.config.leaseDurationMs,
        limit: options.config.claimLimit,
        now: pollTime,
        workerId: options.workerId,
      });

      if (claimed.length === 0) {
        await sleep(options.config.pollIntervalMs, options.signal);
        continue;
      }

      await Promise.all(claimed.map((job) => executeJob(job, options, retryPolicy, now, random)));
    } catch (error) {
      options.observability.logger.error("worker_poll_failed", { error });
      await sleep(options.config.pollIntervalMs, options.signal);
    }
  }

  options.observability.logger.info("worker_stopped", { workerId: options.workerId });
}
