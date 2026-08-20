import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { apiKeys, organizations } from "./tenancy";

const timestampColumn = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export const usageEventCorrectionKind = pgEnum("usage_event_correction_kind", [
  "reverse",
  "replace",
]);

export const jobStatus = pgEnum("job_status", ["pending", "processing", "completed", "failed"]);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    eventKey: varchar("event_key", { length: 128 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    subjectKey: varchar("subject_key", { length: 128 }).notNull(),
    occurredAt: timestampColumn("occurred_at").notNull(),
    receivedAt: timestampColumn("received_at").defaultNow().notNull(),
    properties: jsonb("properties").$type<Record<string, unknown>>().default({}).notNull(),
    source: varchar("source", { length: 32 }).default("api_key").notNull(),
    sourceApiKeyId: uuid("source_api_key_id").notNull(),
    correctionOfEventId: uuid("correction_of_event_id"),
    correctionKind: usageEventCorrectionKind("correction_kind"),
  },
  (table) => [
    unique("usage_events_organization_id_event_key_unique").on(
      table.organizationId,
      table.eventKey,
    ),
    unique("usage_events_organization_id_id_unique").on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.sourceApiKeyId],
      foreignColumns: [apiKeys.organizationId, apiKeys.id],
      name: "usage_events_organization_source_api_key_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.correctionOfEventId],
      foreignColumns: [table.organizationId, table.id],
      name: "usage_events_organization_correction_event_fk",
    }).onDelete("restrict"),
    index("usage_events_organization_subject_occurred_at_idx").on(
      table.organizationId,
      table.subjectKey,
      table.occurredAt,
    ),
    index("usage_events_organization_type_occurred_at_idx").on(
      table.organizationId,
      table.eventType,
      table.occurredAt,
    ),
    index("usage_events_organization_received_at_idx").on(table.organizationId, table.receivedAt),
    index("usage_events_corrections_idx")
      .on(table.organizationId, table.correctionOfEventId)
      .where(sql`${table.correctionOfEventId} is not null`),
    check(
      "usage_events_event_key_format_check",
      sql`${table.eventKey} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'`,
    ),
    check(
      "usage_events_event_type_format_check",
      sql`${table.eventType} ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'`,
    ),
    check(
      "usage_events_subject_key_format_check",
      sql`${table.subjectKey} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'`,
    ),
    check("usage_events_payload_hash_format_check", sql`${table.payloadHash} ~ '^[a-f0-9]{64}$'`),
    check("usage_events_source_check", sql`${table.source} = 'api_key'`),
    check(
      "usage_events_correction_shape_check",
      sql`(
        (${table.correctionOfEventId} is null and ${table.correctionKind} is null)
        or (
          ${table.correctionOfEventId} is not null
          and ${table.correctionKind} is not null
          and ${table.correctionOfEventId} <> ${table.id}
        )
      )`,
    ),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    eventId: uuid("event_id"),
    type: varchar("type", { length: 128 }).notNull(),
    resourceType: varchar("resource_type", { length: 64 }).notNull(),
    resourceId: varchar("resource_id", { length: 128 }).notNull(),
    status: jobStatus("status").default("pending").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    leaseOwner: varchar("lease_owner", { length: 128 }),
    leaseExpiresAt: timestampColumn("lease_expires_at"),
    nextAttemptAt: timestampColumn("next_attempt_at").defaultNow().notNull(),
    lastError: text("last_error"),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at").defaultNow().notNull(),
    completedAt: timestampColumn("completed_at"),
  },
  (table) => [
    unique("jobs_organization_type_resource_unique").on(
      table.organizationId,
      table.type,
      table.resourceType,
      table.resourceId,
    ),
    foreignKey({
      columns: [table.organizationId, table.eventId],
      foreignColumns: [usageEvents.organizationId, usageEvents.id],
      name: "jobs_organization_event_fk",
    }).onDelete("restrict"),
    index("jobs_available_idx")
      .on(table.nextAttemptAt, table.createdAt, table.id)
      .where(sql`${table.status} = 'pending'`),
    index("jobs_lease_expiry_idx")
      .on(table.leaseExpiresAt)
      .where(sql`${table.status} = 'processing'`),
    index("jobs_organization_status_created_at_idx").on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    check("jobs_type_not_empty_check", sql`length(trim(${table.type})) > 0`),
    check(
      "jobs_resource_not_empty_check",
      sql`length(trim(${table.resourceType})) > 0 and length(trim(${table.resourceId})) > 0`,
    ),
    check(
      "jobs_event_reference_shape_check",
      sql`(
        ${table.eventId} is null
        or (
          ${table.resourceType} = 'usage_event'
          and ${table.resourceId} = ${table.eventId}::text
        )
      )
      and (
        ${table.type} <> 'usage_event.process'
        or ${table.eventId} is not null
      )`,
    ),
    check("jobs_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check(
      "jobs_lease_shape_check",
      sql`(
        (
          ${table.status} = 'processing'
          and ${table.leaseOwner} is not null
          and ${table.leaseExpiresAt} is not null
          and ${table.completedAt} is null
        )
        or (
          ${table.status} = 'pending'
          and ${table.leaseOwner} is null
          and ${table.leaseExpiresAt} is null
          and ${table.completedAt} is null
        )
        or (
          ${table.status} in ('completed', 'failed')
          and ${table.leaseOwner} is null
          and ${table.leaseExpiresAt} is null
          and ${table.completedAt} is not null
        )
      )`,
    ),
  ],
);
