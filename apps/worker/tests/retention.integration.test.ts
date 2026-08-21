import { afterAll, beforeAll, expect, test } from "bun:test";
import { checkDatabaseHealth, createDatabase, type Database } from "@meterpilot/db";
import {
  auditLog,
  customers,
  dataRetentionPolicies,
  jobs,
  organizations,
  usageEvents,
  users,
} from "@meterpilot/db/schema";
import { and, eq } from "drizzle-orm";

import { createDrizzleRetentionEnforcer } from "../src/jobs/drizzle-retention-enforcer";

const testDatabaseUrl = process.env.WORKER_TEST_DATABASE_URL;
const databaseTest = testDatabaseUrl ? test : test.skip;
const NOW = new Date("2026-10-31T00:00:00.000Z");
const RECEIVED_AT = new Date("2026-09-01T00:00:00.000Z");
let database: Database | null = null;

function requireDatabase(): Database {
  if (!database) throw new Error("Retention integration database was not initialized.");
  return database;
}

beforeAll(async () => {
  if (!testDatabaseUrl) return;
  database = createDatabase(testDatabaseUrl);
  await checkDatabaseHealth(database.client);
});

afterAll(async () => {
  await database?.close();
});

databaseTest(
  "retention redacts only completed event properties and preserves immutable evidence",
  async () => {
    const rollback = new Error("rollback retention integration fixture");

    await expect(
      requireDatabase().db.transaction(async (transaction) => {
        const organizationId = crypto.randomUUID();
        const userId = crypto.randomUUID();
        const customerId = crypto.randomUUID();
        const eventId = crypto.randomUUID();
        const processingJobId = crypto.randomUUID();
        const enforcementJobId = crypto.randomUUID();
        const payloadHash = "a".repeat(64);

        await transaction.insert(users).values({
          email: `${userId}@example.com`,
          id: userId,
          name: "Retention integration test",
        });
        await transaction.insert(organizations).values({
          id: organizationId,
          name: "Retention integration test",
          slug: `retention-${organizationId.slice(0, 12)}`,
        });
        await transaction.insert(customers).values({
          externalKey: "retention-customer",
          id: customerId,
          name: "Retention customer",
          organizationId,
        });
        await transaction.insert(dataRetentionPolicies).values({
          eventPropertiesRetentionDays: 30,
          organizationId,
          updatedAt: NOW,
          updatedBy: userId,
        });
        await transaction.insert(usageEvents).values({
          customerId,
          eventKey: "retention-event",
          eventType: "storage.bytes",
          id: eventId,
          occurredAt: RECEIVED_AT,
          organizationId,
          payloadHash,
          properties: { bytes: "1024", region: "us-east" },
          receivedAt: RECEIVED_AT,
          source: "quota_reservation",
          subjectKey: "retention-subject",
        });
        await transaction.insert(jobs).values({
          completedAt: RECEIVED_AT,
          createdAt: RECEIVED_AT,
          eventId,
          id: processingJobId,
          nextAttemptAt: RECEIVED_AT,
          organizationId,
          payload: { eventId, eventKey: "retention-event", requestId: "ingest-request" },
          resourceId: eventId,
          resourceType: "usage_event",
          status: "completed",
          type: "usage_event.process",
          updatedAt: RECEIVED_AT,
        });

        const enforcer = createDrizzleRetentionEnforcer(
          transaction as unknown as Database["db"],
          () => NOW,
        );
        expect(
          await enforcer.enforce(
            organizationId,
            1,
            "retention-request",
            enforcementJobId,
            new AbortController().signal,
          ),
        ).toEqual({ redactedCount: 1, status: "enforced" });

        const [event] = await transaction
          .select()
          .from(usageEvents)
          .where(eq(usageEvents.id, eventId));
        expect(event).toMatchObject({
          eventKey: "retention-event",
          eventType: "storage.bytes",
          payloadHash,
          properties: {},
          propertiesRedactedAt: NOW,
        });
        expect(
          await transaction
            .select({ action: auditLog.action, metadata: auditLog.metadata })
            .from(auditLog)
            .where(
              and(
                eq(auditLog.organizationId, organizationId),
                eq(auditLog.action, "retention.properties_redacted"),
              ),
            ),
        ).toEqual([
          {
            action: "retention.properties_redacted",
            metadata: {
              cutoff: "2026-10-01T00:00:00.000Z",
              eventCount: 1,
              policyVersion: 1,
            },
          },
        ]);
        expect(
          await transaction
            .select({
              nextAttemptAt: jobs.nextAttemptAt,
              payload: jobs.payload,
              resourceId: jobs.resourceId,
              status: jobs.status,
              type: jobs.type,
            })
            .from(jobs)
            .where(
              and(eq(jobs.organizationId, organizationId), eq(jobs.type, "retention.enforce")),
            ),
        ).toEqual([
          {
            nextAttemptAt: new Date("2026-11-01T00:00:00.000Z"),
            payload: {
              organizationId,
              policyVersion: 1,
              requestId: "retention-request",
            },
            resourceId: enforcementJobId,
            status: "pending",
            type: "retention.enforce",
          },
        ]);

        await expect(
          transaction.transaction((savepoint) =>
            savepoint
              .update(usageEvents)
              .set({ eventType: "tampered.event" })
              .where(eq(usageEvents.id, eventId)),
          ),
        ).rejects.toThrow();
        await expect(
          transaction.transaction((savepoint) =>
            savepoint
              .update(usageEvents)
              .set({ propertiesRedactedAt: new Date("2026-11-01T00:00:00.000Z") })
              .where(eq(usageEvents.id, eventId)),
          ),
        ).rejects.toThrow();

        throw rollback;
      }),
    ).rejects.toBe(rollback);
  },
);
