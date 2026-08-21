import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { customers } from "./customers";
import { subscriptions } from "./catalog";
import type { jobs } from "./events";
import { features } from "./features";
import { organizations } from "./tenancy";

const timestampColumn = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export const entitlementMode = pgEnum("entitlement_mode", ["boolean", "advisory", "hard"]);
export const quotaReservationStatus = pgEnum("quota_reservation_status", [
  "pending",
  "committed",
  "released",
  "expired",
]);

export const entitlements = pgTable(
  "entitlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id").notNull(),
    featureId: uuid("feature_id").notNull(),
    subscriptionId: uuid("subscription_id"),
    mode: entitlementMode("mode").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    periodStart: timestampColumn("period_start").notNull(),
    periodEnd: timestampColumn("period_end").notNull(),
    grantedQuantity: numeric("granted_quantity").default("0").notNull(),
    committedQuantity: numeric("committed_quantity").default("0").notNull(),
    reservedQuantity: numeric("reserved_quantity").default("0").notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("entitlements_organization_id_unique").on(table.organizationId, table.id),
    unique("entitlements_organization_customer_feature_period_unique").on(
      table.organizationId,
      table.customerId,
      table.featureId,
      table.periodStart,
      table.periodEnd,
    ),
    foreignKey({
      columns: [table.organizationId, table.customerId],
      foreignColumns: [customers.organizationId, customers.id],
      name: "entitlements_organization_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.featureId],
      foreignColumns: [features.organizationId, features.id],
      name: "entitlements_organization_feature_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.subscriptionId],
      foreignColumns: [subscriptions.organizationId, subscriptions.id],
      name: "entitlements_organization_subscription_fk",
    }).onDelete("restrict"),
    index("entitlements_customer_period_idx").on(
      table.organizationId,
      table.customerId,
      table.periodStart,
      table.periodEnd,
    ),
    index("entitlements_feature_period_idx").on(
      table.organizationId,
      table.featureId,
      table.periodStart,
      table.periodEnd,
    ),
    check("entitlements_period_check", sql`${table.periodEnd} > ${table.periodStart}`),
    check(
      "entitlements_quantities_non_negative_check",
      sql`${table.grantedQuantity} >= 0 and ${table.committedQuantity} >= 0 and ${table.reservedQuantity} >= 0`,
    ),
    check(
      "entitlements_boolean_shape_check",
      sql`${table.mode} <> 'boolean' or (${table.grantedQuantity} = 0 and ${table.committedQuantity} = 0 and ${table.reservedQuantity} = 0)`,
    ),
    check(
      "entitlements_hard_limit_check",
      sql`${table.mode} <> 'hard' or ${table.committedQuantity} + ${table.reservedQuantity} <= ${table.grantedQuantity}`,
    ),
    check("entitlements_version_check", sql`${table.version} >= 1`),
  ],
);

export const quotaGrants = pgTable(
  "quota_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    entitlementId: uuid("entitlement_id").notNull(),
    quantity: numeric("quantity").notNull(),
    effectiveAt: timestampColumn("effective_at").notNull(),
    expiresAt: timestampColumn("expires_at"),
    reason: varchar("reason", { length: 200 }).notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("quota_grants_organization_id_unique").on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.entitlementId],
      foreignColumns: [entitlements.organizationId, entitlements.id],
      name: "quota_grants_organization_entitlement_fk",
    }).onDelete("restrict"),
    index("quota_grants_entitlement_effective_idx").on(
      table.organizationId,
      table.entitlementId,
      table.effectiveAt,
    ),
    check("quota_grants_quantity_positive_check", sql`${table.quantity} > 0`),
    check("quota_grants_reason_not_empty_check", sql`length(trim(${table.reason})) > 0`),
    check(
      "quota_grants_effective_range_check",
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.effectiveAt}`,
    ),
  ],
);

export const quotaReservations = pgTable(
  "quota_reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    entitlementId: uuid("entitlement_id").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestedQuantity: numeric("requested_quantity").notNull(),
    committedQuantity: numeric("committed_quantity"),
    status: quotaReservationStatus("status").default("pending").notNull(),
    expiresAt: timestampColumn("expires_at").notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    completedAt: timestampColumn("completed_at"),
  },
  (table) => [
    unique("quota_reservations_organization_id_unique").on(table.organizationId, table.id),
    unique("quota_reservations_organization_entitlement_key_unique").on(
      table.organizationId,
      table.entitlementId,
      table.idempotencyKey,
    ),
    foreignKey({
      columns: [table.organizationId, table.entitlementId],
      foreignColumns: [entitlements.organizationId, entitlements.id],
      name: "quota_reservations_organization_entitlement_fk",
    }).onDelete("restrict"),
    index("quota_reservations_expiry_idx")
      .on(table.expiresAt, table.id)
      .where(sql`${table.status} = 'pending'`),
    index("quota_reservations_entitlement_status_idx").on(
      table.organizationId,
      table.entitlementId,
      table.status,
    ),
    check(
      "quota_reservations_idempotency_key_format_check",
      sql`${table.idempotencyKey} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'`,
    ),
    check(
      "quota_reservations_quantity_check",
      sql`${table.requestedQuantity} > 0 and (${table.committedQuantity} is null or (${table.committedQuantity} > 0 and ${table.committedQuantity} <= ${table.requestedQuantity}))`,
    ),
    check("quota_reservations_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "quota_reservations_state_check",
      sql`(
        ${table.status} = 'pending'
        and ${table.committedQuantity} is null
        and ${table.completedAt} is null
      ) or (
        ${table.status} = 'committed'
        and ${table.committedQuantity} is not null
        and ${table.completedAt} is not null
      ) or (
        ${table.status} in ('released', 'expired')
        and ${table.committedQuantity} is null
        and ${table.completedAt} is not null
      )`,
    ),
  ],
);

export const QUOTA_RESERVATION_EXPIRE_JOB_TYPE = "quota_reservation.expire";

export function quotaReservationExpiryJob(
  reservation: Readonly<{
    createdAt: Date;
    expiresAt: Date;
    id: string;
    organizationId: string;
    requestId: string;
  }>,
): typeof jobs.$inferInsert {
  return {
    createdAt: reservation.createdAt,
    nextAttemptAt: reservation.expiresAt,
    organizationId: reservation.organizationId,
    payload: {
      expiresAt: reservation.expiresAt.toISOString(),
      requestId: reservation.requestId,
      reservationId: reservation.id,
    },
    resourceId: reservation.id,
    resourceType: "quota_reservation",
    type: QUOTA_RESERVATION_EXPIRE_JOB_TYPE,
    updatedAt: reservation.createdAt,
  };
}
