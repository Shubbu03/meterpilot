import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { meters } from "./metering";
import { organizations } from "./tenancy";

const timestampColumn = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export const features = pgTable(
  "features",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    key: varchar("key", { length: 128 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    meterId: uuid("meter_id"),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("features_organization_key_unique").on(table.organizationId, table.key),
    unique("features_organization_id_unique").on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.meterId],
      foreignColumns: [meters.organizationId, meters.id],
      name: "features_organization_meter_fk",
    }).onDelete("restrict"),
    index("features_organization_created_at_idx").on(table.organizationId, table.createdAt),
    check("features_key_format_check", sql`${table.key} ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'`),
    check("features_name_not_empty_check", sql`length(trim(${table.name})) > 0`),
  ],
);
