import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  checkDatabaseHealth,
  createDatabase,
  effectiveUsageEventPredicate,
  type Database,
} from "@meterpilot/db";
import {
  customers,
  meters,
  meterVersions,
  organizations,
  usageBuckets,
  usageEvents,
} from "@meterpilot/db/schema";
import { and, asc, eq, lte } from "drizzle-orm";

import { createDrizzleUsageEventProcessor } from "../src/jobs/drizzle-usage-event-processor";

const testDatabaseUrl = process.env.WORKER_TEST_DATABASE_URL;
const databaseTest = testDatabaseUrl ? test : test.skip;
const ORIGINAL_RECEIVED_AT = new Date("2026-10-01T00:00:00.000Z");
const REPLACEMENT_RECEIVED_AT = new Date("2026-10-01T01:00:00.000Z");
const REVERSED_AT = new Date("2026-10-01T02:00:00.000Z");
let database: Database | null = null;

function requireDatabase(): Database {
  if (!database) throw new Error("Correction integration database was not initialized.");
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

databaseTest("correction chains preserve snapshots and converge aggregate state", async () => {
  const rollback = new Error("rollback correction integration fixture");

  await expect(
    requireDatabase().db.transaction(async (transaction) => {
      const organizationId = crypto.randomUUID();
      const customerId = crypto.randomUUID();
      const meterId = crypto.randomUUID();
      const meterVersionId = crypto.randomUUID();
      const originalId = crypto.randomUUID();
      const replacementId = crypto.randomUUID();
      const reversalId = crypto.randomUUID();
      await transaction.insert(organizations).values({
        id: organizationId,
        name: "Correction integration test",
        slug: `correction-${organizationId.slice(0, 12)}`,
      });
      await transaction.insert(customers).values({
        externalKey: "correction-customer",
        id: customerId,
        name: "Correction customer",
        organizationId,
      });
      await transaction.insert(meters).values({
        id: meterId,
        key: "correction.units",
        name: "Correction units",
        organizationId,
        status: "active",
      });
      await transaction.insert(meterVersions).values({
        aggregation: "sum",
        effectiveFrom: ORIGINAL_RECEIVED_AT,
        eventType: "correction.units",
        id: meterVersionId,
        meterId,
        organizationId,
        publishedAt: ORIGINAL_RECEIVED_AT,
        valueProperty: "quantity",
        version: 1,
      });
      await transaction.insert(usageEvents).values({
        customerId,
        eventKey: "evt_original",
        eventType: "correction.units",
        id: originalId,
        occurredAt: ORIGINAL_RECEIVED_AT,
        organizationId,
        payloadHash: "a".repeat(64),
        properties: { quantity: "5" },
        receivedAt: ORIGINAL_RECEIVED_AT,
        source: "quota_reservation",
        subjectKey: "correction-subject",
      });

      const processor = createDrizzleUsageEventProcessor(
        transaction as unknown as Database["db"],
        () => REVERSED_AT,
      );
      expect(
        await processor.process(organizationId, originalId, new AbortController().signal),
      ).toMatchObject({ bucketCount: 1, status: "processed" });
      expect(
        await transaction
          .select({ quantity: usageBuckets.quantity })
          .from(usageBuckets)
          .where(eq(usageBuckets.meterVersionId, meterVersionId)),
      ).toEqual([{ quantity: "5" }]);

      await transaction.insert(usageEvents).values({
        correctionKind: "replace",
        correctionOfEventId: originalId,
        customerId,
        eventKey: "evt_replacement",
        eventType: "correction.units",
        id: replacementId,
        occurredAt: ORIGINAL_RECEIVED_AT,
        organizationId,
        payloadHash: "b".repeat(64),
        properties: { quantity: "2" },
        receivedAt: REPLACEMENT_RECEIVED_AT,
        source: "quota_reservation",
        subjectKey: "correction-subject",
      });

      const atOriginalWatermark = await transaction
        .select({ eventKey: usageEvents.eventKey })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.organizationId, organizationId),
            lte(usageEvents.receivedAt, ORIGINAL_RECEIVED_AT),
            effectiveUsageEventPredicate(ORIGINAL_RECEIVED_AT),
          ),
        )
        .orderBy(asc(usageEvents.eventKey));
      const atReplacementWatermark = await transaction
        .select({ eventKey: usageEvents.eventKey })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.organizationId, organizationId),
            lte(usageEvents.receivedAt, REPLACEMENT_RECEIVED_AT),
            effectiveUsageEventPredicate(REPLACEMENT_RECEIVED_AT),
          ),
        )
        .orderBy(asc(usageEvents.eventKey));
      expect(atOriginalWatermark).toEqual([{ eventKey: "evt_original" }]);
      expect(atReplacementWatermark).toEqual([{ eventKey: "evt_replacement" }]);

      await processor.process(organizationId, replacementId, new AbortController().signal);
      expect(
        await transaction
          .select({ quantity: usageBuckets.quantity })
          .from(usageBuckets)
          .where(eq(usageBuckets.meterVersionId, meterVersionId)),
      ).toEqual([{ quantity: "2" }]);

      await transaction.insert(usageEvents).values({
        correctionKind: "reverse",
        correctionOfEventId: replacementId,
        customerId,
        eventKey: "evt_reversal",
        eventType: "correction.units",
        id: reversalId,
        occurredAt: ORIGINAL_RECEIVED_AT,
        organizationId,
        payloadHash: "c".repeat(64),
        properties: { quantity: "2" },
        receivedAt: REVERSED_AT,
        source: "quota_reservation",
        subjectKey: "correction-subject",
      });
      await processor.process(organizationId, reversalId, new AbortController().signal);
      expect(
        await transaction
          .select({ quantity: usageBuckets.quantity })
          .from(usageBuckets)
          .where(eq(usageBuckets.meterVersionId, meterVersionId)),
      ).toEqual([]);

      throw rollback;
    }),
  ).rejects.toBe(rollback);
});
