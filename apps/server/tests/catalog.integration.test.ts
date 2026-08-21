import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { createDatabase, type Database } from "@meterpilot/db";
import {
  customers,
  entitlements,
  features,
  jobs,
  memberships,
  planComponents,
  plans,
  planVersions,
  quotaGrants,
  subscriptions,
  organizations,
  users,
} from "@meterpilot/db/schema";
import { eq } from "drizzle-orm";

import { createDrizzleCatalogRepository } from "../src/features/catalog/drizzle-repository";

const testDatabaseUrl = process.env.SERVER_TEST_DATABASE_URL;
const databaseTest = testDatabaseUrl ? test : test.skip;
const NOW = new Date("2026-09-01T00:00:00.000Z");
const organizationId = crypto.randomUUID();
const userId = crypto.randomUUID();
const customerId = crypto.randomUUID();
const featureId = crypto.randomUUID();
let database: Database | null = null;

function requireDatabase(): Database {
  if (!database) {
    throw new Error("Catalog integration database was not initialized.");
  }
  return database;
}

const tenant = {
  actorUserId: userId,
  membership: {
    createdAt: NOW.toISOString(),
    role: "owner" as const,
    user: { email: `${userId}@example.com`, id: userId, name: "Catalog test" },
  },
  organization: {
    createdAt: NOW.toISOString(),
    defaultTimezone: "UTC",
    id: organizationId,
    name: "Catalog integration test",
    slug: `catalog-${organizationId.slice(0, 12)}`,
  },
};

beforeAll(async () => {
  if (!testDatabaseUrl) {
    return;
  }
  database = createDatabase(testDatabaseUrl, 10);
  const { db } = database;
  await db
    .insert(users)
    .values({ email: tenant.membership.user.email, id: userId, name: "Catalog" });
  await db.insert(organizations).values({
    id: organizationId,
    name: tenant.organization.name,
    slug: tenant.organization.slug,
  });
  await db.insert(memberships).values({ organizationId, role: "owner", userId });
  await db.insert(customers).values({
    externalKey: "acme",
    id: customerId,
    name: "Acme",
    organizationId,
  });
  await db.insert(features).values({
    id: featureId,
    key: "api.calls",
    name: "API calls",
    organizationId,
  });
});

beforeEach(async () => {
  if (!database) {
    return;
  }
  const { db } = database;
  await db.delete(jobs).where(eq(jobs.organizationId, organizationId));
  await db.delete(quotaGrants).where(eq(quotaGrants.organizationId, organizationId));
  await db.delete(entitlements).where(eq(entitlements.organizationId, organizationId));
  await db.delete(subscriptions).where(eq(subscriptions.organizationId, organizationId));
  await db.delete(planComponents).where(eq(planComponents.organizationId, organizationId));
  await db.delete(planVersions).where(eq(planVersions.organizationId, organizationId));
  await db.delete(plans).where(eq(plans.organizationId, organizationId));
});

afterAll(async () => {
  await database?.close();
});

async function createPublishedPlan() {
  const repository = createDrizzleCatalogRepository(requireDatabase().db, () => NOW);
  expect(
    await repository.createPlan(tenant, { key: "starter", name: "Starter" }, "plan-create"),
  ).toMatchObject({ status: "ok" });
  expect(
    await repository.createVersion(
      tenant,
      "starter",
      {
        components: [
          {
            billingInterval: "month",
            componentKey: "base",
            entitlement: { enabled: true, mode: "hard", quantity: "100" },
            featureKey: "api.calls",
            price: { amount: "9.99", model: "flat" },
            rounding: { minorUnitScale: 2, mode: "half_away_from_zero" },
          },
        ],
        currency: "USD",
        effectiveFrom: NOW.toISOString(),
      },
      "version-create",
    ),
  ).toMatchObject({ status: "ok" });
  expect(await repository.publishVersion(tenant, "starter", 1, "version-publish")).toMatchObject({
    status: "ok",
  });
  return repository;
}

databaseTest("concurrent subscription creation cannot overlap a commercial slot", async () => {
  const repository = await createPublishedPlan();
  const input = {
    billingAnchor: NOW.toISOString(),
    commercialSlot: "default",
    customerKey: "acme",
    endsAt: null,
    planKey: "starter",
    planVersion: 1,
    startsAt: NOW.toISOString(),
  } as const;

  const results = await Promise.all([
    repository.createSubscription(tenant, input, "subscription-left"),
    repository.createSubscription(tenant, input, "subscription-right"),
  ]);

  expect(results.filter((result) => result.status === "ok")).toHaveLength(1);
  expect(results.filter((result) => result.status === "conflict")).toHaveLength(1);
  expect(
    await requireDatabase()
      .db.select({ id: entitlements.id, subscriptionId: entitlements.subscriptionId })
      .from(entitlements)
      .where(eq(entitlements.organizationId, organizationId)),
  ).toHaveLength(1);
  expect(
    await requireDatabase()
      .db.select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.organizationId, organizationId)),
  ).toHaveLength(1);
});

databaseTest("published versions and their components are database-immutable", async () => {
  await createPublishedPlan();
  const { db } = requireDatabase();
  const [published] = await db
    .select({ id: planVersions.id })
    .from(planVersions)
    .where(eq(planVersions.organizationId, organizationId));
  if (!published) {
    throw new Error("Published version setup failed.");
  }

  await expect(
    db.update(planVersions).set({ currency: "EUR" }).where(eq(planVersions.id, published.id)),
  ).rejects.toThrow();
  await expect(
    db
      .update(planComponents)
      .set({ pricingDefinition: { amount: "1", model: "flat" } })
      .where(eq(planComponents.planVersionId, published.id)),
  ).rejects.toThrow();
});
