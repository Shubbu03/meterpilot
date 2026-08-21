import {
  MAX_EVENT_PROPERTY_RETENTION_DAYS,
  MIN_EVENT_PROPERTY_RETENTION_DAYS,
  type RetentionEnforcementJobPayload,
} from "@meterpilot/contracts/retention";
import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";
import type { jobs } from "./events";
import { organizations } from "./tenancy";

const timestampColumn = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export const dataRetentionPolicies = pgTable(
  "data_retention_policies",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventPropertiesRetentionDays: integer("event_properties_retention_days"),
    version: integer("version").default(1).notNull(),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestampColumn("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId], name: "data_retention_policies_pk" }),
    check(
      "data_retention_policies_days_check",
      sql`${table.eventPropertiesRetentionDays} is null or ${table.eventPropertiesRetentionDays} between ${MIN_EVENT_PROPERTY_RETENTION_DAYS} and ${MAX_EVENT_PROPERTY_RETENTION_DAYS}`,
    ),
    check("data_retention_policies_version_check", sql`${table.version} > 0`),
  ],
);

export const RETENTION_ENFORCEMENT_JOB_TYPE = "retention.enforce";

export function retentionEnforcementJob(
  input: Readonly<{
    createdAt: Date;
    nextAttemptAt?: Date;
    organizationId: string;
    payload: RetentionEnforcementJobPayload;
    resourceId: string;
  }>,
) {
  return {
    createdAt: input.createdAt,
    nextAttemptAt: input.nextAttemptAt ?? input.createdAt,
    organizationId: input.organizationId,
    payload: input.payload,
    resourceId: input.resourceId,
    resourceType: "retention_policy",
    type: RETENTION_ENFORCEMENT_JOB_TYPE,
    updatedAt: input.createdAt,
  } as const satisfies typeof jobs.$inferInsert;
}
