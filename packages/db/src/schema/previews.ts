import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { customers } from "./customers";
import { users } from "./auth";
import type { jobs } from "./events";
import { planComponents, planVersions, subscriptions } from "./catalog";
import { organizations } from "./tenancy";

const timestampColumn = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export type PreviewInputSnapshot = Readonly<{
  engineVersion?: string;
  inputWatermark?: string;
  lines?: readonly Readonly<{
    componentId: string;
    eventCount: number;
    meterVersionIds: readonly string[];
    quantity: string;
    sourceBuckets: readonly Readonly<{
      bucketStart: string;
      dimensionsHash: string;
      meterVersionId: string;
      revision: number;
    }>[];
  }>[];
}>;

export type StoredPreviewTrace = Readonly<Record<string, unknown>>;

export const invoicePreviewStatus = pgEnum("invoice_preview_status", [
  "pending",
  "completed",
  "failed",
]);

export const invoicePreviews = pgTable(
  "invoice_previews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adjustmentOfPreviewId: uuid("adjustment_of_preview_id"),
    seriesId: uuid("series_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id").notNull(),
    subscriptionId: uuid("subscription_id").notNull(),
    planVersionId: uuid("plan_version_id").notNull(),
    periodStart: timestampColumn("period_start").notNull(),
    periodEnd: timestampColumn("period_end").notNull(),
    revision: integer("revision").notNull(),
    status: invoicePreviewStatus("status").default("pending").notNull(),
    inputSnapshot: jsonb("input_snapshot").$type<PreviewInputSnapshot>().default({}).notNull(),
    subtotalMinor: numeric("subtotal_minor", { scale: 0 }),
    currency: varchar("currency", { length: 3 }).notNull(),
    calculationHash: varchar("calculation_hash", { length: 64 }),
    failureCode: varchar("failure_code", { length: 64 }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    completedAt: timestampColumn("completed_at"),
  },
  (table) => [
    unique("invoice_previews_organization_id_unique").on(table.organizationId, table.id),
    unique("invoice_previews_organization_series_id_unique").on(
      table.organizationId,
      table.seriesId,
      table.id,
    ),
    unique("invoice_previews_organization_series_revision_unique").on(
      table.organizationId,
      table.seriesId,
      table.revision,
    ),
    foreignKey({
      columns: [table.organizationId, table.adjustmentOfPreviewId],
      foreignColumns: [table.organizationId, table.id],
      name: "invoice_previews_organization_adjustment_preview_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.customerId],
      foreignColumns: [customers.organizationId, customers.id],
      name: "invoice_previews_organization_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.subscriptionId],
      foreignColumns: [subscriptions.organizationId, subscriptions.id],
      name: "invoice_previews_organization_subscription_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.planVersionId],
      foreignColumns: [planVersions.organizationId, planVersions.id],
      name: "invoice_previews_organization_plan_version_fk",
    }).onDelete("restrict"),
    index("invoice_previews_series_latest_idx").on(
      table.organizationId,
      table.seriesId,
      table.revision,
    ),
    index("invoice_previews_customer_period_idx").on(
      table.organizationId,
      table.customerId,
      table.periodStart,
      table.periodEnd,
    ),
    check("invoice_previews_period_check", sql`${table.periodEnd} > ${table.periodStart}`),
    check("invoice_previews_revision_check", sql`${table.revision} >= 1`),
    check("invoice_previews_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "invoice_previews_result_shape_check",
      sql`(
        ${table.status} = 'pending'
        and ${table.subtotalMinor} is null
        and ${table.calculationHash} is null
        and ${table.failureCode} is null
        and ${table.completedAt} is null
      ) or (
        ${table.status} = 'completed'
        and ${table.subtotalMinor} is not null
        and ${table.calculationHash} ~ '^[a-f0-9]{64}$'
        and ${table.failureCode} is null
        and ${table.completedAt} is not null
      ) or (
        ${table.status} = 'failed'
        and ${table.subtotalMinor} is null
        and ${table.calculationHash} is null
        and length(trim(${table.failureCode})) > 0
        and ${table.completedAt} is not null
      )`,
    ),
  ],
);

export const invoicePreviewLines = pgTable(
  "invoice_preview_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    previewId: uuid("preview_id").notNull(),
    planComponentId: uuid("plan_component_id").notNull(),
    componentKey: varchar("component_key", { length: 128 }).notNull(),
    quantity: numeric("quantity").notNull(),
    meterVersionIds: jsonb("meter_version_ids").$type<readonly string[]>().default([]).notNull(),
    pricingTrace: jsonb("pricing_trace").$type<StoredPreviewTrace>().notNull(),
    sourceBuckets: jsonb("source_buckets")
      .$type<readonly Record<string, unknown>[]>()
      .default([])
      .notNull(),
    preRoundAmount: numeric("pre_round_amount").notNull(),
    roundedAmount: numeric("rounded_amount").notNull(),
    amountMinor: numeric("amount_minor", { scale: 0 }).notNull(),
    calculationHash: varchar("calculation_hash", { length: 64 }).notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("invoice_preview_lines_organization_preview_component_unique").on(
      table.organizationId,
      table.previewId,
      table.planComponentId,
    ),
    foreignKey({
      columns: [table.organizationId, table.previewId],
      foreignColumns: [invoicePreviews.organizationId, invoicePreviews.id],
      name: "invoice_preview_lines_organization_preview_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.planComponentId],
      foreignColumns: [planComponents.organizationId, planComponents.id],
      name: "invoice_preview_lines_organization_component_fk",
    }).onDelete("restrict"),
    index("invoice_preview_lines_preview_idx").on(table.organizationId, table.previewId),
    check("invoice_preview_lines_quantity_check", sql`${table.quantity} >= 0`),
    check("invoice_preview_lines_hash_check", sql`${table.calculationHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const INVOICE_PREVIEW_GENERATE_JOB_TYPE = "invoice_preview.generate";

export function invoicePreviewGenerationJob(
  input: Readonly<{
    createdAt: Date;
    organizationId: string;
    previewId: string;
    requestId: string;
  }>,
): typeof jobs.$inferInsert {
  return {
    createdAt: input.createdAt,
    nextAttemptAt: input.createdAt,
    organizationId: input.organizationId,
    payload: { previewId: input.previewId, requestId: input.requestId },
    resourceId: input.previewId,
    resourceType: "invoice_preview",
    type: INVOICE_PREVIEW_GENERATE_JOB_TYPE,
    updatedAt: input.createdAt,
  };
}
