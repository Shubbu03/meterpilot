import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { checkDatabaseHealth, createDatabase, type Database } from "@meterpilot/db";
import { jobs, organizations } from "@meterpilot/db/schema";
import { eq } from "drizzle-orm";

import { createDrizzleJobRepository } from "../src/jobs/drizzle-repository";

const testDatabaseUrl = process.env.WORKER_TEST_DATABASE_URL;
const databaseTest = testDatabaseUrl ? test : test.skip;
const organizationId = crypto.randomUUID();
const organizationSlug = `worker-${organizationId.slice(0, 12)}`;
let database: Database | null = null;

function requireDatabase(): Database {
  if (!database) {
    throw new Error("Worker integration database was not initialized.");
  }
  return database;
}

beforeAll(async () => {
  if (!testDatabaseUrl) {
    return;
  }
  database = createDatabase(testDatabaseUrl);
  await checkDatabaseHealth(database.client);
  await database.db.insert(organizations).values({
    id: organizationId,
    name: "Worker integration test",
    slug: organizationSlug,
  });
});

beforeEach(async () => {
  if (database) {
    await database.db.delete(jobs).where(eq(jobs.organizationId, organizationId));
  }
});

afterAll(async () => {
  if (!database) {
    return;
  }
  await database.db.delete(jobs).where(eq(jobs.organizationId, organizationId));
  await database.db.delete(organizations).where(eq(organizations.id, organizationId));
  await database.close();
});

databaseTest("competing workers claim different rows without blocking", async () => {
  const { db } = requireDatabase();
  await db.insert(jobs).values([
    {
      organizationId,
      payload: {},
      resourceId: crypto.randomUUID(),
      resourceType: "integration_test",
      type: "test.job",
    },
    {
      organizationId,
      payload: {},
      resourceId: crypto.randomUUID(),
      resourceType: "integration_test",
      type: "test.job",
    },
  ]);
  const repository = createDrizzleJobRepository(db);
  const now = new Date();
  const [left, right] = await Promise.all([
    repository.claim({ leaseDurationMs: 30_000, limit: 1, now, workerId: "worker-left" }),
    repository.claim({ leaseDurationMs: 30_000, limit: 1, now, workerId: "worker-right" }),
  ]);

  expect(left).toHaveLength(1);
  expect(right).toHaveLength(1);
  expect(left[0]?.id).not.toBe(right[0]?.id);
});

databaseTest("an expired lease is reclaimed and rejects its former owner", async () => {
  const { db } = requireDatabase();
  const [inserted] = await db
    .insert(jobs)
    .values({
      organizationId,
      payload: {},
      resourceId: crypto.randomUUID(),
      resourceType: "integration_test",
      type: "test.job",
    })
    .returning({ id: jobs.id });
  if (!inserted) {
    throw new Error("Integration job was not created.");
  }

  const repository = createDrizzleJobRepository(db);
  const firstClaimAt = new Date();
  const [firstClaim] = await repository.claim({
    leaseDurationMs: 1_000,
    limit: 1,
    now: firstClaimAt,
    workerId: "worker-old",
  });
  const secondClaimAt = new Date(firstClaimAt.getTime() + 1_001);
  const [secondClaim] = await repository.claim({
    leaseDurationMs: 30_000,
    limit: 1,
    now: secondClaimAt,
    workerId: "worker-new",
  });

  expect(firstClaim?.id).toBe(inserted.id);
  expect(secondClaim).toMatchObject({ attemptCount: 2, id: inserted.id });
  expect(
    await repository.complete({ jobId: inserted.id, now: secondClaimAt, workerId: "worker-old" }),
  ).toBe("lease_lost");
  expect(
    await repository.complete({ jobId: inserted.id, now: secondClaimAt, workerId: "worker-new" }),
  ).toBe("updated");
});
