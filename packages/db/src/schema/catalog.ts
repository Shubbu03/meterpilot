import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { customers } from "./customers";
import type { jobs } from "./events";
import { features } from "./features";
import { organizations } from "./tenancy";

const timestampColumn = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export type StoredPriceModel =
  | Readonly<{ amount: string; model: "flat" }>
  | Readonly<{ model: "per_unit"; unitRate: string }>
  | Readonly<{ includedQuantity: string; model: "included_overage"; overageRate: string }>
  | Readonly<{
      model: "graduated";
      tiers: readonly Readonly<{ unitRate: string; upTo: string | null }>[];
    }>;

export type StoredEntitlementDefinition = Readonly<{
  enabled: boolean;
  mode: "advisory" | "boolean" | "hard";
  quantity: string;
}>;

export type StoredRoundingDefinition = Readonly<{
  minorUnitScale: number;
  mode: "half_away_from_zero";
}>;

export const planVersionStatus = pgEnum("plan_version_status", ["draft", "published", "archived"]);
export const planComponentType = pgEnum("plan_component_type", [
  "flat",
  "per_unit",
  "included_overage",
  "graduated",
]);
export const billingInterval = pgEnum("billing_interval", ["month"]);
export const subscriptionStatus = pgEnum("subscription_status", ["active", "canceled"]);

export const SUBSCRIPTION_ENTITLEMENT_REFRESH_JOB_TYPE = "subscription.entitlements_refresh";

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    key: varchar("key", { length: 128 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at").defaultNow().notNull(),
    archivedAt: timestampColumn("archived_at"),
  },
  (table) => [
    unique("plans_organization_key_unique").on(table.organizationId, table.key),
    unique("plans_organization_id_unique").on(table.organizationId, table.id),
    index("plans_organization_created_at_idx").on(table.organizationId, table.createdAt, table.id),
    check("plans_key_format_check", sql`${table.key} ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'`),
    check("plans_name_not_empty_check", sql`length(trim(${table.name})) > 0`),
    check(
      "plans_archive_time_check",
      sql`${table.archivedAt} is null or ${table.archivedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const planVersions = pgTable(
  "plan_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    planId: uuid("plan_id").notNull(),
    version: integer("version").notNull(),
    status: planVersionStatus("status").default("draft").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    effectiveFrom: timestampColumn("effective_from").notNull(),
    publishedAt: timestampColumn("published_at"),
    archivedAt: timestampColumn("archived_at"),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("plan_versions_organization_plan_version_unique").on(
      table.organizationId,
      table.planId,
      table.version,
    ),
    unique("plan_versions_organization_id_unique").on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.planId],
      foreignColumns: [plans.organizationId, plans.id],
      name: "plan_versions_organization_plan_fk",
    }).onDelete("restrict"),
    index("plan_versions_effective_idx").on(
      table.organizationId,
      table.planId,
      table.effectiveFrom,
    ),
    check("plan_versions_version_check", sql`${table.version} >= 1`),
    check("plan_versions_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "plan_versions_lifecycle_check",
      sql`(
        ${table.status} = 'draft' and ${table.publishedAt} is null and ${table.archivedAt} is null
      ) or (
        ${table.status} = 'published' and ${table.publishedAt} is not null and ${table.archivedAt} is null
      ) or (
        ${table.status} = 'archived' and ${table.publishedAt} is not null and ${table.archivedAt} is not null
      )`,
    ),
  ],
);

export const planComponents = pgTable(
  "plan_components",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    planVersionId: uuid("plan_version_id").notNull(),
    componentKey: varchar("component_key", { length: 128 }).notNull(),
    featureId: uuid("feature_id"),
    componentType: planComponentType("component_type").notNull(),
    billingInterval: billingInterval("billing_interval").default("month").notNull(),
    pricingDefinition: jsonb("pricing_definition").$type<StoredPriceModel>().notNull(),
    entitlementDefinition: jsonb(
      "entitlement_definition",
    ).$type<StoredEntitlementDefinition | null>(),
    roundingDefinition: jsonb("rounding_definition").$type<StoredRoundingDefinition>().notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("plan_components_organization_id_unique").on(table.organizationId, table.id),
    unique("plan_components_organization_version_key_unique").on(
      table.organizationId,
      table.planVersionId,
      table.componentKey,
    ),
    foreignKey({
      columns: [table.organizationId, table.planVersionId],
      foreignColumns: [planVersions.organizationId, planVersions.id],
      name: "plan_components_organization_plan_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.featureId],
      foreignColumns: [features.organizationId, features.id],
      name: "plan_components_organization_feature_fk",
    }).onDelete("restrict"),
    index("plan_components_feature_idx").on(table.organizationId, table.featureId),
    check(
      "plan_components_key_format_check",
      sql`${table.componentKey} ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'`,
    ),
    check(
      "plan_components_pricing_model_check",
      sql`${table.pricingDefinition}->>'model' = ${table.componentType}::text`,
    ),
    check(
      "plan_components_feature_shape_check",
      sql`${table.componentType} = 'flat' or ${table.featureId} is not null`,
    ),
    check(
      "plan_components_entitlement_shape_check",
      sql`${table.entitlementDefinition} is null or ${table.featureId} is not null`,
    ),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id").notNull(),
    planVersionId: uuid("plan_version_id").notNull(),
    commercialSlot: varchar("commercial_slot", { length: 64 }).default("default").notNull(),
    startsAt: timestampColumn("starts_at").notNull(),
    endsAt: timestampColumn("ends_at"),
    billingAnchor: timestampColumn("billing_anchor").notNull(),
    status: subscriptionStatus("status").default("active").notNull(),
    canceledAt: timestampColumn("canceled_at"),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("subscriptions_organization_id_unique").on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.customerId],
      foreignColumns: [customers.organizationId, customers.id],
      name: "subscriptions_organization_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.planVersionId],
      foreignColumns: [planVersions.organizationId, planVersions.id],
      name: "subscriptions_organization_plan_version_fk",
    }).onDelete("restrict"),
    index("subscriptions_customer_time_idx").on(
      table.organizationId,
      table.customerId,
      table.commercialSlot,
      table.startsAt,
      table.endsAt,
    ),
    index("subscriptions_plan_version_idx").on(table.organizationId, table.planVersionId),
    check(
      "subscriptions_slot_format_check",
      sql`${table.commercialSlot} ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'`,
    ),
    check(
      "subscriptions_period_check",
      sql`${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
    check("subscriptions_anchor_check", sql`${table.billingAnchor} <= ${table.startsAt}`),
    check(
      "subscriptions_status_check",
      sql`(
        ${table.status} = 'active' and ${table.canceledAt} is null
      ) or (
        ${table.status} = 'canceled' and ${table.canceledAt} is not null and ${table.endsAt} is not null
      )`,
    ),
  ],
);

export function subscriptionEntitlementRefreshJob(
  input: Readonly<{
    createdAt: Date;
    periodStart: Date;
    requestId: string;
    subscriptionId: string;
    organizationId: string;
  }>,
): typeof jobs.$inferInsert {
  return {
    createdAt: input.createdAt,
    nextAttemptAt: input.periodStart,
    organizationId: input.organizationId,
    payload: {
      periodStart: input.periodStart.toISOString(),
      requestId: input.requestId,
      subscriptionId: input.subscriptionId,
    },
    resourceId: `${input.subscriptionId}:${input.periodStart.toISOString()}`,
    resourceType: "subscription_period",
    type: SUBSCRIPTION_ENTITLEMENT_REFRESH_JOB_TYPE,
    updatedAt: input.createdAt,
  };
}
