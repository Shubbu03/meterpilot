import {
  failedJobSchema,
  jobFailureCodeSchema,
  MAX_MANUAL_JOB_RETRIES,
  type FailedJob,
} from "@meterpilot/contracts/jobs";
import type { Database } from "@meterpilot/db";
import { auditLog, jobs } from "@meterpilot/db/schema";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";

import { canManageFailedJobs } from "../organizations/authorization";
import { InvalidFailedJobCursorError, type JobOperationsRepository } from "./repository";

const SAFE_PAYLOAD_FIELDS = new Set([
  "eventId",
  "eventKey",
  "effectiveFrom",
  "effectiveTo",
  "exportId",
  "expiresAt",
  "meterVersionId",
  "organizationId",
  "periodEnd",
  "periodStart",
  "policyVersion",
  "previewId",
  "requestId",
  "reservationId",
  "runId",
  "simulationId",
  "subscriptionId",
]);
const failedJobCursorSchema = failedJobSchema.pick({ failedAt: true, id: true });

const failedJobSelection = {
  attemptCount: jobs.attemptCount,
  completedAt: jobs.completedAt,
  createdAt: jobs.createdAt,
  failureRetryable: jobs.failureRetryable,
  id: jobs.id,
  lastError: jobs.lastError,
  manualRetryCount: jobs.manualRetryCount,
  payload: jobs.payload,
  resourceId: jobs.resourceId,
  resourceType: jobs.resourceType,
  status: jobs.status,
  type: jobs.type,
};

type FailedJobRow = Pick<
  typeof jobs.$inferSelect,
  | "attemptCount"
  | "completedAt"
  | "createdAt"
  | "failureRetryable"
  | "id"
  | "lastError"
  | "manualRetryCount"
  | "payload"
  | "resourceId"
  | "resourceType"
  | "status"
  | "type"
>;

function encodeCursor(job: FailedJob): string {
  return Buffer.from(JSON.stringify({ failedAt: job.failedAt, id: job.id })).toString("base64url");
}

function decodeCursor(cursor?: string): Readonly<{ failedAt: Date; id: string }> | undefined {
  if (!cursor) return undefined;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (Buffer.from(decoded).toString("base64url") !== cursor) {
      throw new InvalidFailedJobCursorError();
    }
    const parsed = failedJobCursorSchema.safeParse(JSON.parse(decoded));
    if (!parsed.success) throw new InvalidFailedJobCursorError();
    return { failedAt: new Date(parsed.data.failedAt), id: parsed.data.id };
  } catch (error) {
    if (error instanceof InvalidFailedJobCursorError) throw error;
    throw new InvalidFailedJobCursorError();
  }
}

function failure(lastError: string | null): FailedJob["failure"] {
  const separator = lastError?.indexOf(": ") ?? -1;
  if (!lastError || separator < 1) {
    return { code: "unknown_failure", message: "The job failed without a recognized error." };
  }
  const code = jobFailureCodeSchema.safeParse(lastError.slice(0, separator));
  const message = lastError.slice(separator + 2).trim();
  if (!code.success || message.length < 1 || message.length > 512) {
    return { code: "unknown_failure", message: "The job failed without a recognized error." };
  }
  return { code: code.data, message };
}

function payloadMetadata(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!SAFE_PAYLOAD_FIELDS.has(key)) continue;
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number" ||
      typeof value === "string"
    ) {
      result[key] = value;
    }
  }
  return result;
}

function toFailedJob(row: FailedJobRow): FailedJob {
  if (row.status !== "failed" || !row.completedAt || row.failureRetryable === null) {
    throw new TypeError("Only terminal failed jobs can be exposed as failed jobs.");
  }
  return failedJobSchema.parse({
    attemptCount: row.attemptCount,
    createdAt: row.createdAt.toISOString(),
    failedAt: row.completedAt.toISOString(),
    failure: failure(row.lastError),
    id: row.id,
    manualRetryCount: row.manualRetryCount,
    payloadMetadata: payloadMetadata(row.payload),
    resourceId: row.resourceId,
    resourceType: row.resourceType,
    retryable: row.failureRetryable,
    type: row.type,
  });
}

export function createDrizzleJobOperationsRepository(
  database: Database["db"],
  now: () => Date = () => new Date(),
): JobOperationsRepository {
  return Object.freeze({
    async findFailedJob(tenant, jobId) {
      if (!canManageFailedJobs(tenant.membership.role)) return { status: "forbidden" };
      const [row] = await database
        .select(failedJobSelection)
        .from(jobs)
        .where(
          and(
            eq(jobs.organizationId, tenant.organization.id),
            eq(jobs.id, jobId),
            eq(jobs.status, "failed"),
          ),
        )
        .limit(1);
      return row ? { job: toFailedJob(row), status: "ok" } : { status: "not_found" };
    },

    async listFailedJobs(tenant, query) {
      if (!canManageFailedJobs(tenant.membership.role)) return { status: "forbidden" };
      const cursor = decodeCursor(query.cursor);
      const rows = await database
        .select(failedJobSelection)
        .from(jobs)
        .where(
          and(
            eq(jobs.organizationId, tenant.organization.id),
            eq(jobs.status, "failed"),
            query.type ? eq(jobs.type, query.type) : undefined,
            cursor
              ? or(
                  lt(jobs.completedAt, cursor.failedAt),
                  and(eq(jobs.completedAt, cursor.failedAt), lt(jobs.id, cursor.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(jobs.completedAt), desc(jobs.id))
        .limit(query.limit + 1);
      const hasNext = rows.length > query.limit;
      const items = rows.slice(0, query.limit).map((row) => toFailedJob(row));
      const last = items.at(-1);
      return {
        page: {
          items,
          nextCursor: hasNext && last ? encodeCursor(last) : null,
        },
        status: "ok",
      };
    },

    async retryFailedJob(tenant, jobId, input, requestId) {
      if (!canManageFailedJobs(tenant.membership.role)) return { status: "forbidden" };
      return database.transaction(async (transaction) => {
        const [job] = await transaction
          .select({
            attemptCount: jobs.attemptCount,
            failureRetryable: jobs.failureRetryable,
            id: jobs.id,
            lastError: jobs.lastError,
            manualRetryCount: jobs.manualRetryCount,
            resourceId: jobs.resourceId,
            resourceType: jobs.resourceType,
            status: jobs.status,
            type: jobs.type,
          })
          .from(jobs)
          .where(and(eq(jobs.organizationId, tenant.organization.id), eq(jobs.id, jobId)))
          .for("update")
          .limit(1);
        if (!job) return { status: "not_found" } as const;
        if (job.status !== "failed") return { status: "conflict" } as const;
        if (!job.failureRetryable) return { status: "not_retryable" } as const;
        const currentFailure = failure(job.lastError);
        if (
          job.attemptCount !== input.acknowledgedAttemptCount ||
          currentFailure.code !== input.acknowledgedFailureCode ||
          job.manualRetryCount !== input.acknowledgedManualRetryCount
        ) {
          return { status: "conflict" } as const;
        }
        if (job.manualRetryCount >= MAX_MANUAL_JOB_RETRIES) {
          return { status: "retry_limit" } as const;
        }

        const retriedAt = now();
        const [updated] = await transaction
          .update(jobs)
          .set({
            attemptCount: 0,
            completedAt: null,
            failureRetryable: null,
            lastError: null,
            leaseExpiresAt: null,
            leaseOwner: null,
            manualRetryCount: sql`${jobs.manualRetryCount} + 1`,
            nextAttemptAt: retriedAt,
            status: "pending",
            updatedAt: retriedAt,
          })
          .where(
            and(
              eq(jobs.organizationId, tenant.organization.id),
              eq(jobs.id, jobId),
              eq(jobs.status, "failed"),
              eq(jobs.failureRetryable, true),
              eq(jobs.attemptCount, input.acknowledgedAttemptCount),
              eq(jobs.manualRetryCount, job.manualRetryCount),
            ),
          )
          .returning({ manualRetryCount: jobs.manualRetryCount });
        if (!updated) return { status: "conflict" } as const;

        await transaction.insert(auditLog).values({
          action: "job.retry_requested",
          actorType: "user",
          actorUserId: tenant.actorUserId,
          metadata: {
            failureCode: currentFailure.code,
            jobType: job.type,
            manualRetryCount: updated.manualRetryCount,
            previousAttemptCount: job.attemptCount,
            resourceId: job.resourceId,
            resourceType: job.resourceType,
          },
          occurredAt: retriedAt,
          organizationId: tenant.organization.id,
          requestId,
          resourceId: job.id,
          resourceType: "job",
        });

        return {
          jobId: job.id,
          manualRetryCount: updated.manualRetryCount,
          nextAttemptAt: retriedAt,
          status: "ok",
        } as const;
      });
    },
  });
}
