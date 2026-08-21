import { afterAll, beforeAll, expect, test } from "bun:test";
import { checkDatabaseHealth, createDatabase, type Database } from "@meterpilot/db";
import {
  auditLog,
  billingExports,
  customers,
  invoicePreviewLines,
  invoicePreviews,
  meters,
  meterVersions,
  organizations,
  planComponents,
  plans,
  planVersions,
  reconciliationFindings,
  reconciliationRuns,
  subscriptions,
  usageBuckets,
  usageEvents,
  users,
} from "@meterpilot/db/schema";
import { and, eq } from "drizzle-orm";

import { createDrizzleBillingExportGenerator } from "../src/jobs/drizzle-billing-export-generator";
import { createDrizzleReconciliationRunner } from "../src/jobs/drizzle-reconciliation-runner";
import { createDrizzleUsageEventProcessor } from "../src/jobs/drizzle-usage-event-processor";
import { dimensionsHash } from "../src/jobs/usage-event-aggregation";

const testDatabaseUrl = process.env.WORKER_TEST_DATABASE_URL;
const databaseTest = testDatabaseUrl ? test : test.skip;
const PERIOD_START = new Date("2026-10-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-10-01T01:00:00.000Z");
const WATERMARK = new Date("2026-10-01T02:00:00.000Z");
let database: Database | null = null;

function requireDatabase(): Database {
  if (!database) throw new Error("Operations integration database was not initialized.");
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
  "reconciliation detects drift, repairs only derived buckets, and seals its evidence",
  async () => {
    const rollback = new Error("rollback reconciliation integration fixture");

    await expect(
      requireDatabase().db.transaction(async (transaction) => {
        const organizationId = crypto.randomUUID();
        const userId = crypto.randomUUID();
        const customerId = crypto.randomUUID();
        const meterId = crypto.randomUUID();
        const meterVersionId = crypto.randomUUID();
        const eventId = crypto.randomUUID();
        const runId = crypto.randomUUID();
        const emptyDimensionsHash = dimensionsHash({});

        await transaction.insert(users).values({
          email: `${userId}@example.com`,
          id: userId,
          name: "Reconciliation integration test",
        });
        await transaction.insert(organizations).values({
          id: organizationId,
          name: "Reconciliation integration test",
          slug: `reconciliation-${organizationId.slice(0, 12)}`,
        });
        await transaction.insert(customers).values({
          externalKey: "reconciliation-customer",
          id: customerId,
          name: "Reconciliation customer",
          organizationId,
        });
        await transaction.insert(meters).values({
          id: meterId,
          key: "reconciliation.units",
          name: "Reconciliation units",
          organizationId,
          status: "active",
        });
        await transaction.insert(meterVersions).values({
          aggregation: "sum",
          effectiveFrom: PERIOD_START,
          eventType: "reconciliation.units",
          id: meterVersionId,
          meterId,
          organizationId,
          publishedAt: PERIOD_START,
          valueProperty: "quantity",
          version: 1,
        });
        await transaction.insert(usageEvents).values({
          customerId,
          eventKey: "reconciliation-event",
          eventType: "reconciliation.units",
          id: eventId,
          occurredAt: PERIOD_START,
          organizationId,
          payloadHash: "a".repeat(64),
          properties: { quantity: "5" },
          receivedAt: PERIOD_START,
          source: "quota_reservation",
          subjectKey: "reconciliation-subject",
        });
        await transaction.insert(usageBuckets).values({
          bucketStart: PERIOD_START,
          customerId,
          dimensions: {},
          dimensionsHash: emptyDimensionsHash,
          eventCount: 1,
          maxReceivedAt: PERIOD_START,
          meterVersionId,
          organizationId,
          quantity: "2",
        });
        await transaction.insert(reconciliationRuns).values({
          customerId,
          id: runId,
          inputWatermark: WATERMARK,
          kind: "reconciliation",
          meterId,
          organizationId,
          periodEnd: PERIOD_END,
          periodStart: PERIOD_START,
          repairRequested: true,
          requestedBy: userId,
        });

        const runner = createDrizzleReconciliationRunner(
          transaction as unknown as Database["db"],
          () => WATERMARK,
        );
        expect(
          await runner.run(
            organizationId,
            runId,
            "reconciliation-integration-request",
            new AbortController().signal,
          ),
        ).toEqual({ driftCount: 1, status: "completed", totalMagnitude: "3" });

        const [run] = await transaction
          .select()
          .from(reconciliationRuns)
          .where(eq(reconciliationRuns.id, runId));
        expect(run).toMatchObject({
          afterHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          beforeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          status: "completed",
          summary: { driftCount: 1, repairedCount: 1, totalMagnitude: "3" },
        });
        expect(run?.afterHash).not.toBe(run?.beforeHash);
        expect(
          await transaction
            .select({
              eventCount: usageBuckets.eventCount,
              quantity: usageBuckets.quantity,
              revision: usageBuckets.revision,
            })
            .from(usageBuckets)
            .where(eq(usageBuckets.meterVersionId, meterVersionId)),
        ).toEqual([{ eventCount: 1, quantity: "5", revision: 2 }]);
        expect(
          await transaction
            .select()
            .from(reconciliationFindings)
            .where(eq(reconciliationFindings.runId, runId)),
        ).toEqual([
          expect.objectContaining({
            actualQuantity: "2",
            expectedQuantity: "5",
            kind: "mismatch",
            repaired: true,
          }),
        ]);
        expect(
          await transaction
            .select({ properties: usageEvents.properties })
            .from(usageEvents)
            .where(eq(usageEvents.id, eventId)),
        ).toEqual([{ properties: { quantity: "5" } }]);

        await expect(
          transaction.transaction(async (savepoint) => {
            await savepoint
              .update(reconciliationRuns)
              .set({ repairRequested: false })
              .where(eq(reconciliationRuns.id, runId));
          }),
        ).rejects.toThrow("reconciliation runs are immutable");
        await expect(
          transaction.transaction(async (savepoint) => {
            await savepoint
              .delete(reconciliationFindings)
              .where(eq(reconciliationFindings.runId, runId));
          }),
        ).rejects.toThrow("reconciliation findings are immutable");

        throw rollback;
      }),
    ).rejects.toBe(rollback);
  },
);

databaseTest(
  "Stripe export pins one completed preview revision and becomes immutable",
  async () => {
    const rollback = new Error("rollback billing export integration fixture");

    await expect(
      requireDatabase().db.transaction(async (transaction) => {
        const organizationId = crypto.randomUUID();
        const userId = crypto.randomUUID();
        const customerId = crypto.randomUUID();
        const planId = crypto.randomUUID();
        const planVersionId = crypto.randomUUID();
        const componentId = crypto.randomUUID();
        const subscriptionId = crypto.randomUUID();
        const meterId = crypto.randomUUID();
        const meterVersionId = crypto.randomUUID();
        const previewId = crypto.randomUUID();
        const seriesId = crypto.randomUUID();
        const exportId = crypto.randomUUID();
        const previewHash = "b".repeat(64);
        const lineHash = "c".repeat(64);

        await transaction.insert(users).values({
          email: `${userId}@example.com`,
          id: userId,
          name: "Export integration test",
        });
        await transaction.insert(organizations).values({
          id: organizationId,
          name: "Export integration test",
          slug: `export-${organizationId.slice(0, 12)}`,
        });
        await transaction.insert(customers).values({
          externalKey: "export-customer",
          id: customerId,
          name: "Export customer",
          organizationId,
        });
        await transaction.insert(meters).values({
          id: meterId,
          key: "export.units",
          name: "Export units",
          organizationId,
          status: "active",
        });
        await transaction.insert(meterVersions).values({
          aggregation: "sum",
          effectiveFrom: PERIOD_START,
          eventType: "export.units",
          id: meterVersionId,
          meterId,
          organizationId,
          publishedAt: PERIOD_START,
          valueProperty: "quantity",
          version: 1,
        });
        await transaction.insert(plans).values({
          id: planId,
          key: "export-plan",
          name: "Export plan",
          organizationId,
        });
        await transaction.insert(planVersions).values({
          currency: "USD",
          effectiveFrom: PERIOD_START,
          id: planVersionId,
          organizationId,
          planId,
          version: 1,
        });
        await transaction.insert(planComponents).values({
          componentKey: "platform_fee",
          componentType: "flat",
          id: componentId,
          organizationId,
          planVersionId,
          pricingDefinition: { amount: "12.34", model: "flat" },
          roundingDefinition: { minorUnitScale: 2, mode: "half_away_from_zero" },
        });
        await transaction
          .update(planVersions)
          .set({ publishedAt: PERIOD_START, status: "published" })
          .where(eq(planVersions.id, planVersionId));
        await transaction.insert(subscriptions).values({
          billingAnchor: PERIOD_START,
          customerId,
          id: subscriptionId,
          organizationId,
          planVersionId,
          startsAt: PERIOD_START,
        });
        await transaction.insert(invoicePreviews).values({
          currency: "USD",
          customerId,
          id: previewId,
          organizationId,
          periodEnd: PERIOD_END,
          periodStart: PERIOD_START,
          planVersionId,
          requestedBy: userId,
          revision: 1,
          seriesId,
          subscriptionId,
        });
        await transaction.insert(invoicePreviewLines).values({
          amountMinor: "1234",
          calculationHash: lineHash,
          componentKey: "platform_fee",
          organizationId,
          planComponentId: componentId,
          preRoundAmount: "12.34",
          previewId,
          pricingTrace: { model: "flat" },
          quantity: "1",
          roundedAmount: "12.34",
        });
        await transaction
          .update(invoicePreviews)
          .set({
            calculationHash: previewHash,
            completedAt: WATERMARK,
            status: "completed",
            subtotalMinor: "1234",
          })
          .where(eq(invoicePreviews.id, previewId));
        await transaction.insert(billingExports).values({
          id: exportId,
          organizationId,
          requestedBy: userId,
          sourcePreviewHash: previewHash,
          sourcePreviewId: seriesId,
          sourcePreviewRevision: 1,
          sourcePreviewRevisionId: previewId,
          stripeCustomerId: "cus_12345",
        });

        const generator = createDrizzleBillingExportGenerator(
          transaction as unknown as Database["db"],
          () => WATERMARK,
        );
        expect(
          await generator.generate(
            organizationId,
            exportId,
            "export-integration-request",
            new AbortController().signal,
          ),
        ).toEqual({ status: "completed" });

        const [generated] = await transaction
          .select()
          .from(billingExports)
          .where(eq(billingExports.id, exportId));
        expect(generated).toMatchObject({
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          sourcePreviewId: seriesId,
          sourcePreviewRevisionId: previewId,
          status: "completed",
        });
        expect(generated?.payload).toMatchObject({
          items: [
            {
              amount: 1234,
              currency: "usd",
              customer: "cus_12345",
              metadata: {
                meterpilot_line_hash: lineHash,
                meterpilot_preview_hash: previewHash,
                meterpilot_preview_id: seriesId,
                meterpilot_preview_revision_id: previewId,
              },
            },
          ],
          source: { previewHash, previewId: seriesId, previewRevisionId: previewId },
        });
        expect(
          await transaction
            .select({ action: auditLog.action })
            .from(auditLog)
            .where(
              and(eq(auditLog.organizationId, organizationId), eq(auditLog.resourceId, exportId)),
            ),
        ).toEqual([{ action: "billing_export.completed" }]);

        await expect(
          transaction.transaction(async (savepoint) => {
            await savepoint
              .update(billingExports)
              .set({ stripeCustomerId: "cus_changed" })
              .where(eq(billingExports.id, exportId));
          }),
        ).rejects.toThrow("billing exports are immutable");

        const lateEventId = crypto.randomUUID();
        const lateReceivedAt = new Date(WATERMARK.getTime() + 60_000);
        await transaction.insert(usageEvents).values({
          customerId,
          eventKey: "late-export-event",
          eventType: "export.units",
          id: lateEventId,
          occurredAt: PERIOD_START,
          organizationId,
          payloadHash: "d".repeat(64),
          properties: { quantity: "1" },
          receivedAt: lateReceivedAt,
          source: "quota_reservation",
          subjectKey: "export-subject",
        });
        const processor = createDrizzleUsageEventProcessor(
          transaction as unknown as Database["db"],
          () => lateReceivedAt,
        );
        expect(
          await processor.process(organizationId, lateEventId, new AbortController().signal),
        ).toMatchObject({ previewRevisionCount: 1, status: "processed" });
        expect(
          await transaction
            .select({
              adjustmentOfPreviewId: invoicePreviews.adjustmentOfPreviewId,
              revision: invoicePreviews.revision,
              status: invoicePreviews.status,
            })
            .from(invoicePreviews)
            .where(
              and(
                eq(invoicePreviews.organizationId, organizationId),
                eq(invoicePreviews.seriesId, seriesId),
                eq(invoicePreviews.revision, 2),
              ),
            ),
        ).toEqual([{ adjustmentOfPreviewId: previewId, revision: 2, status: "pending" }]);

        throw rollback;
      }),
    ).rejects.toBe(rollback);
  },
);
