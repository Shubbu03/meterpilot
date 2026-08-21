import type {
  EntitlementBalance,
  Feature,
  QuotaGrant,
  QuotaReservation,
} from "@meterpilot/contracts/entitlements";
import { MAX_EVENT_AGE_MS, MAX_EVENT_FUTURE_SKEW_MS } from "@meterpilot/contracts/events";
import type { Database } from "@meterpilot/db";
import {
  auditLog,
  customers,
  entitlements,
  features,
  jobs,
  meters,
  meterVersions,
  quotaGrants,
  quotaReservationExpiryJob,
  quotaReservations,
  usageEvents,
} from "@meterpilot/db/schema";
import { and, asc, desc, eq, gt, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";

import { hashUsageEvent } from "../events/canonicalization";
import { PROCESS_USAGE_EVENT_JOB_TYPE } from "../events/repository";
import { canManageEntitlements } from "../organizations/authorization";
import {
  InvalidFeatureCursorError,
  type EntitlementRepository,
  type ReservationAuthorization,
} from "./repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Transaction = Parameters<Parameters<Database["db"]["transaction"]>[0]>[0];
type SelectDatabase = Pick<Database["db"], "select"> | Pick<Transaction, "select">;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function encodeCursor(id: string): string {
  return Buffer.from(id).toString("base64url");
}

function decodeCursor(cursor?: string): string | undefined {
  if (!cursor) return undefined;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (Buffer.from(decoded).toString("base64url") !== cursor || !UUID_PATTERN.test(decoded)) {
    throw new InvalidFeatureCursorError();
  }
  return decoded;
}

function toFeature(
  row: Readonly<{
    createdAt: Date;
    id: string;
    key: string;
    meterKey: string | null;
    name: string;
    updatedAt: Date;
  }>,
): Feature {
  return {
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    key: row.key,
    meterKey: row.meterKey,
    name: row.name,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toGrant(row: typeof quotaGrants.$inferSelect): QuotaGrant {
  return {
    createdAt: row.createdAt.toISOString(),
    effectiveAt: row.effectiveAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    id: row.id,
    quantity: row.quantity,
    reason: row.reason,
  };
}

function reservationEventKey(reservationId: string): string {
  return `quota_reservation:${reservationId}`;
}

function toReservation(
  row: typeof quotaReservations.$inferSelect,
  customerKey: string,
  featureKey: string,
): QuotaReservation {
  return {
    committedQuantity: row.committedQuantity,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    customerKey,
    entitlementId: row.entitlementId,
    expiresAt: row.expiresAt.toISOString(),
    featureKey,
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    requestedQuantity: row.requestedQuantity,
    status: row.status,
    usageEventKey: row.status === "committed" ? reservationEventKey(row.id) : null,
  };
}

function activeGrantQuantity(at: Date) {
  return sql<string>`coalesce((
    select sum(${quotaGrants.quantity})
    from ${quotaGrants}
    where ${quotaGrants.organizationId} = ${entitlements.organizationId}
      and ${quotaGrants.entitlementId} = ${entitlements.id}
      and ${quotaGrants.effectiveAt} <= ${at}
      and (${quotaGrants.expiresAt} is null or ${quotaGrants.expiresAt} > ${at})
  ), 0)::text`;
}

async function selectBalance(
  database: SelectDatabase,
  organizationId: string,
  customerKey: string,
  featureKey: string,
  at: Date,
): Promise<EntitlementBalance | null> {
  const activeGranted = activeGrantQuantity(at);
  const [row] = await database
    .select({
      allowed: sql<boolean>`(
        ${entitlements.enabled}
        and (
          ${entitlements.mode} in ('boolean', 'advisory')
          or (${activeGranted})::numeric > ${entitlements.committedQuantity} + ${entitlements.reservedQuantity}
        )
      )`,
      availableQuantity: sql<string>`greatest(
        (${activeGranted})::numeric - ${entitlements.committedQuantity} - ${entitlements.reservedQuantity},
        0
      )::text`,
      committedQuantity: sql<string>`${entitlements.committedQuantity}::text`,
      customerKey: customers.externalKey,
      enabled: entitlements.enabled,
      featureKey: features.key,
      grantedQuantity: activeGranted,
      mode: entitlements.mode,
      overageQuantity: sql<string>`greatest(
        ${entitlements.committedQuantity} + ${entitlements.reservedQuantity} - (${activeGranted})::numeric,
        0
      )::text`,
      periodEnd: entitlements.periodEnd,
      periodStart: entitlements.periodStart,
      reservedQuantity: sql<string>`${entitlements.reservedQuantity}::text`,
      updatedAt: entitlements.updatedAt,
      version: entitlements.version,
    })
    .from(entitlements)
    .innerJoin(
      customers,
      and(
        eq(customers.organizationId, entitlements.organizationId),
        eq(customers.id, entitlements.customerId),
      ),
    )
    .innerJoin(
      features,
      and(
        eq(features.organizationId, entitlements.organizationId),
        eq(features.id, entitlements.featureId),
      ),
    )
    .where(
      and(
        eq(entitlements.organizationId, organizationId),
        eq(customers.externalKey, customerKey),
        eq(features.key, featureKey),
        lte(entitlements.periodStart, at),
        gt(entitlements.periodEnd, at),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    ...row,
    periodEnd: row.periodEnd.toISOString(),
    periodStart: row.periodStart.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function writeAudit(
  database: Transaction,
  input: Readonly<{
    action: string;
    actorApiKeyId?: string | null;
    actorUserId?: string | null;
    organizationId: string;
    requestId: string;
    resourceId: string;
    resourceType: string;
  }>,
) {
  await database.insert(auditLog).values({
    action: input.action,
    actorApiKeyId: input.actorApiKeyId ?? null,
    actorType: input.actorApiKeyId ? "api_key" : "user",
    actorUserId: input.actorUserId ?? null,
    organizationId: input.organizationId,
    requestId: input.requestId,
    resourceId: input.resourceId,
    resourceType: input.resourceType,
  });
}

function reservationTenant(authorization: ReservationAuthorization) {
  if ("apiKeyId" in authorization) {
    if (!authorization.scopes.includes("reservations:write")) {
      return null;
    }
    return {
      actorApiKeyId: authorization.apiKeyId,
      actorUserId: null,
      organization: { id: authorization.organizationId },
    } as const;
  }
  if (!canManageEntitlements(authorization.membership.role)) {
    return null;
  }
  return {
    actorApiKeyId: null,
    actorUserId: authorization.actorUserId,
    organization: { id: authorization.organization.id },
  } as const;
}

export function createDrizzleEntitlementRepository(
  database: Database["db"],
  now: () => Date = () => new Date(),
): EntitlementRepository {
  return {
    async addGrant(tenant, customerKey, featureKey, input, requestId) {
      if (!canManageEntitlements(tenant.membership.role)) {
        return { status: "forbidden" };
      }

      return database.transaction(async (transaction) => {
        const effectiveAt = new Date(input.effectiveAt);
        const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
        const [entitlement] = await transaction
          .select({
            id: entitlements.id,
            mode: entitlements.mode,
            periodEnd: entitlements.periodEnd,
          })
          .from(entitlements)
          .innerJoin(
            customers,
            and(
              eq(customers.organizationId, entitlements.organizationId),
              eq(customers.id, entitlements.customerId),
            ),
          )
          .innerJoin(
            features,
            and(
              eq(features.organizationId, entitlements.organizationId),
              eq(features.id, entitlements.featureId),
            ),
          )
          .where(
            and(
              eq(entitlements.organizationId, tenant.organization.id),
              eq(customers.externalKey, customerKey),
              eq(features.key, featureKey),
              lte(entitlements.periodStart, effectiveAt),
              gt(entitlements.periodEnd, effectiveAt),
            ),
          )
          .for("update")
          .limit(1);

        if (!entitlement) {
          return { status: "not_found" } as const;
        }
        if (
          entitlement.mode === "boolean" ||
          (expiresAt !== null && expiresAt > entitlement.periodEnd)
        ) {
          return { status: "conflict" } as const;
        }

        const [grant] = await transaction
          .insert(quotaGrants)
          .values({
            effectiveAt,
            entitlementId: entitlement.id,
            expiresAt,
            organizationId: tenant.organization.id,
            quantity: input.quantity,
            reason: input.reason,
          })
          .returning();
        if (!grant) {
          throw new Error("Quota grant insertion returned no row.");
        }

        const currentTime = now();
        const [active] = await transaction
          .select({ quantity: activeGrantQuantity(currentTime) })
          .from(entitlements)
          .where(
            and(
              eq(entitlements.organizationId, tenant.organization.id),
              eq(entitlements.id, entitlement.id),
            ),
          )
          .limit(1);
        if (!active) {
          throw new Error("Entitlement grant total was not available.");
        }
        await transaction
          .update(entitlements)
          .set({
            grantedQuantity: active.quantity,
            updatedAt: currentTime,
            version: sql`${entitlements.version} + 1`,
          })
          .where(
            and(
              eq(entitlements.organizationId, tenant.organization.id),
              eq(entitlements.id, entitlement.id),
            ),
          );
        await writeAudit(transaction, {
          action: "entitlement.grant_created",
          actorUserId: tenant.actorUserId,
          organizationId: tenant.organization.id,
          requestId,
          resourceId: grant.id,
          resourceType: "quota_grant",
        });

        const balance = await selectBalance(
          transaction,
          tenant.organization.id,
          customerKey,
          featureKey,
          currentTime,
        );
        if (!balance) {
          throw new Error("Granted entitlement balance was not available.");
        }

        return { entitlement: balance, grant: toGrant(grant), status: "ok" } as const;
      });
    },

    async commitReservation(authorization, reservationId, input, requestId) {
      const tenant = reservationTenant(authorization);
      if (!tenant) {
        return { status: "forbidden" };
      }

      const currentTime = now();
      const occurredAt = new Date(input.occurredAt);

      return database.transaction(async (transaction) => {
        const [context] = await transaction
          .select({
            actualWithinReservation: sql<boolean>`${input.quantity}::numeric <= ${quotaReservations.requestedQuantity}`,
            actualIsOne: sql<boolean>`${input.quantity}::numeric = 1`,
            customerId: customers.id,
            customerKey: customers.externalKey,
            entitlementPeriodEnd: entitlements.periodEnd,
            entitlementPeriodStart: entitlements.periodStart,
            featureKey: features.key,
            meterId: features.meterId,
            reservation: quotaReservations,
            sameCommittedQuantity: sql<boolean>`${quotaReservations.committedQuantity} = ${input.quantity}::numeric`,
          })
          .from(quotaReservations)
          .innerJoin(
            entitlements,
            and(
              eq(entitlements.organizationId, quotaReservations.organizationId),
              eq(entitlements.id, quotaReservations.entitlementId),
            ),
          )
          .innerJoin(
            customers,
            and(
              eq(customers.organizationId, entitlements.organizationId),
              eq(customers.id, entitlements.customerId),
            ),
          )
          .innerJoin(
            features,
            and(
              eq(features.organizationId, entitlements.organizationId),
              eq(features.id, entitlements.featureId),
            ),
          )
          .where(
            and(
              eq(quotaReservations.organizationId, tenant.organization.id),
              eq(quotaReservations.id, reservationId),
            ),
          )
          .for("update")
          .limit(1);
        if (!context) {
          return { status: "not_found" } as const;
        }

        await transaction
          .select({ id: entitlements.id })
          .from(entitlements)
          .where(
            and(
              eq(entitlements.organizationId, tenant.organization.id),
              eq(entitlements.id, context.reservation.entitlementId),
            ),
          )
          .for("update")
          .limit(1);

        if (context.reservation.status === "committed") {
          if (!context.sameCommittedQuantity) {
            return { status: "conflict" } as const;
          }
          const balance = await selectBalance(
            transaction,
            tenant.organization.id,
            context.customerKey,
            context.featureKey,
            currentTime,
          );
          if (!balance) {
            throw new Error("Committed reservation balance was not available.");
          }
          return {
            entitlement: balance,
            reservation: toReservation(
              context.reservation,
              context.customerKey,
              context.featureKey,
            ),
            status: "ok",
          } as const;
        }
        if (context.reservation.status !== "pending") {
          return {
            status: context.reservation.status === "expired" ? "expired" : "conflict",
          } as const;
        }
        if (context.reservation.expiresAt <= currentTime) {
          await transaction
            .update(entitlements)
            .set({
              reservedQuantity: sql`${entitlements.reservedQuantity} - ${context.reservation.requestedQuantity}::numeric`,
              updatedAt: currentTime,
              version: sql`${entitlements.version} + 1`,
            })
            .where(
              and(
                eq(entitlements.organizationId, tenant.organization.id),
                eq(entitlements.id, context.reservation.entitlementId),
              ),
            );
          await transaction
            .update(quotaReservations)
            .set({ completedAt: currentTime, status: "expired" })
            .where(
              and(
                eq(quotaReservations.organizationId, tenant.organization.id),
                eq(quotaReservations.id, reservationId),
              ),
            );
          await writeAudit(transaction, {
            action: "quota_reservation.expired",
            actorApiKeyId: tenant.actorApiKeyId,
            actorUserId: tenant.actorUserId,
            organizationId: tenant.organization.id,
            requestId,
            resourceId: reservationId,
            resourceType: "quota_reservation",
          });
          return { status: "expired" } as const;
        }
        if (
          !context.actualWithinReservation ||
          occurredAt.getTime() < currentTime.getTime() - MAX_EVENT_AGE_MS ||
          occurredAt.getTime() > currentTime.getTime() + MAX_EVENT_FUTURE_SKEW_MS ||
          occurredAt < context.entitlementPeriodStart ||
          occurredAt >= context.entitlementPeriodEnd ||
          !context.meterId
        ) {
          return { status: "conflict" } as const;
        }

        const [meter] = await transaction
          .select({
            aggregation: meterVersions.aggregation,
            eventType: meterVersions.eventType,
            valueProperty: meterVersions.valueProperty,
          })
          .from(meterVersions)
          .innerJoin(
            meters,
            and(
              eq(meters.organizationId, meterVersions.organizationId),
              eq(meters.id, meterVersions.meterId),
            ),
          )
          .where(
            and(
              eq(meterVersions.organizationId, tenant.organization.id),
              eq(meterVersions.meterId, context.meterId),
              eq(meters.status, "active"),
              isNotNull(meterVersions.publishedAt),
              lte(meterVersions.effectiveFrom, occurredAt),
              or(isNull(meterVersions.effectiveTo), gt(meterVersions.effectiveTo, occurredAt)),
            ),
          )
          .orderBy(desc(meterVersions.version))
          .limit(1);
        if (!meter || (meter.aggregation === "count" && !context.actualIsOne)) {
          return { status: "conflict" } as const;
        }

        const eventKey = reservationEventKey(context.reservation.id);
        const properties = {
          ...input.properties,
          ...(meter.valueProperty ? { [meter.valueProperty]: input.quantity } : {}),
          meterpilotReservationId: context.reservation.id,
        };
        const event = {
          id: eventKey,
          occurredAt: occurredAt.toISOString(),
          properties,
          subject: context.customerKey,
          type: meter.eventType,
        };
        const [createdEvent] = await transaction
          .insert(usageEvents)
          .values({
            customerId: context.customerId,
            eventKey,
            eventType: event.type,
            occurredAt,
            organizationId: tenant.organization.id,
            payloadHash: hashUsageEvent(event),
            properties,
            receivedAt: currentTime,
            source: "quota_reservation",
            sourceApiKeyId: null,
            subjectKey: context.customerKey,
          })
          .returning({ id: usageEvents.id });
        if (!createdEvent) {
          throw new Error("Committed reservation event insertion returned no row.");
        }
        await transaction.insert(jobs).values({
          createdAt: currentTime,
          eventId: createdEvent.id,
          nextAttemptAt: currentTime,
          organizationId: tenant.organization.id,
          payload: { eventId: createdEvent.id, eventKey, requestId },
          resourceId: createdEvent.id,
          resourceType: "usage_event",
          type: PROCESS_USAGE_EVENT_JOB_TYPE,
          updatedAt: currentTime,
        });
        await transaction
          .update(entitlements)
          .set({
            committedQuantity: sql`${entitlements.committedQuantity} + ${input.quantity}::numeric`,
            reservedQuantity: sql`${entitlements.reservedQuantity} - ${context.reservation.requestedQuantity}::numeric`,
            updatedAt: currentTime,
            version: sql`${entitlements.version} + 1`,
          })
          .where(
            and(
              eq(entitlements.organizationId, tenant.organization.id),
              eq(entitlements.id, context.reservation.entitlementId),
            ),
          );
        const [committed] = await transaction
          .update(quotaReservations)
          .set({
            committedQuantity: input.quantity,
            completedAt: currentTime,
            status: "committed",
          })
          .where(
            and(
              eq(quotaReservations.organizationId, tenant.organization.id),
              eq(quotaReservations.id, reservationId),
              eq(quotaReservations.status, "pending"),
            ),
          )
          .returning();
        if (!committed) {
          throw new Error("Pending reservation could not be committed.");
        }
        await writeAudit(transaction, {
          action: "quota_reservation.committed",
          actorApiKeyId: tenant.actorApiKeyId,
          actorUserId: tenant.actorUserId,
          organizationId: tenant.organization.id,
          requestId,
          resourceId: reservationId,
          resourceType: "quota_reservation",
        });

        const balance = await selectBalance(
          transaction,
          tenant.organization.id,
          context.customerKey,
          context.featureKey,
          currentTime,
        );
        if (!balance) {
          throw new Error("Committed reservation balance was not available.");
        }
        return {
          entitlement: balance,
          reservation: toReservation(committed, context.customerKey, context.featureKey),
          status: "ok",
        } as const;
      });
    },

    async reserve(authorization, customerKey, input, requestId) {
      const tenant = reservationTenant(authorization);
      if (!tenant) {
        return { status: "forbidden" };
      }

      const currentTime = now();
      const expiresAt = new Date(input.expiresAt);

      return database.transaction(async (transaction) => {
        const activeGranted = activeGrantQuantity(currentTime);
        const [entitlement] = await transaction
          .select({
            activeGranted,
            customerKey: customers.externalKey,
            enabled: entitlements.enabled,
            featureKey: features.key,
            hasCapacity: sql<boolean>`${activeGranted}::numeric >= ${entitlements.committedQuantity} + ${entitlements.reservedQuantity} + ${input.quantity}::numeric`,
            id: entitlements.id,
            mode: entitlements.mode,
            periodEnd: entitlements.periodEnd,
          })
          .from(entitlements)
          .innerJoin(
            customers,
            and(
              eq(customers.organizationId, entitlements.organizationId),
              eq(customers.id, entitlements.customerId),
            ),
          )
          .innerJoin(
            features,
            and(
              eq(features.organizationId, entitlements.organizationId),
              eq(features.id, entitlements.featureId),
            ),
          )
          .where(
            and(
              eq(entitlements.organizationId, tenant.organization.id),
              eq(customers.externalKey, customerKey),
              eq(features.key, input.featureKey),
              lte(entitlements.periodStart, currentTime),
              gt(entitlements.periodEnd, currentTime),
            ),
          )
          .for("update")
          .limit(1);
        if (!entitlement) {
          return { status: "not_found" } as const;
        }

        const [existing] = await transaction
          .select({
            reservation: quotaReservations,
            sameRequest: sql<boolean>`${quotaReservations.requestedQuantity} = ${input.quantity}::numeric and ${quotaReservations.expiresAt} = ${expiresAt}`,
          })
          .from(quotaReservations)
          .where(
            and(
              eq(quotaReservations.organizationId, tenant.organization.id),
              eq(quotaReservations.entitlementId, entitlement.id),
              eq(quotaReservations.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) {
          if (!existing.sameRequest) {
            return { status: "idempotency_conflict" } as const;
          }
          if (
            existing.reservation.status === "pending" &&
            existing.reservation.expiresAt <= currentTime
          ) {
            await transaction
              .update(entitlements)
              .set({
                grantedQuantity: entitlement.activeGranted,
                reservedQuantity: sql`${entitlements.reservedQuantity} - ${existing.reservation.requestedQuantity}::numeric`,
                updatedAt: currentTime,
                version: sql`${entitlements.version} + 1`,
              })
              .where(
                and(
                  eq(entitlements.organizationId, tenant.organization.id),
                  eq(entitlements.id, entitlement.id),
                ),
              );
            await transaction
              .update(quotaReservations)
              .set({ completedAt: currentTime, status: "expired" })
              .where(eq(quotaReservations.id, existing.reservation.id));
            await writeAudit(transaction, {
              action: "quota_reservation.expired",
              actorApiKeyId: tenant.actorApiKeyId,
              actorUserId: tenant.actorUserId,
              organizationId: tenant.organization.id,
              requestId,
              resourceId: existing.reservation.id,
              resourceType: "quota_reservation",
            });
            return { status: "expired" } as const;
          }
          const balance = await selectBalance(
            transaction,
            tenant.organization.id,
            customerKey,
            input.featureKey,
            currentTime,
          );
          if (!balance) {
            throw new Error("Existing reservation balance was not available.");
          }
          return {
            entitlement: balance,
            reservation: toReservation(existing.reservation, customerKey, input.featureKey),
            status: "ok",
          } as const;
        }
        if (
          !entitlement.enabled ||
          entitlement.mode !== "hard" ||
          expiresAt <= currentTime ||
          expiresAt > entitlement.periodEnd
        ) {
          return { status: "conflict" } as const;
        }
        if (!entitlement.hasCapacity) {
          return { status: "over_limit" } as const;
        }

        const [reservation] = await transaction
          .insert(quotaReservations)
          .values({
            createdAt: currentTime,
            entitlementId: entitlement.id,
            expiresAt,
            idempotencyKey: input.idempotencyKey,
            organizationId: tenant.organization.id,
            requestedQuantity: input.quantity,
          })
          .returning();
        if (!reservation) {
          throw new Error("Quota reservation insertion returned no row.");
        }
        await transaction
          .update(entitlements)
          .set({
            grantedQuantity: entitlement.activeGranted,
            reservedQuantity: sql`${entitlements.reservedQuantity} + ${input.quantity}::numeric`,
            updatedAt: currentTime,
            version: sql`${entitlements.version} + 1`,
          })
          .where(
            and(
              eq(entitlements.organizationId, tenant.organization.id),
              eq(entitlements.id, entitlement.id),
            ),
          );
        await transaction.insert(jobs).values(
          quotaReservationExpiryJob({
            createdAt: currentTime,
            expiresAt,
            id: reservation.id,
            organizationId: tenant.organization.id,
            requestId,
          }),
        );
        await writeAudit(transaction, {
          action: "quota_reservation.created",
          actorApiKeyId: tenant.actorApiKeyId,
          actorUserId: tenant.actorUserId,
          organizationId: tenant.organization.id,
          requestId,
          resourceId: reservation.id,
          resourceType: "quota_reservation",
        });

        const balance = await selectBalance(
          transaction,
          tenant.organization.id,
          customerKey,
          input.featureKey,
          currentTime,
        );
        if (!balance) {
          throw new Error("Reserved entitlement balance was not available.");
        }
        return {
          entitlement: balance,
          reservation: toReservation(reservation, customerKey, input.featureKey),
          status: "ok",
        } as const;
      });
    },

    async releaseReservation(authorization, reservationId, requestId) {
      const tenant = reservationTenant(authorization);
      if (!tenant) {
        return { status: "forbidden" };
      }

      const currentTime = now();
      return database.transaction(async (transaction) => {
        const [context] = await transaction
          .select({
            customerKey: customers.externalKey,
            featureKey: features.key,
            reservation: quotaReservations,
          })
          .from(quotaReservations)
          .innerJoin(
            entitlements,
            and(
              eq(entitlements.organizationId, quotaReservations.organizationId),
              eq(entitlements.id, quotaReservations.entitlementId),
            ),
          )
          .innerJoin(
            customers,
            and(
              eq(customers.organizationId, entitlements.organizationId),
              eq(customers.id, entitlements.customerId),
            ),
          )
          .innerJoin(
            features,
            and(
              eq(features.organizationId, entitlements.organizationId),
              eq(features.id, entitlements.featureId),
            ),
          )
          .where(
            and(
              eq(quotaReservations.organizationId, tenant.organization.id),
              eq(quotaReservations.id, reservationId),
            ),
          )
          .for("update")
          .limit(1);
        if (!context) {
          return { status: "not_found" } as const;
        }
        await transaction
          .select({ id: entitlements.id })
          .from(entitlements)
          .where(
            and(
              eq(entitlements.organizationId, tenant.organization.id),
              eq(entitlements.id, context.reservation.entitlementId),
            ),
          )
          .for("update")
          .limit(1);

        if (context.reservation.status === "committed") {
          return { status: "conflict" } as const;
        }
        if (context.reservation.status === "expired") {
          return { status: "expired" } as const;
        }

        let reservation = context.reservation;
        if (reservation.status === "pending") {
          await transaction
            .update(entitlements)
            .set({
              reservedQuantity: sql`${entitlements.reservedQuantity} - ${reservation.requestedQuantity}::numeric`,
              updatedAt: currentTime,
              version: sql`${entitlements.version} + 1`,
            })
            .where(
              and(
                eq(entitlements.organizationId, tenant.organization.id),
                eq(entitlements.id, reservation.entitlementId),
              ),
            );
          const [released] = await transaction
            .update(quotaReservations)
            .set({ completedAt: currentTime, status: "released" })
            .where(
              and(
                eq(quotaReservations.organizationId, tenant.organization.id),
                eq(quotaReservations.id, reservationId),
                eq(quotaReservations.status, "pending"),
              ),
            )
            .returning();
          if (!released) {
            throw new Error("Pending reservation could not be released.");
          }
          reservation = released;
          await writeAudit(transaction, {
            action: "quota_reservation.released",
            actorApiKeyId: tenant.actorApiKeyId,
            actorUserId: tenant.actorUserId,
            organizationId: tenant.organization.id,
            requestId,
            resourceId: reservationId,
            resourceType: "quota_reservation",
          });
        }

        const balance = await selectBalance(
          transaction,
          tenant.organization.id,
          context.customerKey,
          context.featureKey,
          currentTime,
        );
        if (!balance) {
          throw new Error("Released reservation balance was not available.");
        }
        return {
          entitlement: balance,
          reservation: toReservation(reservation, context.customerKey, context.featureKey),
          status: "ok",
        } as const;
      });
    },

    async configure(tenant, customerKey, featureKey, input, requestId) {
      if (!canManageEntitlements(tenant.membership.role)) {
        return { status: "forbidden" };
      }

      try {
        return await database.transaction(async (transaction) => {
          const [customer] = await transaction
            .select({ id: customers.id })
            .from(customers)
            .where(
              and(
                eq(customers.organizationId, tenant.organization.id),
                eq(customers.externalKey, customerKey),
                isNull(customers.archivedAt),
              ),
            )
            .for("update")
            .limit(1);
          const [feature] = await transaction
            .select({ id: features.id })
            .from(features)
            .where(
              and(
                eq(features.organizationId, tenant.organization.id),
                eq(features.key, featureKey),
              ),
            )
            .for("update")
            .limit(1);
          if (!customer || !feature) {
            return { status: "not_found" } as const;
          }

          const periodStart = new Date(input.periodStart);
          const periodEnd = new Date(input.periodEnd);
          const [overlap] = await transaction
            .select({ id: entitlements.id })
            .from(entitlements)
            .where(
              and(
                eq(entitlements.organizationId, tenant.organization.id),
                eq(entitlements.customerId, customer.id),
                eq(entitlements.featureId, feature.id),
                lt(entitlements.periodStart, periodEnd),
                gt(entitlements.periodEnd, periodStart),
              ),
            )
            .limit(1);
          if (overlap) {
            return { status: "conflict" } as const;
          }

          const [created] = await transaction
            .insert(entitlements)
            .values({
              customerId: customer.id,
              enabled: input.enabled,
              featureId: feature.id,
              mode: input.mode,
              organizationId: tenant.organization.id,
              periodEnd,
              periodStart,
            })
            .returning({ id: entitlements.id });
          if (!created) {
            throw new Error("Entitlement insertion returned no row.");
          }
          await writeAudit(transaction, {
            action: "entitlement.configured",
            actorUserId: tenant.actorUserId,
            organizationId: tenant.organization.id,
            requestId,
            resourceId: created.id,
            resourceType: "entitlement",
          });

          const balance = await selectBalance(
            transaction,
            tenant.organization.id,
            customerKey,
            featureKey,
            periodStart,
          );
          if (!balance) {
            throw new Error("Configured entitlement balance was not available.");
          }
          return { entitlement: balance, status: "ok" } as const;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { status: "conflict" };
        }
        throw error;
      }
    },

    async createFeature(tenant, input, requestId) {
      if (!canManageEntitlements(tenant.membership.role)) {
        return { status: "forbidden" };
      }

      try {
        return await database.transaction(async (transaction) => {
          let meterId: string | null = null;
          if (input.meterKey) {
            const [meter] = await transaction
              .select({ id: meters.id })
              .from(meters)
              .where(
                and(
                  eq(meters.organizationId, tenant.organization.id),
                  eq(meters.key, input.meterKey),
                ),
              )
              .limit(1);
            if (!meter) {
              return { status: "not_found" } as const;
            }
            meterId = meter.id;
          }

          const [feature] = await transaction
            .insert(features)
            .values({
              key: input.key,
              meterId,
              name: input.name,
              organizationId: tenant.organization.id,
            })
            .returning();
          if (!feature) {
            throw new Error("Feature insertion returned no row.");
          }
          await writeAudit(transaction, {
            action: "feature.created",
            actorUserId: tenant.actorUserId,
            organizationId: tenant.organization.id,
            requestId,
            resourceId: feature.id,
            resourceType: "feature",
          });

          return {
            feature: toFeature({ ...feature, meterKey: input.meterKey }),
            status: "ok",
          } as const;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { status: "conflict" };
        }
        throw error;
      }
    },

    findBalance(organizationId, customerKey, featureKey, at) {
      return selectBalance(database, organizationId, customerKey, featureKey, at);
    },

    async listFeatures(tenant, page) {
      const cursor = decodeCursor(page.cursor);
      const rows = await database
        .select({
          createdAt: features.createdAt,
          id: features.id,
          key: features.key,
          meterKey: meters.key,
          name: features.name,
          updatedAt: features.updatedAt,
        })
        .from(features)
        .leftJoin(
          meters,
          and(eq(meters.organizationId, features.organizationId), eq(meters.id, features.meterId)),
        )
        .where(
          and(
            eq(features.organizationId, tenant.organization.id),
            cursor ? gt(features.id, cursor) : undefined,
          ),
        )
        .orderBy(asc(features.id))
        .limit(page.limit + 1);
      const hasNext = rows.length > page.limit;
      const items = rows.slice(0, page.limit).map(toFeature);
      const last = items.at(-1);
      return {
        items,
        nextCursor: hasNext && last ? encodeCursor(last.id) : null,
      };
    },
  };
}
