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
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { organizations } from "./tenancy";
import { customers } from "./customers";

const timestampColumn = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export type MeterFilterValue = boolean | null | number | string;
export type MeterFilter =
  | Readonly<{ operation: "equals" | "not_equals"; property: string; value: MeterFilterValue }>
  | Readonly<{ operation: "exists"; property: string; value: boolean }>
  | Readonly<{ operation: "in"; property: string; values: readonly MeterFilterValue[] }>;
export type MeterDimensions = Readonly<Record<string, MeterFilterValue>>;

export const meterStatus = pgEnum("meter_status", ["draft", "active", "archived"]);
export const meterAggregation = pgEnum("meter_aggregation", ["count", "sum"]);
export const usageBucketSize = pgEnum("usage_bucket_size", ["hour"]);

export const meters = pgTable(
  "meters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    key: varchar("key", { length: 128 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    status: meterStatus("status").default("draft").notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("meters_organization_id_key_unique").on(table.organizationId, table.key),
    unique("meters_organization_id_id_unique").on(table.organizationId, table.id),
    check("meters_key_format_check", sql`${table.key} ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'`),
    check("meters_name_not_empty_check", sql`length(trim(${table.name})) > 0`),
  ],
);

export const meterVersions = pgTable(
  "meter_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    meterId: uuid("meter_id").notNull(),
    version: integer("version").notNull(),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    aggregation: meterAggregation("aggregation").notNull(),
    valueProperty: varchar("value_property", { length: 128 }),
    filterDefinition: jsonb("filter_definition")
      .$type<readonly MeterFilter[]>()
      .default([])
      .notNull(),
    groupByKeys: text("group_by_keys").array().default([]).notNull(),
    effectiveFrom: timestampColumn("effective_from").notNull(),
    effectiveTo: timestampColumn("effective_to"),
    publishedAt: timestampColumn("published_at"),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("meter_versions_organization_meter_version_unique").on(
      table.organizationId,
      table.meterId,
      table.version,
    ),
    unique("meter_versions_organization_id_unique").on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.meterId],
      foreignColumns: [meters.organizationId, meters.id],
      name: "meter_versions_organization_meter_fk",
    }).onDelete("restrict"),
    index("meter_versions_event_effective_idx").on(
      table.organizationId,
      table.eventType,
      table.effectiveFrom,
    ),
    check("meter_versions_version_check", sql`${table.version} >= 1`),
    check(
      "meter_versions_event_type_format_check",
      sql`${table.eventType} ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'`,
    ),
    check(
      "meter_versions_aggregation_shape_check",
      sql`(
        (${table.aggregation} = 'count' and ${table.valueProperty} is null)
        or (${table.aggregation} = 'sum' and length(trim(${table.valueProperty})) > 0)
      )`,
    ),
    check(
      "meter_versions_effective_range_check",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
    check("meter_versions_group_by_limit_check", sql`cardinality(${table.groupByKeys}) <= 3`),
  ],
);

export const usageBuckets = pgTable(
  "usage_buckets",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    meterVersionId: uuid("meter_version_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    bucketStart: timestampColumn("bucket_start").notNull(),
    bucketSize: usageBucketSize("bucket_size").default("hour").notNull(),
    dimensionsHash: varchar("dimensions_hash", { length: 64 }).notNull(),
    dimensions: jsonb("dimensions").$type<MeterDimensions>().default({}).notNull(),
    quantity: numeric("quantity").notNull(),
    eventCount: integer("event_count").notNull(),
    maxReceivedAt: timestampColumn("max_received_at").notNull(),
    revision: integer("revision").default(1).notNull(),
    updatedAt: timestampColumn("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("usage_buckets_identity_unique").on(
      table.organizationId,
      table.meterVersionId,
      table.customerId,
      table.bucketStart,
      table.bucketSize,
      table.dimensionsHash,
    ),
    foreignKey({
      columns: [table.organizationId, table.customerId],
      foreignColumns: [customers.organizationId, customers.id],
      name: "usage_buckets_organization_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.meterVersionId],
      foreignColumns: [meterVersions.organizationId, meterVersions.id],
      name: "usage_buckets_organization_meter_version_fk",
    }).onDelete("restrict"),
    index("usage_buckets_customer_time_idx").on(
      table.organizationId,
      table.customerId,
      table.bucketStart,
    ),
    check("usage_buckets_dimensions_hash_check", sql`${table.dimensionsHash} ~ '^[a-f0-9]{64}$'`),
    check("usage_buckets_event_count_check", sql`${table.eventCount} > 0`),
    check("usage_buckets_revision_check", sql`${table.revision} >= 1`),
  ],
);
