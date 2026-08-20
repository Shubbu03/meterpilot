import type { Database } from "@meterpilot/db";
import { jobs } from "@meterpilot/db/schema";
import { and, asc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";

import type {
  ClaimedJob,
  ClaimJobsOptions,
  FinishJobOptions,
  JobRepository,
  JobTransitionResult,
} from "./repository";

const MAX_CLAIM_LIMIT = 100;
const MAX_ERROR_LENGTH = 4096;
const MAX_LEASE_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_WORKER_ID_LENGTH = 128;

function assertDate(value: Date, field: string): void {
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError(`${field} must be a valid date.`);
  }
}

function assertIdentifier(value: string, field: string): void {
  if (value.trim().length === 0 || value.length > MAX_WORKER_ID_LENGTH) {
    throw new TypeError(`${field} must be between 1 and ${MAX_WORKER_ID_LENGTH} characters.`);
  }
}

function assertClaimOptions(options: ClaimJobsOptions): void {
  assertDate(options.now, "Claim time");
  assertIdentifier(options.workerId, "Worker ID");

  if (
    !Number.isSafeInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > MAX_CLAIM_LIMIT
  ) {
    throw new RangeError(`Claim limit must be an integer between 1 and ${MAX_CLAIM_LIMIT}.`);
  }

  if (
    !Number.isSafeInteger(options.leaseDurationMs) ||
    options.leaseDurationMs < 1_000 ||
    options.leaseDurationMs > MAX_LEASE_DURATION_MS
  ) {
    throw new RangeError(
      `Lease duration must be an integer between 1000 and ${MAX_LEASE_DURATION_MS} milliseconds.`,
    );
  }
}

function assertFinishOptions(options: FinishJobOptions): void {
  assertIdentifier(options.jobId, "Job ID");
  assertIdentifier(options.workerId, "Worker ID");
  assertDate(options.now, "Transition time");
}

function assertLastError(lastError: string): void {
  if (lastError.trim().length === 0 || lastError.length > MAX_ERROR_LENGTH) {
    throw new TypeError(`Last error must be between 1 and ${MAX_ERROR_LENGTH} characters.`);
  }
}

function transitionResult(updatedRows: readonly unknown[]): JobTransitionResult {
  return updatedRows.length === 1 ? "updated" : "lease_lost";
}

const claimedJobSelection = {
  attemptCount: jobs.attemptCount,
  createdAt: jobs.createdAt,
  id: jobs.id,
  leaseExpiresAt: jobs.leaseExpiresAt,
  organizationId: jobs.organizationId,
  payload: jobs.payload,
  resourceId: jobs.resourceId,
  resourceType: jobs.resourceType,
  type: jobs.type,
};

export function createDrizzleJobRepository(database: Database["db"]): JobRepository {
  return Object.freeze({
    async claim(options) {
      assertClaimOptions(options);
      const leaseExpiresAt = new Date(options.now.getTime() + options.leaseDurationMs);

      return database.transaction(async (transaction) => {
        const available = await transaction
          .select({ id: jobs.id })
          .from(jobs)
          .where(
            or(
              and(eq(jobs.status, "pending"), lte(jobs.nextAttemptAt, options.now)),
              and(eq(jobs.status, "processing"), lte(jobs.leaseExpiresAt, options.now)),
            ),
          )
          .orderBy(asc(jobs.nextAttemptAt), asc(jobs.createdAt), asc(jobs.id))
          .limit(options.limit)
          .for("update", { skipLocked: true });

        if (available.length === 0) {
          return [];
        }

        const claimed = await transaction
          .update(jobs)
          .set({
            attemptCount: sql`${jobs.attemptCount} + 1`,
            leaseExpiresAt,
            leaseOwner: options.workerId,
            status: "processing",
            updatedAt: options.now,
          })
          .where(
            inArray(
              jobs.id,
              available.map(({ id }) => id),
            ),
          )
          .returning(claimedJobSelection);

        return claimed as readonly ClaimedJob[];
      });
    },

    async complete(options) {
      assertFinishOptions(options);
      const updated = await database
        .update(jobs)
        .set({
          completedAt: options.now,
          lastError: null,
          leaseExpiresAt: null,
          leaseOwner: null,
          status: "completed",
          updatedAt: options.now,
        })
        .where(
          and(
            eq(jobs.id, options.jobId),
            eq(jobs.status, "processing"),
            eq(jobs.leaseOwner, options.workerId),
            gt(jobs.leaseExpiresAt, options.now),
          ),
        )
        .returning({ id: jobs.id });

      return transitionResult(updated);
    },

    async fail(options) {
      assertFinishOptions(options);
      assertLastError(options.lastError);
      const updated = await database
        .update(jobs)
        .set({
          completedAt: options.now,
          lastError: options.lastError,
          leaseExpiresAt: null,
          leaseOwner: null,
          status: "failed",
          updatedAt: options.now,
        })
        .where(
          and(
            eq(jobs.id, options.jobId),
            eq(jobs.status, "processing"),
            eq(jobs.leaseOwner, options.workerId),
            gt(jobs.leaseExpiresAt, options.now),
          ),
        )
        .returning({ id: jobs.id });

      return transitionResult(updated);
    },

    async retry(options) {
      assertFinishOptions(options);
      assertDate(options.nextAttemptAt, "Next attempt time");
      assertLastError(options.lastError);
      if (options.nextAttemptAt.getTime() <= options.now.getTime()) {
        throw new RangeError("Next attempt time must be later than the transition time.");
      }

      const updated = await database
        .update(jobs)
        .set({
          completedAt: null,
          lastError: options.lastError,
          leaseExpiresAt: null,
          leaseOwner: null,
          nextAttemptAt: options.nextAttemptAt,
          status: "pending",
          updatedAt: options.now,
        })
        .where(
          and(
            eq(jobs.id, options.jobId),
            eq(jobs.status, "processing"),
            eq(jobs.leaseOwner, options.workerId),
            gt(jobs.leaseExpiresAt, options.now),
          ),
        )
        .returning({ id: jobs.id });

      return transitionResult(updated);
    },
  });
}
