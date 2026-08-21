import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { createDatabase, type Database } from "@meterpilot/db";
import {
  customers,
  entitlements,
  features,
  jobs,
  memberships,
  meters,
  meterVersions,
  organizations,
  quotaGrants,
  quotaReservations,
  usageEvents,
  users,
} from "@meterpilot/db/schema";
import { and, eq, sql } from "drizzle-orm";

import { createDrizzleEntitlementRepository } from "../src/features/entitlements/drizzle-repository";

const testDatabaseUrl = process.env.SERVER_TEST_DATABASE_URL;
const databaseTest = testDatabaseUrl ? test : test.skip;
const NOW = new Date("2026-08-20T05:00:00.000Z");
const PERIOD_START = new Date("2026-08-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-09-01T00:00:00.000Z");
const organizationId = crypto.randomUUID();
const userId = crypto.randomUUID();
const customerId = crypto.randomUUID();
const meterId = crypto.randomUUID();
const featureId = crypto.randomUUID();
const entitlementId = crypto.randomUUID();
let database: Database | null = null;

function requireDatabase(): Database {
  if (!database) {
    throw new Error("Server integration database was not initialized.");
  }
  return database;
}

const tenant = {
  actorUserId: userId,
  membership: {
    createdAt: NOW.toISOString(),
    role: "owner" as const,
    user: { email: `${userId}@example.com`, id: userId, name: "Reservation test" },
  },
  organization: {
    createdAt: NOW.toISOString(),
    defaultTimezone: "UTC",
    id: organizationId,
    name: "Reservation integration test",
    slug: `reservation-${organizationId.slice(0, 12)}`,
  },
};

beforeAll(async () => {
  if (!testDatabaseUrl) {
    return;
  }
  database = createDatabase(testDatabaseUrl, 20);
  const { db } = database;
  await db.insert(users).values({
    email: tenant.membership.user.email,
    id: userId,
    name: tenant.membership.user.name,
  });
  await db.insert(organizations).values({
    id: organizationId,
    name: tenant.organization.name,
    slug: tenant.organization.slug,
  });
  await db.insert(memberships).values({ organizationId, role: "owner", userId });
  await db.insert(customers).values({
    externalKey: "customer_concurrency",
    id: customerId,
    name: "Concurrency customer",
    organizationId,
  });
  await db.insert(meters).values({
    id: meterId,
    key: "api.units",
    name: "API units",
    organizationId,
    status: "active",
  });
  await db.insert(meterVersions).values({
    aggregation: "sum",
    effectiveFrom: PERIOD_START,
    eventType: "api.units",
    meterId,
    organizationId,
    publishedAt: PERIOD_START,
    valueProperty: "quantity",
    version: 1,
  });
  await db.insert(features).values({
    id: featureId,
    key: "api.units",
    meterId,
    name: "API units",
    organizationId,
  });
});

beforeEach(async () => {
  if (!database) {
    return;
  }
  const { db } = database;
  await db.delete(jobs).where(eq(jobs.organizationId, organizationId));
  await db.delete(usageEvents).where(eq(usageEvents.organizationId, organizationId));
  await db.delete(quotaReservations).where(eq(quotaReservations.organizationId, organizationId));
  await db.delete(quotaGrants).where(eq(quotaGrants.organizationId, organizationId));
  await db.delete(entitlements).where(eq(entitlements.organizationId, organizationId));
  await db.insert(entitlements).values({
    customerId,
    featureId,
    id: entitlementId,
    mode: "hard",
    organizationId,
    periodEnd: PERIOD_END,
    periodStart: PERIOD_START,
  });
  await db.insert(quotaGrants).values({
    effectiveAt: PERIOD_START,
    entitlementId,
    expiresAt: PERIOD_END,
    organizationId,
    quantity: "10",
    reason: "Concurrency allowance",
  });
});

afterAll(async () => {
  await database?.close();
});

databaseTest("one hundred concurrent requests cannot reserve more than ten units", async () => {
  const repository = createDrizzleEntitlementRepository(requireDatabase().db, () => NOW);
  const requests = Array.from({ length: 100 }, (_, index) =>
    repository.reserve(
      tenant,
      "customer_concurrency",
      {
        expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
        featureKey: "api.units",
        idempotencyKey: `concurrent-${index}`,
        quantity: "1",
      },
      `request-${index}`,
    ),
  );

  const results = await Promise.all(requests);
  expect(results.filter((result) => result.status === "ok")).toHaveLength(10);
  expect(results.filter((result) => result.status === "over_limit")).toHaveLength(90);

  const [balance] = await requireDatabase()
    .db.select({
      committed: entitlements.committedQuantity,
      reserved: entitlements.reservedQuantity,
      withinLimit: sql<boolean>`${entitlements.committedQuantity} + ${entitlements.reservedQuantity} <= 10`,
    })
    .from(entitlements)
    .where(eq(entitlements.id, entitlementId));
  expect(balance).toEqual({ committed: "0", reserved: "10", withinLimit: true });
});

databaseTest("reservation idempotency distinguishes retries from conflicting input", async () => {
  const repository = createDrizzleEntitlementRepository(requireDatabase().db, () => NOW);
  const input = {
    expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
    featureKey: "api.units",
    idempotencyKey: "same-request",
    quantity: "1",
  } as const;

  const first = await repository.reserve(tenant, "customer_concurrency", input, "request-first");
  const duplicate = await repository.reserve(
    tenant,
    "customer_concurrency",
    input,
    "request-duplicate",
  );
  const conflict = await repository.reserve(
    tenant,
    "customer_concurrency",
    { ...input, quantity: "2" },
    "request-conflict",
  );

  expect(first.status).toBe("ok");
  expect(duplicate).toMatchObject({
    reservation: { id: first.status === "ok" ? first.reservation.id : "" },
    status: "ok",
  });
  expect(conflict).toEqual({ status: "idempotency_conflict" });
});

databaseTest(
  "commit atomically converts reserved units into usage and releases the remainder",
  async () => {
    const repository = createDrizzleEntitlementRepository(requireDatabase().db, () => NOW);
    const reserved = await repository.reserve(
      tenant,
      "customer_concurrency",
      {
        expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
        featureKey: "api.units",
        idempotencyKey: "commit-request",
        quantity: "5",
      },
      "request-reserve",
    );
    if (reserved.status !== "ok") {
      throw new Error(`Reservation setup failed: ${reserved.status}`);
    }

    const committed = await repository.commitReservation(
      tenant,
      reserved.reservation.id,
      { occurredAt: NOW.toISOString(), properties: { region: "test" }, quantity: "3" },
      "request-commit",
    );
    expect(committed).toMatchObject({
      entitlement: { committedQuantity: "3", reservedQuantity: "0" },
      reservation: {
        committedQuantity: "3",
        status: "committed",
        usageEventKey: `quota_reservation:${reserved.reservation.id}`,
      },
      status: "ok",
    });

    const [event] = await requireDatabase()
      .db.select({ eventKey: usageEvents.eventKey, properties: usageEvents.properties })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.organizationId, organizationId),
          eq(usageEvents.eventKey, `quota_reservation:${reserved.reservation.id}`),
        ),
      );
    expect(event).toEqual({
      eventKey: `quota_reservation:${reserved.reservation.id}`,
      properties: {
        meterpilotReservationId: reserved.reservation.id,
        quantity: "3",
        region: "test",
      },
    });
  },
);
