import { meterVersionSchema, type Meter, type MeterVersion } from "@meterpilot/contracts/meters";
import type { Database } from "@meterpilot/db";
import { auditLog, jobs, meters, meterVersions } from "@meterpilot/db/schema";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";

import { canManageMeters } from "../organizations/authorization";
import { REBUILD_USAGE_AGGREGATES_JOB_TYPE, type MeterRepository } from "./repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MeterRow = typeof meters.$inferSelect;
type MeterVersionRow = typeof meterVersions.$inferSelect;

export class InvalidMeterCursorError extends Error {
  constructor() {
    super("The pagination cursor is invalid.");
    this.name = "InvalidMeterCursorError";
  }
}

function encodeCursor(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) {
    return undefined;
  }

  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (!UUID_PATTERN.test(decoded)) {
    throw new InvalidMeterCursorError();
  }
  return decoded;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function toMeterVersion(row: MeterVersionRow): MeterVersion {
  return meterVersionSchema.parse({
    aggregation: row.aggregation,
    createdAt: row.createdAt.toISOString(),
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    eventType: row.eventType,
    filters: row.filterDefinition,
    groupByKeys: row.groupByKeys,
    id: row.id,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    valueProperty: row.valueProperty,
    version: row.version,
  });
}

function toMeter(row: MeterRow, versionRows: readonly MeterVersionRow[]): Meter {
  return {
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    key: row.key,
    name: row.name,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
    versions: versionRows.map(toMeterVersion),
  };
}

async function writeAudit(
  database: Parameters<Parameters<Database["db"]["transaction"]>[0]>[0],
  input: Readonly<{
    action: string;
    actorUserId: string;
    organizationId: string;
    requestId: string;
    resourceId: string;
  }>,
) {
  await database.insert(auditLog).values({
    action: input.action,
    actorType: "user",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    requestId: input.requestId,
    resourceId: input.resourceId,
    resourceType: "meter",
  });
}

async function loadMeterVersions(
  database: Parameters<Parameters<Database["db"]["transaction"]>[0]>[0],
  organizationId: string,
  meterId: string,
) {
  return database
    .select()
    .from(meterVersions)
    .where(
      and(eq(meterVersions.organizationId, organizationId), eq(meterVersions.meterId, meterId)),
    )
    .orderBy(asc(meterVersions.version));
}

export function createDrizzleMeterRepository(database: Database["db"]): MeterRepository {
  return {
    async archive(tenant, meterKey, requestId) {
      if (!canManageMeters(tenant.membership.role)) {
        return { status: "forbidden" };
      }

      return database.transaction(async (transaction) => {
        const [meter] = await transaction
          .select()
          .from(meters)
          .where(and(eq(meters.organizationId, tenant.organization.id), eq(meters.key, meterKey)))
          .for("update")
          .limit(1);

        if (!meter) {
          return { status: "not_found" } as const;
        }

        const now = new Date();
        const [archived] = await transaction
          .update(meters)
          .set({ status: "archived", updatedAt: now })
          .where(and(eq(meters.organizationId, tenant.organization.id), eq(meters.id, meter.id)))
          .returning();
        if (!archived) {
          throw new Error("Archived meter was not returned.");
        }

        if (meter.status !== "archived") {
          await writeAudit(transaction, {
            action: "meter.archived",
            actorUserId: tenant.actorUserId,
            organizationId: tenant.organization.id,
            requestId,
            resourceId: meter.id,
          });
        }

        return {
          meter: toMeter(
            archived,
            await loadMeterVersions(transaction, tenant.organization.id, meter.id),
          ),
          status: "ok",
        } as const;
      });
    },

    async create(tenant, input, requestId) {
      if (!canManageMeters(tenant.membership.role)) {
        return { status: "forbidden" };
      }

      try {
        return await database.transaction(async (transaction) => {
          const [meter] = await transaction
            .insert(meters)
            .values({
              key: input.key,
              name: input.name,
              organizationId: tenant.organization.id,
            })
            .returning();
          if (!meter) {
            throw new Error("Meter insertion returned no row.");
          }

          await writeAudit(transaction, {
            action: "meter.created",
            actorUserId: tenant.actorUserId,
            organizationId: tenant.organization.id,
            requestId,
            resourceId: meter.id,
          });

          return { meter: toMeter(meter, []), status: "ok" } as const;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { status: "conflict" };
        }
        throw error;
      }
    },

    async createVersion(tenant, meterKey, input, requestId) {
      if (!canManageMeters(tenant.membership.role)) {
        return { status: "forbidden" };
      }

      try {
        return await database.transaction(async (transaction) => {
          const [meter] = await transaction
            .select()
            .from(meters)
            .where(and(eq(meters.organizationId, tenant.organization.id), eq(meters.key, meterKey)))
            .for("update")
            .limit(1);

          if (!meter) {
            return { status: "not_found" } as const;
          }
          if (meter.status === "archived") {
            return { status: "conflict" } as const;
          }

          const [latest] = await transaction
            .select({ version: meterVersions.version })
            .from(meterVersions)
            .where(
              and(
                eq(meterVersions.organizationId, tenant.organization.id),
                eq(meterVersions.meterId, meter.id),
              ),
            )
            .orderBy(desc(meterVersions.version))
            .limit(1);
          const [version] = await transaction
            .insert(meterVersions)
            .values({
              aggregation: input.aggregation,
              effectiveFrom: new Date(input.effectiveFrom),
              effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
              eventType: input.eventType,
              filterDefinition: input.filters,
              groupByKeys: input.groupByKeys,
              meterId: meter.id,
              organizationId: tenant.organization.id,
              valueProperty: input.valueProperty,
              version: (latest?.version ?? 0) + 1,
            })
            .returning();
          if (!version) {
            throw new Error("Meter version insertion returned no row.");
          }

          await writeAudit(transaction, {
            action: "meter.version_created",
            actorUserId: tenant.actorUserId,
            organizationId: tenant.organization.id,
            requestId,
            resourceId: version.id,
          });

          return { meterVersion: toMeterVersion(version), status: "ok" } as const;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { status: "conflict" };
        }
        throw error;
      }
    },

    async list(tenant, page) {
      const cursor = decodeCursor(page.cursor);
      const meterRows = await database
        .select()
        .from(meters)
        .where(
          and(
            eq(meters.organizationId, tenant.organization.id),
            cursor ? gt(meters.id, cursor) : undefined,
          ),
        )
        .orderBy(asc(meters.id))
        .limit(page.limit + 1);
      const hasNextPage = meterRows.length > page.limit;
      const visibleMeters = meterRows.slice(0, page.limit);
      const meterIds = visibleMeters.map((meter) => meter.id);
      const versionRows =
        meterIds.length === 0
          ? []
          : await database
              .select()
              .from(meterVersions)
              .where(
                and(
                  eq(meterVersions.organizationId, tenant.organization.id),
                  inArray(meterVersions.meterId, meterIds),
                ),
              )
              .orderBy(asc(meterVersions.meterId), asc(meterVersions.version));
      const lastMeter = visibleMeters.at(-1);

      return {
        items: visibleMeters.map((meter) =>
          toMeter(
            meter,
            versionRows.filter((version) => version.meterId === meter.id),
          ),
        ),
        nextCursor: hasNextPage && lastMeter ? encodeCursor(lastMeter.id) : null,
      };
    },

    async publish(tenant, meterKey, versionNumber, requestId) {
      if (!canManageMeters(tenant.membership.role)) {
        return { status: "forbidden" };
      }

      return database.transaction(async (transaction) => {
        const [selected] = await transaction
          .select({ meter: meters, version: meterVersions })
          .from(meters)
          .innerJoin(
            meterVersions,
            and(
              eq(meterVersions.organizationId, meters.organizationId),
              eq(meterVersions.meterId, meters.id),
            ),
          )
          .where(
            and(
              eq(meters.organizationId, tenant.organization.id),
              eq(meters.key, meterKey),
              eq(meterVersions.version, versionNumber),
            ),
          )
          .for("update")
          .limit(1);

        if (!selected) {
          return { status: "not_found" } as const;
        }
        if (selected.meter.status === "archived") {
          return { status: "conflict" } as const;
        }

        const [overlap] = await transaction
          .select({ id: meterVersions.id })
          .from(meterVersions)
          .where(
            and(
              eq(meterVersions.organizationId, tenant.organization.id),
              eq(meterVersions.meterId, selected.meter.id),
              ne(meterVersions.id, selected.version.id),
              isNotNull(meterVersions.publishedAt),
              selected.version.effectiveTo
                ? lt(meterVersions.effectiveFrom, selected.version.effectiveTo)
                : undefined,
              or(
                isNull(meterVersions.effectiveTo),
                gt(meterVersions.effectiveTo, selected.version.effectiveFrom),
              ),
            ),
          )
          .limit(1);
        if (overlap) {
          return { status: "conflict" } as const;
        }

        const now = new Date();
        let published = selected.version;
        if (!selected.version.publishedAt) {
          const [updated] = await transaction
            .update(meterVersions)
            .set({ publishedAt: now })
            .where(
              and(
                eq(meterVersions.organizationId, tenant.organization.id),
                eq(meterVersions.id, selected.version.id),
              ),
            )
            .returning();
          if (!updated) {
            throw new Error("Published meter version was not returned.");
          }
          published = updated;

          await transaction
            .update(meters)
            .set({ status: "active", updatedAt: now })
            .where(
              and(
                eq(meters.organizationId, tenant.organization.id),
                eq(meters.id, selected.meter.id),
              ),
            );
          await writeAudit(transaction, {
            action: "meter.version_published",
            actorUserId: tenant.actorUserId,
            organizationId: tenant.organization.id,
            requestId,
            resourceId: published.id,
          });
        }

        const [createdJob] = await transaction
          .insert(jobs)
          .values({
            organizationId: tenant.organization.id,
            payload: {
              effectiveFrom: published.effectiveFrom.toISOString(),
              effectiveTo: published.effectiveTo?.toISOString() ?? null,
              meterVersionId: published.id,
              requestId,
            },
            resourceId: published.id,
            resourceType: "meter_version",
            type: REBUILD_USAGE_AGGREGATES_JOB_TYPE,
          })
          .onConflictDoNothing({
            target: [jobs.organizationId, jobs.type, jobs.resourceType, jobs.resourceId],
          })
          .returning({ id: jobs.id });
        const [existingJob] = createdJob
          ? [createdJob]
          : await transaction
              .select({ id: jobs.id })
              .from(jobs)
              .where(
                and(
                  eq(jobs.organizationId, tenant.organization.id),
                  eq(jobs.type, REBUILD_USAGE_AGGREGATES_JOB_TYPE),
                  eq(jobs.resourceType, "meter_version"),
                  eq(jobs.resourceId, published.id),
                ),
              )
              .limit(1);
        if (!existingJob) {
          throw new Error("Published meter rebuild job was not available.");
        }

        return {
          meterVersion: toMeterVersion(published),
          rebuildJobId: existingJob.id,
          status: "ok",
        } as const;
      });
    },
  };
}
