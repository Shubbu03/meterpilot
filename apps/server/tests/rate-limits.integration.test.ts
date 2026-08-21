import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { checkDatabaseHealth, createDatabase, type Database } from "@meterpilot/db";
import { rateLimitWindows } from "@meterpilot/db/schema";
import { eq } from "drizzle-orm";

import { createDrizzleRateLimitRepository } from "../src/features/rate-limits/drizzle-repository";

const testDatabaseUrl = process.env.SERVER_TEST_DATABASE_URL;
const databaseTest = testDatabaseUrl ? test : test.skip;
const NOW = new Date("2026-09-01T00:00:00.000Z");
let database: Database | null = null;

beforeAll(async () => {
  if (!testDatabaseUrl) return;
  database = createDatabase(testDatabaseUrl, 20);
  await checkDatabaseHealth(database.client);
});

afterAll(async () => {
  await database?.close();
});

databaseTest("concurrent requests cannot exceed one credential window", async () => {
  if (!database) throw new Error("Rate-limit integration database was not initialized.");
  const keyHash = createHash("sha256").update(crypto.randomUUID()).digest("hex");
  const repository = createDrizzleRateLimitRepository(database.db);
  await database.db.insert(rateLimitWindows).values({
    expiresAt: new Date(NOW.getTime() - 60_000),
    keyHash,
    requestCount: 7,
    windowStart: new Date(NOW.getTime() - 120_000),
  });
  const results = await Promise.all(
    Array.from({ length: 100 }, () =>
      repository.consume({ keyHash, limit: 10, now: NOW, windowMs: 60_000 }),
    ),
  );

  expect(results.filter((result) => result.allowed)).toHaveLength(10);
  expect(results.filter((result) => !result.allowed)).toHaveLength(90);
  expect(
    await database.db
      .select({ requestCount: rateLimitWindows.requestCount })
      .from(rateLimitWindows)
      .where(eq(rateLimitWindows.keyHash, keyHash)),
  ).toEqual([{ requestCount: 10 }]);
  await database.db.delete(rateLimitWindows).where(eq(rateLimitWindows.keyHash, keyHash));
});
