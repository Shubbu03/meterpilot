import { afterAll, beforeAll, expect, test } from "bun:test";
import { checkDatabaseHealth, createDatabase, type Database } from "@meterpilot/db";
import {
  auditLog,
  billingExports,
  customers,
  invoicePreviewLines,
  invoicePreviews,
  jobs,
  meters,
  organizations,
  planComponents,
  plans,
  planVersions,
  reconciliationRuns,
  subscriptions,
  users,
} from "@meterpilot/db/schema";
import { and, eq } from "drizzle-orm";

import { createDrizzleOperationsRepository } from "../src/features/operations/drizzle-repository";
import { BillingExportNotReadyError } from "../src/features/operations/repository";

const testDatabaseUrl = process.env.SERVER_TEST_DATABASE_URL;
const databaseTest = testDatabaseUrl ? test : test.skip;
const PERIOD_START = new Date("2026-10-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-11-01T00:00:00.000Z");
const NOW = new Date("2026-11-02T00:00:00.000Z");
let database: Database | null = null;

function requireDatabase(): Database {
  if (!database) throw new Error("Operations repository database was not initialized.");
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
  "operation requests atomically create tenant-owned jobs and immutable audit evidence",
  async () => {
    const rollback = new Error("rollback operations repository fixture");

    await expect(
      requireDatabase().db.transaction(async (transaction) => {
        const organizationId = crypto.randomUUID();
        const userId = crypto.randomUUID();
        const customerId = crypto.randomUUID();
        const meterId = crypto.randomUUID();
        const planId = crypto.randomUUID();
        const planVersionId = crypto.randomUUID();
        const componentId = crypto.randomUUID();
        const subscriptionId = crypto.randomUUID();
        const previewRevisionId = crypto.randomUUID();
        const previewSeriesId = crypto.randomUUID();
        const previewHash = "a".repeat(64);

        await transaction.insert(users).values({
          email: `${userId}@example.com`,
          id: userId,
          name: "Operations repository test",
        });
        await transaction.insert(organizations).values({
          id: organizationId,
          name: "Operations repository test",
          slug: `operations-${organizationId.slice(0, 12)}`,
        });
        await transaction.insert(customers).values({
          externalKey: "operations-customer",
          id: customerId,
          name: "Operations customer",
          organizationId,
        });
        await transaction.insert(meters).values({
          id: meterId,
          key: "operations.units",
          name: "Operations units",
          organizationId,
          status: "active",
        });
        await transaction.insert(plans).values({
          id: planId,
          key: "operations-plan",
          name: "Operations plan",
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
          pricingDefinition: { amount: "5", model: "flat" },
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
          id: previewRevisionId,
          organizationId,
          periodEnd: PERIOD_END,
          periodStart: PERIOD_START,
          planVersionId,
          requestedBy: userId,
          revision: 1,
          seriesId: previewSeriesId,
          subscriptionId,
        });
        await transaction.insert(invoicePreviewLines).values({
          amountMinor: "500",
          calculationHash: "b".repeat(64),
          componentKey: "platform_fee",
          organizationId,
          planComponentId: componentId,
          preRoundAmount: "5",
          previewId: previewRevisionId,
          pricingTrace: { model: "flat" },
          quantity: "1",
          roundedAmount: "5",
        });
        await transaction
          .update(invoicePreviews)
          .set({
            calculationHash: previewHash,
            completedAt: NOW,
            status: "completed",
            subtotalMinor: "500",
          })
          .where(eq(invoicePreviews.id, previewRevisionId));

        const tenant = {
          actorUserId: userId,
          membership: {
            createdAt: PERIOD_START.toISOString(),
            role: "owner" as const,
            user: { email: `${userId}@example.com`, id: userId, name: "Owner" },
          },
          organization: {
            createdAt: PERIOD_START.toISOString(),
            defaultTimezone: "UTC",
            id: organizationId,
            name: "Operations repository test",
            slug: `operations-${organizationId.slice(0, 12)}`,
          },
        };
        const repository = createDrizzleOperationsRepository(
          transaction as unknown as Database["db"],
          () => NOW,
        );
        const reconciliation = await repository.createReconciliation(
          tenant,
          {
            customerKey: "operations-customer",
            meterKey: "operations.units",
            periodEnd: PERIOD_END.toISOString(),
            periodStart: PERIOD_START.toISOString(),
            repair: false,
          },
          "reconciliation-request",
        );
        expect(reconciliation).toMatchObject({
          run: { inputWatermark: NOW.toISOString(), repairRequested: false, status: "pending" },
          status: "ok",
        });
        if (reconciliation.status !== "ok") throw new Error("Reconciliation setup failed.");

        const replay = await repository.createReplay(
          tenant,
          {
            customerKey: "operations-customer",
            meterKey: "operations.units",
            periodEnd: PERIOD_END.toISOString(),
            periodStart: PERIOD_START.toISOString(),
          },
          "replay-request",
        );
        expect(replay).toMatchObject({
          run: { kind: "replay", repairRequested: true },
          status: "ok",
        });

        const billingExport = await repository.createExport(
          tenant,
          { previewId: previewSeriesId, stripeCustomerId: "cus_12345" },
          "export-request",
        );
        expect(billingExport).toMatchObject({
          export: {
            sourcePreviewId: previewSeriesId,
            sourcePreviewRevisionId: previewRevisionId,
            status: "pending",
          },
          status: "ok",
        });
        if (billingExport.status !== "ok") throw new Error("Export setup failed.");

        expect(
          await transaction
            .select({ resourceType: jobs.resourceType, type: jobs.type })
            .from(jobs)
            .where(eq(jobs.organizationId, organizationId)),
        ).toContainAllValues([
          { resourceType: "reconciliation_run", type: "reconciliation.run" },
          { resourceType: "reconciliation_run", type: "reconciliation.run" },
          { resourceType: "billing_export", type: "stripe_invoice_lines.export" },
        ]);
        expect(
          await transaction
            .select({ action: auditLog.action })
            .from(auditLog)
            .where(eq(auditLog.organizationId, organizationId)),
        ).toContainAllValues([
          { action: "reconciliation.requested" },
          { action: "replay.requested" },
          { action: "billing_export.requested" },
        ]);
        expect(
          await repository.findReconciliation(
            { ...tenant, organization: { ...tenant.organization, id: crypto.randomUUID() } },
            reconciliation.run.id,
          ),
        ).toBeNull();
        await expect(
          repository.exportPayload(tenant, billingExport.export.id),
        ).rejects.toBeInstanceOf(BillingExportNotReadyError);

        await expect(
          transaction.transaction(async (savepoint) => {
            await savepoint
              .update(auditLog)
              .set({ action: "tampered" })
              .where(
                and(
                  eq(auditLog.organizationId, organizationId),
                  eq(auditLog.resourceId, reconciliation.run.id),
                ),
              );
          }),
        ).rejects.toThrow("audit log entries are immutable");
        expect(
          await transaction
            .select({ id: billingExports.id })
            .from(billingExports)
            .where(eq(billingExports.id, billingExport.export.id)),
        ).toEqual([{ id: billingExport.export.id }]);
        expect(
          await transaction
            .select({ id: reconciliationRuns.id })
            .from(reconciliationRuns)
            .where(eq(reconciliationRuns.id, reconciliation.run.id)),
        ).toEqual([{ id: reconciliation.run.id }]);

        throw rollback;
      }),
    ).rejects.toBe(rollback);
  },
);
