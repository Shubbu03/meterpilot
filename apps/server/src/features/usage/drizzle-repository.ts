import type { UsageFreshness, UsageQuery } from "@meterpilot/contracts/usage";
import type { Database } from "@meterpilot/db";
import { customers, meters, meterVersions, usageBuckets } from "@meterpilot/db/schema";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";

import type { UsageRepository } from "./repository";

type FreshnessRow = Readonly<{
  maxReceivedAt: Date | null;
  updatedAt: Date | null;
}>;

function freshness(row: FreshnessRow, now: Date): UsageFreshness | null {
  if (!row.maxReceivedAt || !row.updatedAt) {
    return null;
  }

  return {
    lagSeconds: Math.max(0, Math.floor((now.getTime() - row.updatedAt.getTime()) / 1000)),
    maxReceivedAt: row.maxReceivedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function resolveUsageScope(
  database: Database["db"],
  organizationId: string,
  query: UsageQuery,
) {
  const [[customer], [meter]] = await Promise.all([
    database
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, organizationId),
          eq(customers.externalKey, query.customerKey),
        ),
      )
      .limit(1),
    database
      .select({ id: meters.id })
      .from(meters)
      .where(and(eq(meters.organizationId, organizationId), eq(meters.key, query.meterKey)))
      .limit(1),
  ]);

  return customer && meter ? { customerId: customer.id, meterId: meter.id } : null;
}

function usageRange(
  organizationId: string,
  scope: Readonly<{ customerId: string; meterId: string }>,
  query: UsageQuery,
) {
  return and(
    eq(usageBuckets.organizationId, organizationId),
    eq(usageBuckets.customerId, scope.customerId),
    eq(meterVersions.meterId, scope.meterId),
    gte(usageBuckets.bucketStart, new Date(query.from)),
    lt(usageBuckets.bucketStart, new Date(query.to)),
  );
}

export function createDrizzleUsageRepository(
  database: Database["db"],
  now: () => Date = () => new Date(),
): UsageRepository {
  return {
    async getTimeseries(organizationId, query) {
      const scope = await resolveUsageScope(database, organizationId, query);
      if (!scope) {
        return { status: "not_found" };
      }

      const rows = await database
        .select({
          bucketStart: usageBuckets.bucketStart,
          eventCount: sql<string>`sum(${usageBuckets.eventCount})::text`,
          maxReceivedAt: sql<Date>`max(${usageBuckets.maxReceivedAt})`,
          quantity: sql<string>`sum(${usageBuckets.quantity})::text`,
          updatedAt: sql<Date>`max(${usageBuckets.updatedAt})`,
        })
        .from(usageBuckets)
        .innerJoin(
          meterVersions,
          and(
            eq(meterVersions.organizationId, usageBuckets.organizationId),
            eq(meterVersions.id, usageBuckets.meterVersionId),
          ),
        )
        .where(usageRange(organizationId, scope, query))
        .groupBy(usageBuckets.bucketStart)
        .orderBy(asc(usageBuckets.bucketStart));
      const latest = rows.reduce<FreshnessRow>(
        (result, row) => ({
          maxReceivedAt:
            !result.maxReceivedAt || row.maxReceivedAt > result.maxReceivedAt
              ? row.maxReceivedAt
              : result.maxReceivedAt,
          updatedAt:
            !result.updatedAt || row.updatedAt > result.updatedAt
              ? row.updatedAt
              : result.updatedAt,
        }),
        { maxReceivedAt: null, updatedAt: null },
      );

      return {
        customerKey: query.customerKey,
        freshness: freshness(latest, now()),
        from: query.from,
        meterKey: query.meterKey,
        points: rows.map((row) => ({
          bucketStart: row.bucketStart.toISOString(),
          eventCount: row.eventCount,
          quantity: row.quantity,
        })),
        status: "ok",
        to: query.to,
      };
    },

    async getTotal(organizationId, query) {
      const scope = await resolveUsageScope(database, organizationId, query);
      if (!scope) {
        return { status: "not_found" };
      }

      const [row] = await database
        .select({
          eventCount: sql<string>`coalesce(sum(${usageBuckets.eventCount}), 0)::text`,
          maxReceivedAt: sql<Date | null>`max(${usageBuckets.maxReceivedAt})`,
          quantity: sql<string>`coalesce(sum(${usageBuckets.quantity}), 0)::text`,
          updatedAt: sql<Date | null>`max(${usageBuckets.updatedAt})`,
        })
        .from(usageBuckets)
        .innerJoin(
          meterVersions,
          and(
            eq(meterVersions.organizationId, usageBuckets.organizationId),
            eq(meterVersions.id, usageBuckets.meterVersionId),
          ),
        )
        .where(usageRange(organizationId, scope, query));
      if (!row) {
        throw new Error("Usage total aggregation returned no row.");
      }

      return {
        status: "ok",
        usage: {
          customerKey: query.customerKey,
          eventCount: row.eventCount,
          freshness: freshness(row, now()),
          from: query.from,
          meterKey: query.meterKey,
          quantity: row.quantity,
          to: query.to,
        },
      };
    },
  };
}
