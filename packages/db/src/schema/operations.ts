import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { customers } from "./customers";
import type { jobs } from "./events";
import { meters, meterVersions, type MeterDimensions } from "./metering";
import { invoicePreviews } from "./previews";
import { organizations } from "./tenancy";

const timestampColumn = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export type ReconciliationSummary = Readonly<{
  driftCount: number;
  repairedCount: number;
  totalMagnitude: string;
}>;

export type StripeInvoiceItemPayload = Readonly<{
  amount: number;
  currency: string;
  customer: string;
  description: string;
  metadata: Record<string, string>;
}>;

export type StripeInvoiceLineExportPayload = Readonly<{
  items: StripeInvoiceItemPayload[];
  object: "meterpilot.stripe_invoice_item_batch";
  source: Readonly<{
    previewHash: string;
    previewId: string;
    previewRevision: number;
    previewRevisionId: string;
  }>;
  version: "2026-08-20";
}>;

export const operationRunStatus = pgEnum("operation_run_status", [
  "pending",
  "completed",
  "failed",
]);
export const reconciliationRunKind = pgEnum("reconciliation_run_kind", [
  "reconciliation",
  "replay",
]);
export const reconciliationFindingKind = pgEnum("reconciliation_finding_kind", [
  "missing",
  "unexpected",
  "mismatch",
]);

export const rateLimitWindows = pgTable(
  "rate_limit_windows",
  {
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    windowStart: timestampColumn("window_start").notNull(),
    requestCount: integer("request_count").default(1).notNull(),
    expiresAt: timestampColumn("expires_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.keyHash, table.windowStart],
      name: "rate_limit_windows_key_window_pk",
    }),
    index("rate_limit_windows_expires_at_idx").on(table.expiresAt),
    check("rate_limit_windows_key_hash_check", sql`${table.keyHash} ~ '^[a-f0-9]{64}$'`),
    check("rate_limit_windows_request_count_check", sql`${table.requestCount} >= 1`),
    check("rate_limit_windows_expiry_check", sql`${table.expiresAt} > ${table.windowStart}`),
  ],
);

export const reconciliationRuns = pgTable(
  "reconciliation_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    kind: reconciliationRunKind("kind").notNull(),
    customerId: uuid("customer_id").notNull(),
    meterId: uuid("meter_id").notNull(),
    periodStart: timestampColumn("period_start").notNull(),
    periodEnd: timestampColumn("period_end").notNull(),
    inputWatermark: timestampColumn("input_watermark").notNull(),
    repairRequested: boolean("repair_requested").default(false).notNull(),
    status: operationRunStatus("status").default("pending").notNull(),
    summary: jsonb("summary").$type<ReconciliationSummary>(),
    beforeHash: varchar("before_hash", { length: 64 }),
    afterHash: varchar("after_hash", { length: 64 }),
    failureCode: varchar("failure_code", { length: 128 }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    completedAt: timestampColumn("completed_at"),
  },
  (table) => [
    unique("reconciliation_runs_organization_id_unique").on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.customerId],
      foreignColumns: [customers.organizationId, customers.id],
      name: "reconciliation_runs_organization_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.meterId],
      foreignColumns: [meters.organizationId, meters.id],
      name: "reconciliation_runs_organization_meter_fk",
    }).onDelete("restrict"),
    index("reconciliation_runs_organization_created_at_idx").on(
      table.organizationId,
      table.createdAt,
      table.id,
    ),
    check("reconciliation_runs_period_check", sql`${table.periodEnd} > ${table.periodStart}`),
    check(
      "reconciliation_runs_result_shape_check",
      sql`(
        ${table.status} = 'pending'
        and ${table.summary} is null
        and ${table.beforeHash} is null
        and ${table.afterHash} is null
        and ${table.failureCode} is null
        and ${table.completedAt} is null
      ) or (
        ${table.status} = 'completed'
        and ${table.summary} is not null
        and ${table.beforeHash} ~ '^[a-f0-9]{64}$'
        and ${table.afterHash} ~ '^[a-f0-9]{64}$'
        and ${table.failureCode} is null
        and ${table.completedAt} is not null
      ) or (
        ${table.status} = 'failed'
        and ${table.summary} is null
        and ${table.beforeHash} is null
        and ${table.afterHash} is null
        and length(trim(${table.failureCode})) > 0
        and ${table.completedAt} is not null
      )`,
    ),
  ],
);

export const reconciliationFindings = pgTable(
  "reconciliation_findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    runId: uuid("run_id").notNull(),
    meterVersionId: uuid("meter_version_id").notNull(),
    bucketStart: timestampColumn("bucket_start").notNull(),
    dimensionsHash: varchar("dimensions_hash", { length: 64 }).notNull(),
    dimensions: jsonb("dimensions").$type<MeterDimensions>().default({}).notNull(),
    kind: reconciliationFindingKind("kind").notNull(),
    expectedQuantity: numeric("expected_quantity"),
    actualQuantity: numeric("actual_quantity"),
    expectedEventCount: integer("expected_event_count"),
    actualEventCount: integer("actual_event_count"),
    repaired: boolean("repaired").default(false).notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("reconciliation_findings_run_bucket_unique").on(
      table.organizationId,
      table.runId,
      table.meterVersionId,
      table.bucketStart,
      table.dimensionsHash,
    ),
    foreignKey({
      columns: [table.organizationId, table.runId],
      foreignColumns: [reconciliationRuns.organizationId, reconciliationRuns.id],
      name: "reconciliation_findings_organization_run_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.meterVersionId],
      foreignColumns: [meterVersions.organizationId, meterVersions.id],
      name: "reconciliation_findings_organization_meter_version_fk",
    }).onDelete("restrict"),
    index("reconciliation_findings_run_idx").on(table.organizationId, table.runId, table.id),
    check("reconciliation_findings_hash_check", sql`${table.dimensionsHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "reconciliation_findings_shape_check",
      sql`(
        ${table.kind} = 'missing'
        and ${table.expectedQuantity} is not null
        and ${table.expectedEventCount} is not null
        and ${table.actualQuantity} is null
        and ${table.actualEventCount} is null
      ) or (
        ${table.kind} = 'unexpected'
        and ${table.expectedQuantity} is null
        and ${table.expectedEventCount} is null
        and ${table.actualQuantity} is not null
        and ${table.actualEventCount} is not null
      ) or (
        ${table.kind} = 'mismatch'
        and ${table.expectedQuantity} is not null
        and ${table.expectedEventCount} is not null
        and ${table.actualQuantity} is not null
        and ${table.actualEventCount} is not null
      )`,
    ),
  ],
);

export const billingExports = pgTable(
  "billing_exports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    sourcePreviewId: uuid("source_preview_id").notNull(),
    sourcePreviewRevisionId: uuid("source_preview_revision_id").notNull(),
    sourcePreviewHash: varchar("source_preview_hash", { length: 64 }).notNull(),
    sourcePreviewRevision: integer("source_preview_revision").notNull(),
    stripeCustomerId: varchar("stripe_customer_id", { length: 255 }).notNull(),
    status: operationRunStatus("status").default("pending").notNull(),
    payload: jsonb("payload").$type<StripeInvoiceLineExportPayload>(),
    contentHash: varchar("content_hash", { length: 64 }),
    failureCode: varchar("failure_code", { length: 128 }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    completedAt: timestampColumn("completed_at"),
  },
  (table) => [
    unique("billing_exports_organization_id_unique").on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.sourcePreviewId, table.sourcePreviewRevisionId],
      foreignColumns: [
        invoicePreviews.organizationId,
        invoicePreviews.seriesId,
        invoicePreviews.id,
      ],
      name: "billing_exports_organization_preview_revision_fk",
    }).onDelete("restrict"),
    index("billing_exports_organization_created_at_idx").on(
      table.organizationId,
      table.createdAt,
      table.id,
    ),
    check("billing_exports_preview_hash_check", sql`${table.sourcePreviewHash} ~ '^[a-f0-9]{64}$'`),
    check("billing_exports_preview_revision_check", sql`${table.sourcePreviewRevision} >= 1`),
    check(
      "billing_exports_stripe_customer_check",
      sql`${table.stripeCustomerId} ~ '^cus_[A-Za-z0-9]+$'`,
    ),
    check(
      "billing_exports_result_shape_check",
      sql`(
        ${table.status} = 'pending'
        and ${table.payload} is null
        and ${table.contentHash} is null
        and ${table.failureCode} is null
        and ${table.completedAt} is null
      ) or (
        ${table.status} = 'completed'
        and ${table.payload} is not null
        and ${table.contentHash} ~ '^[a-f0-9]{64}$'
        and ${table.failureCode} is null
        and ${table.completedAt} is not null
      ) or (
        ${table.status} = 'failed'
        and ${table.payload} is null
        and ${table.contentHash} is null
        and length(trim(${table.failureCode})) > 0
        and ${table.completedAt} is not null
      )`,
    ),
  ],
);

export const RECONCILIATION_RUN_JOB_TYPE = "reconciliation.run";
export const STRIPE_INVOICE_LINE_EXPORT_JOB_TYPE = "stripe_invoice_lines.export";

export function reconciliationRunJob(
  input: Readonly<{
    createdAt: Date;
    organizationId: string;
    requestId: string;
    runId: string;
  }>,
): typeof jobs.$inferInsert {
  return {
    createdAt: input.createdAt,
    nextAttemptAt: input.createdAt,
    organizationId: input.organizationId,
    payload: { requestId: input.requestId, runId: input.runId },
    resourceId: input.runId,
    resourceType: "reconciliation_run",
    type: RECONCILIATION_RUN_JOB_TYPE,
    updatedAt: input.createdAt,
  };
}

export function stripeInvoiceLineExportJob(
  input: Readonly<{
    createdAt: Date;
    exportId: string;
    organizationId: string;
    requestId: string;
  }>,
): typeof jobs.$inferInsert {
  return {
    createdAt: input.createdAt,
    nextAttemptAt: input.createdAt,
    organizationId: input.organizationId,
    payload: { exportId: input.exportId, requestId: input.requestId },
    resourceId: input.exportId,
    resourceType: "billing_export",
    type: STRIPE_INVOICE_LINE_EXPORT_JOB_TYPE,
    updatedAt: input.createdAt,
  };
}
