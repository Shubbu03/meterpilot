import { afterAll, beforeAll, expect, test } from "bun:test";
import { checkDatabaseHealth, createDatabase, type Database } from "@meterpilot/db";
import { auditLog, jobs, organizations, users } from "@meterpilot/db/schema";
import { and, eq } from "drizzle-orm";

import { createDrizzleJobOperationsRepository } from "../src/features/job-operations/drizzle-repository";

const testDatabaseUrl = process.env.SERVER_TEST_DATABASE_URL;
const databaseTest = testDatabaseUrl ? test : test.skip;
const NOW = new Date("2026-08-20T11:00:00.000Z");
let database: Database | null = null;

function requireDatabase(): Database {
  if (!database) throw new Error("Job-operations integration database was not initialized.");
  return database;
}

beforeAll(async () => {
  if (!testDatabaseUrl) return;
  database = createDatabase(testDatabaseUrl, 10);
  await checkDatabaseHealth(database.client);
});

afterAll(async () => {
  await database?.close();
});

databaseTest(
  "failed-job inspection redacts payloads and concurrent retry creates one audited new attempt cycle",
  async () => {
    const { db } = requireDatabase();
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const retryableJobId = crypto.randomUUID();
    const permanentJobId = crypto.randomUUID();
    const previewId = crypto.randomUUID();
    const retryFailure = "database_unavailable: Database temporarily unavailable.";

    await db.insert(users).values({
      email: `${userId}@example.com`,
      id: userId,
      name: "Job operations integration owner",
    });
    await db.insert(organizations).values({
      id: organizationId,
      name: "Job operations integration",
      slug: `job-ops-${organizationId.slice(0, 12)}`,
    });
    await db.insert(jobs).values([
      {
        attemptCount: 8,
        completedAt: new Date("2026-08-20T10:05:00.000Z"),
        failureRetryable: true,
        id: retryableJobId,
        lastError: retryFailure,
        organizationId,
        payload: {
          previewId,
          properties: { prompt: "must-not-leak" },
          requestId: "preview-request",
          secret: "must-not-leak",
        },
        resourceId: previewId,
        resourceType: "invoice_preview",
        status: "failed",
        type: "invoice_preview.generate",
      },
      {
        attemptCount: 1,
        completedAt: new Date("2026-08-20T10:06:00.000Z"),
        failureRetryable: false,
        id: permanentJobId,
        lastError: "invalid_job_payload: Stored metadata is invalid.",
        organizationId,
        payload: { secret: "must-not-leak" },
        resourceId: "permanent-resource",
        resourceType: "test_resource",
        status: "failed",
        type: "test.permanent",
      },
    ]);

    const tenant = {
      actorUserId: userId,
      membership: {
        createdAt: NOW.toISOString(),
        role: "owner" as const,
        user: { email: `${userId}@example.com`, id: userId, name: "Owner" },
      },
      organization: {
        createdAt: NOW.toISOString(),
        defaultTimezone: "UTC",
        id: organizationId,
        name: "Job operations integration",
        slug: `job-ops-${organizationId.slice(0, 12)}`,
      },
    };
    const repository = createDrizzleJobOperationsRepository(db, () => NOW);

    const inspected = await repository.findFailedJob(tenant, retryableJobId);
    expect(inspected).toMatchObject({
      job: {
        attemptCount: 8,
        failure: { code: "database_unavailable" },
        payloadMetadata: { previewId, requestId: "preview-request" },
        retryable: true,
      },
      status: "ok",
    });
    expect(JSON.stringify(inspected)).not.toContain("must-not-leak");
    expect(
      await repository.findFailedJob(
        { ...tenant, organization: { ...tenant.organization, id: crypto.randomUUID() } },
        retryableJobId,
      ),
    ).toEqual({ status: "not_found" });
    expect(
      await repository.retryFailedJob(
        tenant,
        permanentJobId,
        {
          acknowledgedAttemptCount: 1,
          acknowledgedFailureCode: "invalid_job_payload",
          acknowledgedManualRetryCount: 0,
        },
        "permanent-retry-request",
      ),
    ).toEqual({ status: "not_retryable" });

    const acknowledgements = {
      acknowledgedAttemptCount: 8,
      acknowledgedFailureCode: "database_unavailable",
      acknowledgedManualRetryCount: 0,
    } as const;
    const retries = await Promise.all([
      repository.retryFailedJob(tenant, retryableJobId, acknowledgements, "manual-retry-left"),
      repository.retryFailedJob(tenant, retryableJobId, acknowledgements, "manual-retry-right"),
    ]);

    expect(retries.filter((result) => result.status === "ok")).toHaveLength(1);
    expect(retries.filter((result) => result.status === "conflict")).toHaveLength(1);
    expect(
      await db
        .select({
          attemptCount: jobs.attemptCount,
          completedAt: jobs.completedAt,
          failureRetryable: jobs.failureRetryable,
          lastError: jobs.lastError,
          manualRetryCount: jobs.manualRetryCount,
          nextAttemptAt: jobs.nextAttemptAt,
          status: jobs.status,
        })
        .from(jobs)
        .where(and(eq(jobs.organizationId, organizationId), eq(jobs.id, retryableJobId))),
    ).toEqual([
      {
        attemptCount: 0,
        completedAt: null,
        failureRetryable: null,
        lastError: null,
        manualRetryCount: 1,
        nextAttemptAt: NOW,
        status: "pending",
      },
    ]);
    const retryAudit = await db
      .select({ action: auditLog.action, metadata: auditLog.metadata })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, organizationId),
          eq(auditLog.resourceType, "job"),
          eq(auditLog.resourceId, retryableJobId),
        ),
      );
    expect(retryAudit).toEqual([
      {
        action: "job.retry_requested",
        metadata: {
          failureCode: "database_unavailable",
          jobType: "invoice_preview.generate",
          manualRetryCount: 1,
          previousAttemptCount: 8,
          resourceId: previewId,
          resourceType: "invoice_preview",
        },
      },
    ]);
    expect(JSON.stringify(retryAudit)).not.toContain("must-not-leak");
  },
);
