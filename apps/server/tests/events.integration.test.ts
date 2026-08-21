import { afterAll, beforeAll, expect, test } from "bun:test";
import { checkDatabaseHealth, createDatabase, type Database } from "@meterpilot/db";
import {
  apiKeys,
  auditLog,
  customers,
  jobs,
  organizations,
  subjects,
  usageEvents,
} from "@meterpilot/db/schema";
import { and, eq } from "drizzle-orm";

import { createDrizzleEventRepository } from "../src/features/events/drizzle-repository";
import { createEventService } from "../src/features/events/service";

const testDatabaseUrl = process.env.SERVER_TEST_DATABASE_URL;
const databaseTest = testDatabaseUrl ? test : test.skip;
const INGESTED_AT = new Date("2026-10-01T00:00:00.000Z");
const CORRECTED_AT = new Date("2026-10-01T01:00:00.000Z");
let database: Database | null = null;

function requireDatabase(): Database {
  if (!database) throw new Error("Event integration database was not initialized.");
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

databaseTest("corrections are idempotent, append-only, tenant-scoped, and audited", async () => {
  const rollback = new Error("rollback event correction integration fixture");

  await expect(
    requireDatabase().db.transaction(async (transaction) => {
      const organizationId = crypto.randomUUID();
      const customerId = crypto.randomUUID();
      const apiKeyId = crypto.randomUUID();
      await transaction.insert(organizations).values({
        id: organizationId,
        name: "Event correction integration test",
        slug: `event-correction-${organizationId.slice(0, 12)}`,
      });
      await transaction.insert(customers).values({
        externalKey: "event-correction-customer",
        id: customerId,
        name: "Event correction customer",
        organizationId,
      });
      await transaction.insert(subjects).values({
        customerId,
        externalKey: "event-correction-subject",
        organizationId,
      });
      await transaction.insert(apiKeys).values({
        createdAt: INGESTED_AT,
        id: apiKeyId,
        organizationId,
        prefix: `test_${apiKeyId.slice(0, 12)}`,
        scopes: ["events:write", "events:read"],
        secretHash: "a".repeat(64),
      });

      let clock = INGESTED_AT;
      const service = createEventService(
        createDrizzleEventRepository(transaction as unknown as Database["db"]),
        { now: () => clock },
      );
      const principal = {
        apiKeyId,
        organizationId,
        scopes: ["events:write", "events:read"] as const,
      };
      expect(
        await service.ingestOne(
          principal,
          {
            id: "evt_original",
            occurredAt: INGESTED_AT.toISOString(),
            properties: { quantity: "5" },
            subject: "event-correction-subject",
            type: "correction.units",
          },
          "request_ingest",
        ),
      ).toMatchObject({ results: [{ id: "evt_original", status: "accepted" }] });

      clock = CORRECTED_AT;
      const correctionRequest = {
        event: {
          id: "evt_replacement",
          occurredAt: INGESTED_AT.toISOString(),
          properties: { quantity: "2" },
          subject: "event-correction-subject",
          type: "correction.units",
        },
        kind: "replace" as const,
      };
      expect(
        await service.correct(principal, "evt_original", correctionRequest, "request_correction"),
      ).toMatchObject({
        response: { correction: { correctionEventId: "evt_replacement", status: "accepted" } },
        status: "ok",
      });
      expect(
        await service.correct(
          principal,
          "evt_original",
          correctionRequest,
          "request_correction_retry",
        ),
      ).toMatchObject({
        response: { correction: { correctionEventId: "evt_replacement", status: "duplicate" } },
        status: "ok",
      });
      expect(
        await service.correct(
          principal,
          "evt_original",
          { id: "evt_second_correction", kind: "reverse" },
          "request_second_correction",
        ),
      ).toEqual({ status: "already_corrected" });

      expect(await service.find(principal, "evt_original")).toMatchObject({
        correctedBy: { eventId: "evt_replacement", kind: "replace" },
        correctionOf: null,
      });
      expect(await service.find(principal, "evt_replacement")).toMatchObject({
        correctedBy: null,
        correctionOf: { eventId: "evt_original", kind: "replace" },
      });
      expect(
        await transaction
          .select({ action: auditLog.action })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.organizationId, organizationId),
              eq(auditLog.action, "usage_event.corrected"),
            ),
          ),
      ).toEqual([{ action: "usage_event.corrected" }]);
      expect(
        await transaction
          .select({ id: jobs.id })
          .from(jobs)
          .where(eq(jobs.organizationId, organizationId)),
      ).toHaveLength(2);

      await expect(
        transaction.transaction(async (savepoint) => {
          await savepoint
            .update(usageEvents)
            .set({ properties: { quantity: "999" } })
            .where(
              and(
                eq(usageEvents.organizationId, organizationId),
                eq(usageEvents.eventKey, "evt_original"),
              ),
            );
        }),
      ).rejects.toThrow("usage events are immutable");
      await expect(
        transaction.transaction(async (savepoint) => {
          await savepoint
            .delete(usageEvents)
            .where(
              and(
                eq(usageEvents.organizationId, organizationId),
                eq(usageEvents.eventKey, "evt_original"),
              ),
            );
        }),
      ).rejects.toThrow("usage events are immutable");

      throw rollback;
    }),
  ).rejects.toBe(rollback);
});
