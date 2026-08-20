import { API_KEY_SCOPES, ORGANIZATION_MEMBERSHIP_ROLES } from "@meterpilot/domain/identity";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./auth";

const timestampColumn = (name: string) => timestamp(name, { mode: "date", withTimezone: true });
const apiKeyScopeSql = sql.join(
  API_KEY_SCOPES.map((scope) => sql`${scope}`),
  sql`, `,
);

export const membershipRole = pgEnum("membership_role", ORGANIZATION_MEMBERSHIP_ROLES);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 63 }).notNull().unique("organizations_slug_unique"),
    name: varchar("name", { length: 200 }).notNull(),
    defaultTimezone: varchar("default_timezone", { length: 64 }).default("UTC").notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
  },
  (table) => [
    check("organizations_slug_format_check", sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
    check("organizations_name_not_empty_check", sql`length(trim(${table.name})) > 0`),
    check(
      "organizations_default_timezone_not_empty_check",
      sql`length(trim(${table.defaultTimezone})) > 0`,
    ),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.userId],
      name: "memberships_organization_id_user_id_pk",
    }),
    index("memberships_user_id_idx").on(table.userId),
    index("memberships_organization_id_role_idx").on(table.organizationId, table.role),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    prefix: varchar("prefix", { length: 32 }).notNull().unique("api_keys_prefix_unique"),
    secretHash: text("secret_hash").notNull(),
    scopes: text("scopes").array().notNull(),
    lastUsedAt: timestampColumn("last_used_at"),
    expiresAt: timestampColumn("expires_at"),
    revokedAt: timestampColumn("revoked_at"),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("api_keys_organization_id_id_unique").on(table.organizationId, table.id),
    index("api_keys_organization_id_created_at_idx").on(table.organizationId, table.createdAt),
    index("api_keys_organization_id_active_idx")
      .on(table.organizationId, table.expiresAt)
      .where(sql`${table.revokedAt} is null`),
    check("api_keys_prefix_format_check", sql`${table.prefix} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'`),
    check("api_keys_secret_hash_length_check", sql`length(${table.secretHash}) >= 32`),
    check(
      "api_keys_scopes_not_empty_check",
      sql`cardinality(${table.scopes}) > 0 and array_position(${table.scopes}, null) is null and array_position(${table.scopes}, '') is null`,
    ),
    check(
      "api_keys_scopes_allowed_check",
      sql`${table.scopes} <@ ARRAY[${apiKeyScopeSql}]::text[]`,
    ),
    check(
      "api_keys_last_used_at_check",
      sql`${table.lastUsedAt} is null or ${table.lastUsedAt} >= ${table.createdAt}`,
    ),
    check(
      "api_keys_expires_at_check",
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "api_keys_revoked_at_check",
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`,
    ),
  ],
);
