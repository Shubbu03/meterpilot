import {
  auditLogEntrySchema,
  billingExportSchema,
  reconciliationFindingSchema,
  reconciliationRunSchema,
  type BillingExport,
  type BillingExportListQuery,
  type ReconciliationRun,
  type ReconciliationRunListQuery,
} from "@meterpilot/contracts/operations";
import type { Database } from "@meterpilot/db";
import {
  auditLog,
  billingExports,
  customers,
  invoicePreviews,
  jobs,
  meters,
  reconciliationFindings,
  reconciliationRunJob,
  reconciliationRuns,
  stripeInvoiceLineExportJob,
} from "@meterpilot/db/schema";
import { and, asc, desc, eq, gt, isNull, lt, or } from "drizzle-orm";

import { canManageCatalog, canManageMeters } from "../organizations/authorization";
import { BillingExportNotReadyError, InvalidOperationsCursorError } from "./repository";
import type { OperationsRepository } from "./repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function encodeCursor(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}

function decodeCursor(cursor?: string): string | undefined {
  if (!cursor) return undefined;
  const id = Buffer.from(cursor, "base64url").toString("utf8");
  if (!UUID_PATTERN.test(id)) throw new InvalidOperationsCursorError();
  return id;
}

function encodeTimedCursor(row: Readonly<{ createdAt: Date; id: string }>): string {
  return Buffer.from(
    JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id }),
  ).toString("base64url");
}

function decodeTimedCursor(cursor?: string): Readonly<{ createdAt: Date; id: string }> | undefined {
  if (!cursor) return undefined;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (Buffer.from(decoded).toString("base64url") !== cursor) {
      throw new InvalidOperationsCursorError();
    }
    const value = JSON.parse(decoded) as unknown;
    if (
      typeof value !== "object" ||
      value === null ||
      !("createdAt" in value) ||
      !("id" in value) ||
      typeof value.createdAt !== "string" ||
      typeof value.id !== "string" ||
      !UUID_PATTERN.test(value.id)
    ) {
      throw new InvalidOperationsCursorError();
    }
    const createdAt = new Date(value.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== value.createdAt) {
      throw new InvalidOperationsCursorError();
    }
    return { createdAt, id: value.id };
  } catch (error) {
    if (error instanceof InvalidOperationsCursorError) throw error;
    throw new InvalidOperationsCursorError();
  }
}

function toRun(
  row: typeof reconciliationRuns.$inferSelect,
  customerKey: string,
  meterKey: string,
): ReconciliationRun {
  return reconciliationRunSchema.parse({
    afterHash: row.afterHash,
    beforeHash: row.beforeHash,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    customerKey,
    failureCode: row.failureCode,
    id: row.id,
    inputWatermark: row.inputWatermark.toISOString(),
    kind: row.kind,
    meterKey,
    periodEnd: row.periodEnd.toISOString(),
    periodStart: row.periodStart.toISOString(),
    repairRequested: row.repairRequested,
    status: row.status,
    summary: row.summary,
  });
}

function toExport(row: typeof billingExports.$inferSelect): BillingExport {
  return billingExportSchema.parse({
    completedAt: row.completedAt?.toISOString() ?? null,
    contentHash: row.contentHash,
    createdAt: row.createdAt.toISOString(),
    failureCode: row.failureCode,
    id: row.id,
    sourcePreviewHash: row.sourcePreviewHash,
    sourcePreviewId: row.sourcePreviewId,
    sourcePreviewRevision: row.sourcePreviewRevision,
    sourcePreviewRevisionId: row.sourcePreviewRevisionId,
    status: row.status,
    stripeCustomerId: row.stripeCustomerId,
  });
}

export function createDrizzleOperationsRepository(
  database: Database["db"],
  now: () => Date = () => new Date(),
): OperationsRepository {
  async function findRun(organizationId: string, runId: string) {
    const [row] = await database
      .select({ customerKey: customers.externalKey, meterKey: meters.key, run: reconciliationRuns })
      .from(reconciliationRuns)
      .innerJoin(
        customers,
        and(
          eq(customers.organizationId, reconciliationRuns.organizationId),
          eq(customers.id, reconciliationRuns.customerId),
        ),
      )
      .innerJoin(
        meters,
        and(
          eq(meters.organizationId, reconciliationRuns.organizationId),
          eq(meters.id, reconciliationRuns.meterId),
        ),
      )
      .where(
        and(
          eq(reconciliationRuns.organizationId, organizationId),
          eq(reconciliationRuns.id, runId),
        ),
      )
      .limit(1);
    return row ? toRun(row.run, row.customerKey, row.meterKey) : null;
  }

  async function createRun(
    tenant: Parameters<OperationsRepository["createReconciliation"]>[0],
    input: Parameters<OperationsRepository["createReconciliation"]>[1],
    kind: "reconciliation" | "replay",
    requestId: string,
  ) {
    if (!canManageMeters(tenant.membership.role)) return { status: "forbidden" } as const;
    return database.transaction(async (transaction) => {
      const [context] = await transaction
        .select({
          customerId: customers.id,
          customerKey: customers.externalKey,
          meterId: meters.id,
          meterKey: meters.key,
        })
        .from(customers)
        .innerJoin(
          meters,
          and(eq(meters.organizationId, customers.organizationId), eq(meters.key, input.meterKey)),
        )
        .where(
          and(
            eq(customers.organizationId, tenant.organization.id),
            eq(customers.externalKey, input.customerKey),
            isNull(customers.archivedAt),
            eq(meters.status, "active"),
          ),
        )
        .limit(1);
      if (!context) return { status: "not_found" } as const;

      const createdAt = now();
      const repairRequested = kind === "replay" || ("repair" in input && input.repair);
      const [created] = await transaction
        .insert(reconciliationRuns)
        .values({
          createdAt,
          customerId: context.customerId,
          inputWatermark: createdAt,
          kind,
          meterId: context.meterId,
          organizationId: tenant.organization.id,
          periodEnd: new Date(input.periodEnd),
          periodStart: new Date(input.periodStart),
          repairRequested,
          requestedBy: tenant.actorUserId,
        })
        .returning();
      if (!created) throw new Error("Reconciliation insertion returned no row.");
      const [job] = await transaction
        .insert(jobs)
        .values(
          reconciliationRunJob({
            createdAt,
            organizationId: tenant.organization.id,
            requestId,
            runId: created.id,
          }),
        )
        .returning({ id: jobs.id });
      if (!job) throw new Error("Reconciliation job insertion returned no row.");
      await transaction.insert(auditLog).values({
        action: kind === "replay" ? "replay.requested" : "reconciliation.requested",
        actorType: "user",
        actorUserId: tenant.actorUserId,
        metadata: {
          customerKey: context.customerKey,
          meterKey: context.meterKey,
          periodEnd: input.periodEnd,
          periodStart: input.periodStart,
          repairRequested,
        },
        occurredAt: createdAt,
        organizationId: tenant.organization.id,
        requestId,
        resourceId: created.id,
        resourceType: "reconciliation_run",
      });
      return {
        jobId: job.id,
        run: toRun(created, context.customerKey, context.meterKey),
        status: "ok",
      } as const;
    });
  }

  return Object.freeze({
    async createExport(tenant, input, requestId) {
      if (!canManageCatalog(tenant.membership.role)) return { status: "forbidden" };
      return database.transaction(async (transaction) => {
        const [preview] = await transaction
          .select()
          .from(invoicePreviews)
          .where(
            and(
              eq(invoicePreviews.organizationId, tenant.organization.id),
              eq(invoicePreviews.seriesId, input.previewId),
            ),
          )
          .orderBy(desc(invoicePreviews.revision))
          .limit(1);
        if (!preview) return { status: "not_found" } as const;
        if (preview.status !== "completed" || !preview.calculationHash) {
          return { status: "conflict" } as const;
        }
        const createdAt = now();
        const [created] = await transaction
          .insert(billingExports)
          .values({
            createdAt,
            organizationId: tenant.organization.id,
            requestedBy: tenant.actorUserId,
            sourcePreviewHash: preview.calculationHash,
            sourcePreviewId: preview.seriesId,
            sourcePreviewRevision: preview.revision,
            sourcePreviewRevisionId: preview.id,
            stripeCustomerId: input.stripeCustomerId,
          })
          .returning();
        if (!created) throw new Error("Billing export insertion returned no row.");
        const [job] = await transaction
          .insert(jobs)
          .values(
            stripeInvoiceLineExportJob({
              createdAt,
              exportId: created.id,
              organizationId: tenant.organization.id,
              requestId,
            }),
          )
          .returning({ id: jobs.id });
        if (!job) throw new Error("Billing export job insertion returned no row.");
        await transaction.insert(auditLog).values({
          action: "billing_export.requested",
          actorType: "user",
          actorUserId: tenant.actorUserId,
          metadata: {
            sourcePreviewHash: preview.calculationHash,
            sourcePreviewId: preview.seriesId,
            sourcePreviewRevision: preview.revision,
          },
          occurredAt: createdAt,
          organizationId: tenant.organization.id,
          requestId,
          resourceId: created.id,
          resourceType: "billing_export",
        });
        return { export: toExport(created), jobId: job.id, status: "ok" } as const;
      });
    },

    createReconciliation(tenant, input, requestId) {
      return createRun(tenant, input, "reconciliation", requestId);
    },

    createReplay(tenant, input, requestId) {
      return createRun(tenant, { ...input, repair: true }, "replay", requestId);
    },

    async exportPayload(tenant, exportId) {
      const [row] = await database
        .select({ payload: billingExports.payload, status: billingExports.status })
        .from(billingExports)
        .where(
          and(
            eq(billingExports.organizationId, tenant.organization.id),
            eq(billingExports.id, exportId),
          ),
        )
        .limit(1);
      if (!row) return null;
      if (row.status !== "completed" || !row.payload) throw new BillingExportNotReadyError();
      return row.payload;
    },

    async findExport(tenant, exportId) {
      const [row] = await database
        .select()
        .from(billingExports)
        .where(
          and(
            eq(billingExports.organizationId, tenant.organization.id),
            eq(billingExports.id, exportId),
          ),
        )
        .limit(1);
      return row ? toExport(row) : null;
    },

    findReconciliation(tenant, runId) {
      return findRun(tenant.organization.id, runId);
    },

    async listExports(tenant, query: BillingExportListQuery) {
      const cursor = decodeTimedCursor(query.cursor);
      const rows = await database
        .select()
        .from(billingExports)
        .where(
          and(
            eq(billingExports.organizationId, tenant.organization.id),
            query.sourcePreviewId
              ? eq(billingExports.sourcePreviewId, query.sourcePreviewId)
              : undefined,
            query.status ? eq(billingExports.status, query.status) : undefined,
            query.stripeCustomerId
              ? eq(billingExports.stripeCustomerId, query.stripeCustomerId)
              : undefined,
            cursor
              ? or(
                  lt(billingExports.createdAt, cursor.createdAt),
                  and(
                    eq(billingExports.createdAt, cursor.createdAt),
                    lt(billingExports.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(billingExports.createdAt), desc(billingExports.id))
        .limit(query.limit + 1);
      const hasNext = rows.length > query.limit;
      const selected = rows.slice(0, query.limit);
      const last = selected.at(-1);
      return {
        items: selected.map(toExport),
        nextCursor: hasNext && last ? encodeTimedCursor(last) : null,
      };
    },

    async listReconciliations(tenant, query: ReconciliationRunListQuery) {
      const cursor = decodeTimedCursor(query.cursor);
      const rows = await database
        .select({
          customerKey: customers.externalKey,
          meterKey: meters.key,
          run: reconciliationRuns,
        })
        .from(reconciliationRuns)
        .innerJoin(
          customers,
          and(
            eq(customers.organizationId, reconciliationRuns.organizationId),
            eq(customers.id, reconciliationRuns.customerId),
          ),
        )
        .innerJoin(
          meters,
          and(
            eq(meters.organizationId, reconciliationRuns.organizationId),
            eq(meters.id, reconciliationRuns.meterId),
          ),
        )
        .where(
          and(
            eq(reconciliationRuns.organizationId, tenant.organization.id),
            query.customerKey ? eq(customers.externalKey, query.customerKey) : undefined,
            query.kind ? eq(reconciliationRuns.kind, query.kind) : undefined,
            query.meterKey ? eq(meters.key, query.meterKey) : undefined,
            query.repairRequested === undefined
              ? undefined
              : eq(reconciliationRuns.repairRequested, query.repairRequested),
            query.status ? eq(reconciliationRuns.status, query.status) : undefined,
            cursor
              ? or(
                  lt(reconciliationRuns.createdAt, cursor.createdAt),
                  and(
                    eq(reconciliationRuns.createdAt, cursor.createdAt),
                    lt(reconciliationRuns.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(reconciliationRuns.createdAt), desc(reconciliationRuns.id))
        .limit(query.limit + 1);
      const hasNext = rows.length > query.limit;
      const selected = rows.slice(0, query.limit);
      const last = selected.at(-1);
      return {
        items: selected.map(({ customerKey, meterKey, run }) => toRun(run, customerKey, meterKey)),
        nextCursor: hasNext && last ? encodeTimedCursor(last.run) : null,
      };
    },

    async listAudit(tenant, query) {
      const cursor = decodeCursor(query.cursor);
      const rows = await database
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.organizationId, tenant.organization.id),
            query.action ? eq(auditLog.action, query.action) : undefined,
            query.resourceType ? eq(auditLog.resourceType, query.resourceType) : undefined,
            query.resourceId ? eq(auditLog.resourceId, query.resourceId) : undefined,
            cursor ? gt(auditLog.id, cursor) : undefined,
          ),
        )
        .orderBy(asc(auditLog.id))
        .limit(query.limit + 1);
      const hasNext = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const lastItem = page.at(-1);
      return {
        items: page.map((row) =>
          auditLogEntrySchema.parse({
            action: row.action,
            actor:
              row.actorType === "system"
                ? { apiKeyId: null, type: "system", userId: null }
                : row.actorType === "user"
                  ? { apiKeyId: null, type: "user", userId: row.actorUserId }
                  : { apiKeyId: row.actorApiKeyId, type: "api_key", userId: null },
            id: row.id,
            metadata: row.metadata,
            occurredAt: row.occurredAt.toISOString(),
            requestId: row.requestId,
            resourceId: row.resourceId,
            resourceType: row.resourceType,
          }),
        ),
        nextCursor: hasNext && lastItem ? encodeCursor(lastItem.id) : null,
      };
    },

    async listFindings(tenant, runId, page) {
      const run = await findRun(tenant.organization.id, runId);
      if (!run) return null;
      const cursor = decodeCursor(page.cursor);
      const rows = await database
        .select()
        .from(reconciliationFindings)
        .where(
          and(
            eq(reconciliationFindings.organizationId, tenant.organization.id),
            eq(reconciliationFindings.runId, runId),
            cursor ? gt(reconciliationFindings.id, cursor) : undefined,
          ),
        )
        .orderBy(asc(reconciliationFindings.id))
        .limit(page.limit + 1);
      const hasNext = rows.length > page.limit;
      const items = rows.slice(0, page.limit).map((row) =>
        reconciliationFindingSchema.parse({
          actualEventCount: row.actualEventCount,
          actualQuantity: row.actualQuantity,
          bucketStart: row.bucketStart.toISOString(),
          dimensions: row.dimensions,
          dimensionsHash: row.dimensionsHash,
          expectedEventCount: row.expectedEventCount,
          expectedQuantity: row.expectedQuantity,
          id: row.id,
          kind: row.kind,
          meterVersionId: row.meterVersionId,
          repaired: row.repaired,
        }),
      );
      const lastItem = items.at(-1);
      return {
        items,
        nextCursor: hasNext && lastItem ? encodeCursor(lastItem.id) : null,
      };
    },
  });
}
