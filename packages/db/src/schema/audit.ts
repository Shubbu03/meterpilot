import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { apiKeys, organizations } from "./tenancy";

export const auditActorType = pgEnum("audit_actor_type", ["system", "user", "api_key"]);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    actorType: auditActorType("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
    actorApiKeyId: uuid("actor_api_key_id"),
    action: varchar("action", { length: 128 }).notNull(),
    resourceType: varchar("resource_type", { length: 64 }).notNull(),
    resourceId: varchar("resource_id", { length: 128 }),
    requestId: varchar("request_id", { length: 128 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    occurredAt: timestamp("occurred_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.actorApiKeyId],
      foreignColumns: [apiKeys.organizationId, apiKeys.id],
      name: "audit_log_organization_actor_api_key_fk",
    }).onDelete("restrict"),
    index("audit_log_organization_occurred_at_idx").on(
      table.organizationId,
      table.occurredAt,
      table.id,
    ),
    index("audit_log_organization_resource_idx").on(
      table.organizationId,
      table.resourceType,
      table.resourceId,
    ),
    index("audit_log_actor_user_id_idx").on(table.actorUserId),
    index("audit_log_actor_api_key_id_idx").on(table.actorApiKeyId),
    check("audit_log_action_not_empty_check", sql`length(trim(${table.action})) > 0`),
    check("audit_log_resource_type_not_empty_check", sql`length(trim(${table.resourceType})) > 0`),
    check(
      "audit_log_actor_shape_check",
      sql`(
        (${table.actorType} = 'system' and ${table.actorUserId} is null and ${table.actorApiKeyId} is null)
        or (${table.actorType} = 'user' and ${table.actorUserId} is not null and ${table.actorApiKeyId} is null)
        or (${table.actorType} = 'api_key' and ${table.actorUserId} is null and ${table.actorApiKeyId} is not null)
      )`,
    ),
  ],
);
