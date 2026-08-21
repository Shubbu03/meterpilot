import { afterAll, beforeAll, expect, test } from "bun:test";
import { checkDatabaseHealth, createDatabase, type Database } from "@meterpilot/db";
import {
  customers,
  features,
  meters,
  meterVersions,
  organizations,
  planComponents,
  plans,
  planVersions,
  simulationResults,
  simulationRuns,
  subscriptions,
  usageEvents,
  users,
} from "@meterpilot/db/schema";
import { eq } from "drizzle-orm";

import { createDrizzleSimulationRunner } from "../src/jobs/drizzle-simulation-runner";

const testDatabaseUrl = process.env.WORKER_TEST_DATABASE_URL;
const databaseTest = testDatabaseUrl ? test : test.skip;
const NOW = new Date("2026-10-01T00:00:00.000Z");
let database: Database | null = null;

function requireDatabase(): Database {
  if (!database) throw new Error("Simulation integration database was not initialized.");
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
  "baseline-versus-baseline is deterministic and cannot mutate subscriptions",
  async () => {
    const rollback = new Error("rollback simulation integration fixture");

    await expect(
      requireDatabase().db.transaction(async (transaction) => {
        const organizationId = crypto.randomUUID();
        const userId = crypto.randomUUID();
        const customerId = crypto.randomUUID();
        const invalidCustomerId = crypto.randomUUID();
        const meterId = crypto.randomUUID();
        const featureId = crypto.randomUUID();
        const planId = crypto.randomUUID();
        const planVersionId = crypto.randomUUID();
        const simulationId = crypto.randomUUID();
        const subscriptionId = crypto.randomUUID();
        const validEventId = crypto.randomUUID();
        await transaction.insert(users).values({
          email: `${userId}@example.com`,
          id: userId,
          name: "Simulation integration test",
        });
        await transaction.insert(organizations).values({
          id: organizationId,
          name: "Simulation integration test",
          slug: `simulation-${organizationId.slice(0, 12)}`,
        });
        await transaction.insert(customers).values([
          {
            externalKey: "simulation-customer",
            id: customerId,
            name: "Simulation customer",
            organizationId,
          },
          {
            externalKey: "invalid-simulation-customer",
            id: invalidCustomerId,
            name: "Invalid simulation customer",
            organizationId,
          },
        ]);
        await transaction.insert(meters).values({
          id: meterId,
          key: "simulation.units",
          name: "Simulation units",
          organizationId,
          status: "active",
        });
        await transaction.insert(meterVersions).values({
          aggregation: "sum",
          effectiveFrom: NOW,
          eventType: "simulation.units",
          meterId,
          organizationId,
          publishedAt: NOW,
          valueProperty: "quantity",
          version: 1,
        });
        await transaction.insert(features).values({
          id: featureId,
          key: "simulation.units",
          meterId,
          name: "Simulation units",
          organizationId,
        });
        await transaction.insert(plans).values({
          id: planId,
          key: "simulation-plan",
          name: "Simulation plan",
          organizationId,
        });
        await transaction.insert(planVersions).values({
          currency: "USD",
          effectiveFrom: NOW,
          id: planVersionId,
          organizationId,
          planId,
          publishedAt: null,
          status: "draft",
          version: 1,
        });
        await transaction.insert(planComponents).values({
          componentKey: "base",
          componentType: "per_unit",
          featureId,
          id: crypto.randomUUID(),
          organizationId,
          planVersionId,
          pricingDefinition: { model: "per_unit", unitRate: "1" },
          roundingDefinition: { minorUnitScale: 2, mode: "half_away_from_zero" },
        });
        await transaction
          .update(planVersions)
          .set({ publishedAt: NOW, status: "published" })
          .where(eq(planVersions.id, planVersionId));
        await transaction.insert(subscriptions).values({
          billingAnchor: NOW,
          customerId,
          id: subscriptionId,
          organizationId,
          planVersionId,
          startsAt: NOW,
        });
        await transaction.insert(usageEvents).values([
          {
            customerId,
            eventKey: `valid-${customerId}`,
            eventType: "simulation.units",
            id: validEventId,
            occurredAt: new Date("2026-10-01T00:00:00.000Z"),
            organizationId,
            payloadHash: "a".repeat(64),
            properties: { quantity: "3" },
            receivedAt: NOW,
            source: "quota_reservation",
            subjectKey: "valid-subject",
          },
          {
            customerId: invalidCustomerId,
            eventKey: `invalid-${invalidCustomerId}`,
            eventType: "simulation.units",
            occurredAt: new Date("2026-10-01T00:00:00.000Z"),
            organizationId,
            payloadHash: "b".repeat(64),
            properties: { quantity: "not-a-decimal" },
            receivedAt: NOW,
            source: "quota_reservation",
            subjectKey: "invalid-subject",
          },
        ]);
        await transaction.insert(usageEvents).values({
          correctionKind: "replace",
          correctionOfEventId: validEventId,
          customerId,
          eventKey: `future-correction-${customerId}`,
          eventType: "simulation.units",
          occurredAt: NOW,
          organizationId,
          payloadHash: "c".repeat(64),
          properties: { quantity: "100" },
          receivedAt: new Date("2026-10-01T00:00:01.000Z"),
          source: "quota_reservation",
          subjectKey: "valid-subject",
        });
        await transaction.insert(simulationRuns).values({
          baselinePlanVersionId: planVersionId,
          candidatePlanVersionId: planVersionId,
          customerIds: [customerId, invalidCustomerId],
          id: simulationId,
          inputWatermark: NOW,
          organizationId,
          periodEnd: new Date("2026-11-01T00:00:00.000Z"),
          periodStart: NOW,
          requestedBy: userId,
        });

        const beforeSubscriptions = await transaction
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.id, subscriptionId));
        const runner = createDrizzleSimulationRunner(
          transaction as unknown as Database["db"],
          () => new Date("2026-10-01T00:00:01.000Z"),
        );
        expect(
          await runner.run(
            organizationId,
            simulationId,
            "simulation-integration-request",
            new AbortController().signal,
          ),
        ).toEqual({ status: "completed" });

        const [run] = await transaction
          .select()
          .from(simulationRuns)
          .where(eq(simulationRuns.id, simulationId));
        const resultRows = await transaction
          .select()
          .from(simulationResults)
          .where(eq(simulationResults.simulationRunId, simulationId));
        expect(run).toMatchObject({
          calculationHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          status: "completed",
          summary: {
            baselineTotalMinor: "300",
            candidateTotalMinor: "300",
            deltaMinor: "0",
            excludedCount: 1,
            unchangedCount: 1,
          },
        });
        expect(resultRows.find((result) => result.customerId === customerId)).toMatchObject({
          baselineAmountMinor: "300",
          candidateAmountMinor: "300",
          deltaMinor: "0",
          deltaPercent: "0",
          failureCode: null,
          status: "included",
          warningFlags: [],
        });
        expect(resultRows.find((result) => result.customerId === invalidCustomerId)).toMatchObject({
          baselineAmountMinor: null,
          candidateAmountMinor: null,
          deltaMinor: null,
          deltaPercent: null,
          failureCode: "invalid_usage_value",
          status: "excluded",
          warningFlags: [],
        });
        expect(
          await transaction
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.id, subscriptionId)),
        ).toEqual(beforeSubscriptions);

        throw rollback;
      }),
    ).rejects.toBe(rollback);
  },
);
