import { afterAll, beforeAll, expect, test } from "bun:test";
import { checkDatabaseHealth, createDatabase, type Database } from "@meterpilot/db";
import {
  customers,
  jobs,
  organizations,
  plans,
  planVersions,
  simulationResults,
  simulationRuns,
  users,
} from "@meterpilot/db/schema";
import { and, eq } from "drizzle-orm";

import { createDrizzleSimulationRepository } from "../src/features/simulations/drizzle-repository";

const testDatabaseUrl = process.env.SERVER_TEST_DATABASE_URL;
const databaseTest = testDatabaseUrl ? test : test.skip;
const NOW = new Date("2026-10-01T00:00:00.000Z");
let database: Database | null = null;

function requireDatabase(): Database {
  if (!database) throw new Error("Simulation repository database was not initialized.");
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
  "simulation creation accepts an identical baseline and rejects archived candidates",
  async () => {
    const rollback = new Error("rollback simulation repository fixture");

    await expect(
      requireDatabase().db.transaction(async (transaction) => {
        const organizationId = crypto.randomUUID();
        const userId = crypto.randomUUID();
        const customerId = crypto.randomUUID();
        const excludedCustomerId = crypto.randomUUID();
        const planId = crypto.randomUUID();
        const baselineVersionId = crypto.randomUUID();
        const archivedVersionId = crypto.randomUUID();
        await transaction.insert(users).values({
          email: `${userId}@example.com`,
          id: userId,
          name: "Simulation repository test",
        });
        await transaction.insert(organizations).values({
          id: organizationId,
          name: "Simulation repository test",
          slug: `simulation-repository-${organizationId.slice(0, 12)}`,
        });
        await transaction.insert(customers).values([
          {
            externalKey: "simulation-customer",
            id: customerId,
            name: "Simulation customer",
            organizationId,
          },
          {
            externalKey: "excluded-simulation-customer",
            id: excludedCustomerId,
            name: "Excluded simulation customer",
            organizationId,
          },
        ]);
        await transaction.insert(plans).values({
          id: planId,
          key: "simulation-plan",
          name: "Simulation plan",
          organizationId,
        });
        await transaction.insert(planVersions).values([
          {
            currency: "USD",
            effectiveFrom: NOW,
            id: baselineVersionId,
            organizationId,
            planId,
            publishedAt: NOW,
            status: "published",
            version: 1,
          },
          {
            archivedAt: NOW,
            currency: "USD",
            effectiveFrom: NOW,
            id: archivedVersionId,
            organizationId,
            planId,
            publishedAt: NOW,
            status: "archived",
            version: 2,
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
            name: "Simulation repository test",
            slug: `simulation-repository-${organizationId.slice(0, 12)}`,
          },
        };
        const repository = createDrizzleSimulationRepository(
          transaction as unknown as Database["db"],
          () => NOW,
        );
        const common = {
          baselinePlanVersionId: baselineVersionId,
          increaseThresholdPercent: "20",
          periodEnd: "2026-10-01T00:00:00.000Z",
          periodStart: "2026-09-01T00:00:00.000Z",
        };

        expect(
          await repository.create(
            tenant,
            { ...common, candidatePlanVersionId: archivedVersionId },
            "archived-candidate",
          ),
        ).toEqual({ status: "conflict" });
        const created = await repository.create(
          tenant,
          { ...common, candidatePlanVersionId: baselineVersionId },
          "identical-baseline",
        );
        expect(created).toMatchObject({ status: "ok" });
        if (created.status !== "ok") throw new Error("Simulation setup failed.");
        expect(
          await transaction
            .select({ id: jobs.id })
            .from(jobs)
            .where(
              and(
                eq(jobs.organizationId, organizationId),
                eq(jobs.resourceId, created.simulation.id),
              ),
            ),
        ).toHaveLength(1);
        expect(
          await transaction
            .select({ id: simulationRuns.id })
            .from(simulationRuns)
            .where(eq(simulationRuns.id, created.simulation.id)),
        ).toHaveLength(1);
        await transaction.insert(simulationResults).values([
          {
            baselineAmountMinor: "100",
            candidateAmountMinor: "200",
            customerId,
            deltaMinor: "100",
            deltaPercent: "100",
            explanation: { baseline: [], candidate: [] },
            organizationId,
            simulationRunId: created.simulation.id,
            status: "included",
            warningFlags: ["increase_threshold"],
          },
          {
            customerId: excludedCustomerId,
            failureCode: "invalid_usage_value",
            organizationId,
            simulationRunId: created.simulation.id,
            status: "excluded",
          },
        ]);
        await transaction
          .update(simulationRuns)
          .set({
            calculationHash: "c".repeat(64),
            completedAt: NOW,
            status: "completed",
            summary: {
              baselineTotalMinor: "100",
              candidateTotalMinor: "200",
              customerCount: 2,
              decreasedCount: 0,
              deltaMinor: "100",
              excludedCount: 1,
              increasedCount: 1,
              increaseThresholdCount: 1,
              medianDeltaMinor: "100",
              p95DeltaMinor: "100",
              unchangedCount: 0,
            },
          })
          .where(eq(simulationRuns.id, created.simulation.id));
        expect(
          await repository.listResults(tenant, created.simulation.id, {
            limit: 50,
            outcome: "increased",
            warningFlag: "increase_threshold",
          }),
        ).toMatchObject({
          items: [{ customerKey: "simulation-customer", status: "included" }],
          nextCursor: null,
        });
        expect((await repository.report(tenant, created.simulation.id))?.results).toHaveLength(2);

        throw rollback;
      }),
    ).rejects.toBe(rollback);
  },
);
