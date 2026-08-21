import {
  invoicePreviewSchema,
  invoicePreviewSummarySchema,
  type InvoicePreview,
  type InvoicePreviewSummary,
} from "@meterpilot/contracts/previews";
import type { Database } from "@meterpilot/db";
import {
  auditLog,
  customers,
  invoicePreviewGenerationJob,
  invoicePreviewLines,
  invoicePreviews,
  jobs,
  planVersions,
  subscriptions,
} from "@meterpilot/db/schema";
import { billingPeriodAt } from "@meterpilot/domain";
import { and, asc, desc, eq, gt, lt, max } from "drizzle-orm";

import { canManageCatalog } from "../organizations/authorization";
import { InvalidPreviewCursorError, type PreviewRepository } from "./repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PreviewRow = typeof invoicePreviews.$inferSelect;

function encodeCursor(value: string | number): string {
  return Buffer.from(String(value)).toString("base64url");
}

function decodeUuidCursor(cursor?: string): string | undefined {
  if (!cursor) return undefined;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (Buffer.from(decoded).toString("base64url") !== cursor || !UUID_PATTERN.test(decoded)) {
    throw new InvalidPreviewCursorError();
  }
  return decoded;
}

function decodeRevisionCursor(cursor?: string): number | undefined {
  if (!cursor) return undefined;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const revision = Number(decoded);
  if (
    Buffer.from(decoded).toString("base64url") !== cursor ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    String(revision) !== decoded
  ) {
    throw new InvalidPreviewCursorError();
  }
  return revision;
}

function toSummary(row: PreviewRow, customerKey: string): InvoicePreviewSummary {
  return invoicePreviewSummarySchema.parse({
    adjustmentOfPreviewId: row.adjustmentOfPreviewId,
    calculationHash: row.calculationHash,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    currency: row.currency,
    customerKey,
    failureCode: row.failureCode,
    id: row.id,
    periodEnd: row.periodEnd.toISOString(),
    periodStart: row.periodStart.toISOString(),
    planVersionId: row.planVersionId,
    revision: row.revision,
    seriesId: row.seriesId,
    status: row.status,
    subscriptionId: row.subscriptionId,
    subtotalMinor: row.subtotalMinor,
  });
}

async function loadPreview(
  database: Pick<Database["db"], "select">,
  organizationId: string,
  row: PreviewRow,
): Promise<InvoicePreview> {
  const lines = await database
    .select()
    .from(invoicePreviewLines)
    .where(
      and(
        eq(invoicePreviewLines.organizationId, organizationId),
        eq(invoicePreviewLines.previewId, row.id),
      ),
    )
    .orderBy(invoicePreviewLines.componentKey);

  return invoicePreviewSchema.parse({
    adjustmentOfPreviewId: row.adjustmentOfPreviewId,
    calculationHash: row.calculationHash,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    currency: row.currency,
    failureCode: row.failureCode,
    id: row.id,
    inputSnapshot: row.inputSnapshot,
    lines: lines.map((line) => ({
      amountMinor: line.amountMinor,
      calculationHash: line.calculationHash,
      componentKey: line.componentKey,
      id: line.id,
      meterVersionIds: line.meterVersionIds,
      preRoundAmount: line.preRoundAmount,
      pricingTrace: line.pricingTrace,
      quantity: line.quantity,
      roundedAmount: line.roundedAmount,
      sourceBuckets: line.sourceBuckets,
    })),
    periodEnd: row.periodEnd.toISOString(),
    periodStart: row.periodStart.toISOString(),
    planVersionId: row.planVersionId,
    revision: row.revision,
    seriesId: row.seriesId,
    status: row.status,
    subscriptionId: row.subscriptionId,
    subtotalMinor: row.subtotalMinor,
  });
}

export function createDrizzlePreviewRepository(
  database: Database["db"],
  now: () => Date = () => new Date(),
): PreviewRepository {
  return Object.freeze({
    async create(tenant, input, requestId) {
      if (!canManageCatalog(tenant.membership.role)) {
        return { status: "forbidden" };
      }
      const periodStart = new Date(input.periodStart);
      const periodEnd = new Date(input.periodEnd);

      return database.transaction(async (transaction) => {
        const [context] = await transaction
          .select({
            billingAnchor: subscriptions.billingAnchor,
            billingTimezone: customers.billingTimezone,
            currency: planVersions.currency,
            customerId: subscriptions.customerId,
            endsAt: subscriptions.endsAt,
            planVersionId: subscriptions.planVersionId,
            startsAt: subscriptions.startsAt,
          })
          .from(subscriptions)
          .innerJoin(
            customers,
            and(
              eq(customers.organizationId, subscriptions.organizationId),
              eq(customers.id, subscriptions.customerId),
            ),
          )
          .innerJoin(
            planVersions,
            and(
              eq(planVersions.organizationId, subscriptions.organizationId),
              eq(planVersions.id, subscriptions.planVersionId),
            ),
          )
          .where(
            and(
              eq(subscriptions.organizationId, tenant.organization.id),
              eq(subscriptions.id, input.subscriptionId),
            ),
          )
          .for("update")
          .limit(1);
        if (!context) {
          return { status: "not_found" } as const;
        }
        if (periodStart < context.startsAt || (context.endsAt && periodEnd > context.endsAt)) {
          return { status: "conflict" } as const;
        }
        let expectedPeriod: ReturnType<typeof billingPeriodAt>;
        try {
          expectedPeriod = billingPeriodAt({
            at: periodStart,
            billingAnchor: context.billingAnchor,
            subscriptionEnd: context.endsAt,
            subscriptionStart: context.startsAt,
            timeZone: context.billingTimezone,
          });
        } catch {
          return { status: "conflict" } as const;
        }
        if (
          expectedPeriod.start.getTime() !== periodStart.getTime() ||
          expectedPeriod.end.getTime() !== periodEnd.getTime()
        ) {
          return { status: "conflict" } as const;
        }

        const createdAt = now();
        const previewId = crypto.randomUUID();
        const [created] = await transaction
          .insert(invoicePreviews)
          .values({
            createdAt,
            currency: context.currency,
            customerId: context.customerId,
            id: previewId,
            organizationId: tenant.organization.id,
            periodEnd,
            periodStart,
            planVersionId: context.planVersionId,
            requestedBy: tenant.actorUserId,
            revision: 1,
            seriesId: previewId,
            subscriptionId: input.subscriptionId,
          })
          .returning();
        if (!created) {
          throw new Error("Invoice preview insertion returned no row.");
        }
        const [job] = await transaction
          .insert(jobs)
          .values(
            invoicePreviewGenerationJob({
              createdAt,
              organizationId: tenant.organization.id,
              previewId: created.id,
              requestId,
            }),
          )
          .returning({ id: jobs.id });
        if (!job) {
          throw new Error("Invoice preview job insertion returned no row.");
        }
        await transaction.insert(auditLog).values({
          action: "invoice_preview.requested",
          actorType: "user",
          actorUserId: tenant.actorUserId,
          metadata: { periodEnd: input.periodEnd, periodStart: input.periodStart, revision: 1 },
          organizationId: tenant.organization.id,
          requestId,
          resourceId: previewId,
          resourceType: "invoice_preview",
        });

        return {
          jobId: job.id,
          preview: await loadPreview(transaction, tenant.organization.id, created),
          status: "ok",
        } as const;
      });
    },

    async find(tenant, seriesId) {
      const [row] = await database
        .select()
        .from(invoicePreviews)
        .where(
          and(
            eq(invoicePreviews.organizationId, tenant.organization.id),
            eq(invoicePreviews.seriesId, seriesId),
          ),
        )
        .orderBy(desc(invoicePreviews.revision))
        .limit(1);
      return row ? loadPreview(database, tenant.organization.id, row) : null;
    },

    async findRevision(tenant, seriesId, revision) {
      const [row] = await database
        .select()
        .from(invoicePreviews)
        .where(
          and(
            eq(invoicePreviews.organizationId, tenant.organization.id),
            eq(invoicePreviews.seriesId, seriesId),
            eq(invoicePreviews.revision, revision),
          ),
        )
        .limit(1);
      return row ? loadPreview(database, tenant.organization.id, row) : null;
    },

    async list(tenant, query) {
      const cursor = decodeUuidCursor(query.cursor);
      const latestRevision = database
        .select({
          revision: max(invoicePreviews.revision).as("revision"),
          seriesId: invoicePreviews.seriesId,
        })
        .from(invoicePreviews)
        .where(eq(invoicePreviews.organizationId, tenant.organization.id))
        .groupBy(invoicePreviews.seriesId)
        .as("latest_invoice_preview_revision");
      const rows = await database
        .select({ customerKey: customers.externalKey, preview: invoicePreviews })
        .from(invoicePreviews)
        .innerJoin(
          latestRevision,
          and(
            eq(latestRevision.seriesId, invoicePreviews.seriesId),
            eq(latestRevision.revision, invoicePreviews.revision),
          ),
        )
        .innerJoin(
          customers,
          and(
            eq(customers.organizationId, invoicePreviews.organizationId),
            eq(customers.id, invoicePreviews.customerId),
          ),
        )
        .where(
          and(
            eq(invoicePreviews.organizationId, tenant.organization.id),
            query.customerKey ? eq(customers.externalKey, query.customerKey) : undefined,
            query.status ? eq(invoicePreviews.status, query.status) : undefined,
            query.subscriptionId
              ? eq(invoicePreviews.subscriptionId, query.subscriptionId)
              : undefined,
            cursor ? gt(invoicePreviews.seriesId, cursor) : undefined,
          ),
        )
        .orderBy(asc(invoicePreviews.seriesId))
        .limit(query.limit + 1);
      const hasNext = rows.length > query.limit;
      const items = rows
        .slice(0, query.limit)
        .map(({ customerKey, preview }) => toSummary(preview, customerKey));
      const last = items.at(-1);
      return {
        items,
        nextCursor: hasNext && last ? encodeCursor(last.seriesId) : null,
      };
    },

    async listRevisions(tenant, seriesId, page) {
      const cursor = decodeRevisionCursor(page.cursor);
      const [series] = await database
        .select({ customerKey: customers.externalKey })
        .from(invoicePreviews)
        .innerJoin(
          customers,
          and(
            eq(customers.organizationId, invoicePreviews.organizationId),
            eq(customers.id, invoicePreviews.customerId),
          ),
        )
        .where(
          and(
            eq(invoicePreviews.organizationId, tenant.organization.id),
            eq(invoicePreviews.seriesId, seriesId),
          ),
        )
        .limit(1);
      if (!series) return null;
      const rows = await database
        .select()
        .from(invoicePreviews)
        .where(
          and(
            eq(invoicePreviews.organizationId, tenant.organization.id),
            eq(invoicePreviews.seriesId, seriesId),
            cursor ? lt(invoicePreviews.revision, cursor) : undefined,
          ),
        )
        .orderBy(desc(invoicePreviews.revision))
        .limit(page.limit + 1);
      const hasNext = rows.length > page.limit;
      const items = rows
        .slice(0, page.limit)
        .map((preview) => toSummary(preview, series.customerKey));
      const last = items.at(-1);
      return {
        items,
        nextCursor: hasNext && last ? encodeCursor(last.revision) : null,
      };
    },
  });
}
