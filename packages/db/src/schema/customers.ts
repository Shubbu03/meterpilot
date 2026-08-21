import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { organizations } from "./tenancy";

const timestampColumn = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    externalKey: varchar("external_key", { length: 128 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    email: varchar("email", { length: 320 }),
    billingTimezone: varchar("billing_timezone", { length: 64 }).default("UTC").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    archivedAt: timestampColumn("archived_at"),
  },
  (table) => [
    unique("customers_organization_external_key_unique").on(
      table.organizationId,
      table.externalKey,
    ),
    unique("customers_organization_id_unique").on(table.organizationId, table.id),
    index("customers_organization_created_at_idx").on(table.organizationId, table.createdAt),
    check(
      "customers_external_key_format_check",
      sql`${table.externalKey} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'`,
    ),
    check("customers_name_not_empty_check", sql`length(trim(${table.name})) > 0`),
    check(
      "customers_billing_timezone_not_empty_check",
      sql`length(trim(${table.billingTimezone})) > 0`,
    ),
    check(
      "customers_archived_at_check",
      sql`${table.archivedAt} is null or ${table.archivedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const subjects = pgTable(
  "subjects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    externalKey: varchar("external_key", { length: 128 }).notNull(),
    customerId: uuid("customer_id").notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("subjects_organization_external_key_unique").on(table.organizationId, table.externalKey),
    unique("subjects_organization_id_unique").on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.customerId],
      foreignColumns: [customers.organizationId, customers.id],
      name: "subjects_organization_customer_fk",
    }).onDelete("restrict"),
    index("subjects_organization_customer_idx").on(table.organizationId, table.customerId),
    check(
      "subjects_external_key_format_check",
      sql`${table.externalKey} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'`,
    ),
  ],
);
