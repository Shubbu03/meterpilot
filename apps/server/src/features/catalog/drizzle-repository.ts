import {
  planComponentSchema,
  planSchema,
  planVersionSchema,
  subscriptionSchema,
  type CreatePlanVersionRequest,
  type Plan,
  type PlanComponent,
  type PlanVersion,
  type Subscription,
} from "@meterpilot/contracts/catalog";
import type { Database } from "@meterpilot/db";
import {
  auditLog,
  customers,
  entitlements,
  features,
  jobs,
  planComponents,
  plans,
  planVersions,
  quotaGrants,
  subscriptionEntitlementRefreshJob,
  subscriptions,
} from "@meterpilot/db/schema";
import { billingPeriodAt, halfOpenInterval, instant, planVersionId } from "@meterpilot/domain";
import { price } from "@meterpilot/pricing-engine";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";

import { canManageCatalog } from "../organizations/authorization";
import type { CatalogRepository } from "./repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALIDATION_PERIOD = halfOpenInterval(
  instant("2000-01-01T00:00:00.000Z"),
  instant("2000-02-01T00:00:00.000Z"),
);

type Transaction = Parameters<Parameters<Database["db"]["transaction"]>[0]>[0];
type PlanRow = typeof plans.$inferSelect;
type PlanVersionRow = typeof planVersions.$inferSelect;
type PlanComponentRow = typeof planComponents.$inferSelect;

function isZeroDecimal(value: string): boolean {
  return /^0(?:\.0+)?$/.test(value);
}

export class InvalidCatalogCursorError extends Error {
  constructor() {
    super("The pagination cursor is invalid.");
    this.name = "InvalidCatalogCursorError";
  }
}

function encodeCursor(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) {
    return undefined;
  }
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (!UUID_PATTERN.test(decoded)) {
    throw new InvalidCatalogCursorError();
  }
  return decoded;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function validatePricing(input: CreatePlanVersionRequest): void {
  price({
    components: input.components.map((component) => ({
      componentKey: component.componentKey,
      price: component.price,
      quantity: "0",
    })),
    currency: input.currency,
    period: VALIDATION_PERIOD,
    planVersionId: planVersionId("catalog_validation"),
    rounding: { minorUnitScale: 2, mode: "half_away_from_zero" },
  });

  for (const component of input.components) {
    price({
      components: [
        {
          componentKey: component.componentKey,
          price: component.price,
          quantity: "0",
        },
      ],
      currency: input.currency,
      period: VALIDATION_PERIOD,
      planVersionId: planVersionId("catalog_validation"),
      rounding: component.rounding,
    });
  }
}

function toPlanComponent(row: PlanComponentRow, featureKey: string | null): PlanComponent {
  return planComponentSchema.parse({
    billingInterval: row.billingInterval,
    componentKey: row.componentKey,
    createdAt: row.createdAt.toISOString(),
    entitlement: row.entitlementDefinition,
    featureKey,
    id: row.id,
    price: row.pricingDefinition,
    rounding: row.roundingDefinition,
  });
}

function toPlanVersion(
  row: PlanVersionRow,
  components: readonly Readonly<{ featureKey: string | null; row: PlanComponentRow }>[],
): PlanVersion {
  return planVersionSchema.parse({
    archivedAt: row.archivedAt?.toISOString() ?? null,
    components: components.map((component) => toPlanComponent(component.row, component.featureKey)),
    createdAt: row.createdAt.toISOString(),
    currency: row.currency,
    effectiveFrom: row.effectiveFrom.toISOString(),
    id: row.id,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    status: row.status,
    version: row.version,
  });
}

function toPlan(
  row: PlanRow,
  versions: readonly PlanVersionRow[],
  components: readonly Readonly<{ featureKey: string | null; row: PlanComponentRow }>[],
): Plan {
  return planSchema.parse({
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    key: row.key,
    name: row.name,
    updatedAt: row.updatedAt.toISOString(),
    versions: versions.map((version) =>
      toPlanVersion(
        version,
        components.filter((component) => component.row.planVersionId === version.id),
      ),
    ),
  });
}

function toSubscription(
  row: typeof subscriptions.$inferSelect,
  customerKey: string,
  planKey: string,
  version: number,
): Subscription {
  return subscriptionSchema.parse({
    billingAnchor: row.billingAnchor.toISOString(),
    canceledAt: row.canceledAt?.toISOString() ?? null,
    commercialSlot: row.commercialSlot,
    createdAt: row.createdAt.toISOString(),
    customerKey,
    endsAt: row.endsAt?.toISOString() ?? null,
    id: row.id,
    planKey,
    planVersion: version,
    planVersionId: row.planVersionId,
    startsAt: row.startsAt.toISOString(),
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  });
}

async function loadComponents(
  database: Database["db"] | Transaction,
  organizationId: string,
  versionIds: readonly string[],
) {
  if (versionIds.length === 0) {
    return [];
  }
  return database
    .select({ featureKey: features.key, row: planComponents })
    .from(planComponents)
    .leftJoin(
      features,
      and(
        eq(features.organizationId, planComponents.organizationId),
        eq(features.id, planComponents.featureId),
      ),
    )
    .where(
      and(
        eq(planComponents.organizationId, organizationId),
        inArray(planComponents.planVersionId, versionIds),
      ),
    )
    .orderBy(asc(planComponents.planVersionId), asc(planComponents.componentKey));
}

async function loadPlan(
  database: Database["db"] | Transaction,
  organizationId: string,
  planId: string,
): Promise<Plan | null> {
  const [plan] = await database
    .select()
    .from(plans)
    .where(and(eq(plans.organizationId, organizationId), eq(plans.id, planId)))
    .limit(1);
  if (!plan) {
    return null;
  }
  const versions = await database
    .select()
    .from(planVersions)
    .where(and(eq(planVersions.organizationId, organizationId), eq(planVersions.planId, planId)))
    .orderBy(asc(planVersions.version));
  return toPlan(
    plan,
    versions,
    await loadComponents(
      database,
      organizationId,
      versions.map((version) => version.id),
    ),
  );
}

async function writeAudit(
  database: Transaction,
  input: Readonly<{
    action: string;
    actorUserId: string;
    organizationId: string;
    requestId: string;
    resourceId: string;
    resourceType: "plan" | "plan_version" | "subscription";
  }>,
): Promise<void> {
  await database.insert(auditLog).values({
    action: input.action,
    actorType: "user",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    requestId: input.requestId,
    resourceId: input.resourceId,
    resourceType: input.resourceType,
  });
}

async function materializeInitialEntitlements(
  transaction: Transaction,
  input: Readonly<{
    billingAnchor: Date;
    billingTimezone: string;
    components: readonly PlanComponentRow[];
    createdAt: Date;
    customerId: string;
    endsAt: Date | null;
    organizationId: string;
    requestId: string;
    startsAt: Date;
    subscriptionId: string;
  }>,
): Promise<void> {
  const entitlementComponents = input.components.filter(
    (component) => component.featureId && component.entitlementDefinition,
  );
  if (entitlementComponents.length === 0) {
    return;
  }

  const period = billingPeriodAt({
    at: input.startsAt,
    billingAnchor: input.billingAnchor,
    subscriptionEnd: input.endsAt,
    subscriptionStart: input.startsAt,
    timeZone: input.billingTimezone,
  });

  for (const component of entitlementComponents) {
    const definition = component.entitlementDefinition;
    if (!component.featureId || !definition) {
      continue;
    }
    const [entitlement] = await transaction
      .insert(entitlements)
      .values({
        customerId: input.customerId,
        enabled: definition.enabled,
        featureId: component.featureId,
        grantedQuantity: definition.quantity,
        mode: definition.mode,
        organizationId: input.organizationId,
        periodEnd: period.end,
        periodStart: period.start,
        subscriptionId: input.subscriptionId,
      })
      .returning({ id: entitlements.id });
    if (!entitlement) {
      throw new Error("Subscription entitlement insertion returned no row.");
    }
    if (definition.mode !== "boolean" && !isZeroDecimal(definition.quantity)) {
      await transaction.insert(quotaGrants).values({
        effectiveAt: period.start,
        entitlementId: entitlement.id,
        expiresAt: period.end,
        organizationId: input.organizationId,
        quantity: definition.quantity,
        reason: `Plan subscription ${input.subscriptionId}`,
      });
    }
  }

  if (!input.endsAt || period.nextCycleStart < input.endsAt) {
    await transaction.insert(jobs).values(
      subscriptionEntitlementRefreshJob({
        createdAt: input.createdAt,
        organizationId: input.organizationId,
        periodStart: period.nextCycleStart,
        requestId: input.requestId,
        subscriptionId: input.subscriptionId,
      }),
    );
  }
}

export function createDrizzleCatalogRepository(
  database: Database["db"],
  now: () => Date = () => new Date(),
): CatalogRepository {
  return {
    async archivePlan(tenant, planKey, requestId) {
      if (!canManageCatalog(tenant.membership.role)) {
        return { status: "forbidden" };
      }
      return database.transaction(async (transaction) => {
        const [plan] = await transaction
          .select()
          .from(plans)
          .where(and(eq(plans.organizationId, tenant.organization.id), eq(plans.key, planKey)))
          .for("update")
          .limit(1);
        if (!plan) {
          return { status: "not_found" } as const;
        }
        if (!plan.archivedAt) {
          const archivedAt = new Date();
          await transaction
            .update(plans)
            .set({ archivedAt, updatedAt: archivedAt })
            .where(and(eq(plans.organizationId, tenant.organization.id), eq(plans.id, plan.id)));
          await writeAudit(transaction, {
            action: "plan.archived",
            actorUserId: tenant.actorUserId,
            organizationId: tenant.organization.id,
            requestId,
            resourceId: plan.id,
            resourceType: "plan",
          });
        }
        const loaded = await loadPlan(transaction, tenant.organization.id, plan.id);
        if (!loaded) {
          throw new Error("Archived plan was not available.");
        }
        return { plan: loaded, status: "ok" } as const;
      });
    },

    async archiveVersion(tenant, planKey, version, requestId) {
      if (!canManageCatalog(tenant.membership.role)) {
        return { status: "forbidden" };
      }
      return database.transaction(async (transaction) => {
        const [selected] = await transaction
          .select({ plan: plans, version: planVersions })
          .from(plans)
          .innerJoin(
            planVersions,
            and(
              eq(planVersions.organizationId, plans.organizationId),
              eq(planVersions.planId, plans.id),
            ),
          )
          .where(
            and(
              eq(plans.organizationId, tenant.organization.id),
              eq(plans.key, planKey),
              eq(planVersions.version, version),
            ),
          )
          .for("update")
          .limit(1);
        if (!selected) {
          return { status: "not_found" } as const;
        }
        if (selected.version.status === "draft") {
          return { status: "conflict" } as const;
        }
        let archived = selected.version;
        if (selected.version.status === "published") {
          const [updated] = await transaction
            .update(planVersions)
            .set({ archivedAt: new Date(), status: "archived" })
            .where(
              and(
                eq(planVersions.organizationId, tenant.organization.id),
                eq(planVersions.id, selected.version.id),
              ),
            )
            .returning();
          if (!updated) {
            throw new Error("Archived plan version was not returned.");
          }
          archived = updated;
          await writeAudit(transaction, {
            action: "plan.version_archived",
            actorUserId: tenant.actorUserId,
            organizationId: tenant.organization.id,
            requestId,
            resourceId: archived.id,
            resourceType: "plan_version",
          });
        }
        return {
          planVersion: toPlanVersion(
            archived,
            await loadComponents(transaction, tenant.organization.id, [archived.id]),
          ),
          status: "ok",
        } as const;
      });
    },

    async cancelSubscription(tenant, subscriptionId, input, requestId) {
      if (!canManageCatalog(tenant.membership.role)) {
        return { status: "forbidden" };
      }
      const endsAt = new Date(input.endsAt);
      if (endsAt < now()) {
        return { status: "conflict" };
      }
      return database.transaction(async (transaction) => {
        const [selected] = await transaction
          .select({
            customerKey: customers.externalKey,
            planKey: plans.key,
            row: subscriptions,
            version: planVersions.version,
          })
          .from(subscriptions)
          .innerJoin(
            customers,
            and(
              eq(customers.organizationId, subscriptions.organizationId),
              eq(customers.id, subscriptions.customerId),
            ),
          )
          .innerJoin(
            planVersions,
            and(
              eq(planVersions.organizationId, subscriptions.organizationId),
              eq(planVersions.id, subscriptions.planVersionId),
            ),
          )
          .innerJoin(
            plans,
            and(
              eq(plans.organizationId, planVersions.organizationId),
              eq(plans.id, planVersions.planId),
            ),
          )
          .where(
            and(
              eq(subscriptions.organizationId, tenant.organization.id),
              eq(subscriptions.id, subscriptionId),
            ),
          )
          .for("update")
          .limit(1);
        if (!selected) {
          return { status: "not_found" } as const;
        }
        if (endsAt <= selected.row.startsAt) {
          return { status: "conflict" } as const;
        }
        if (selected.row.status === "canceled") {
          if (selected.row.endsAt?.getTime() !== endsAt.getTime()) {
            return { status: "conflict" } as const;
          }
          return {
            status: "ok",
            subscription: toSubscription(
              selected.row,
              selected.customerKey,
              selected.planKey,
              selected.version,
            ),
          } as const;
        }
        const canceledAt = now();
        const [canceled] = await transaction
          .update(subscriptions)
          .set({ canceledAt, endsAt, status: "canceled", updatedAt: canceledAt })
          .where(
            and(
              eq(subscriptions.organizationId, tenant.organization.id),
              eq(subscriptions.id, subscriptionId),
              eq(subscriptions.status, "active"),
            ),
          )
          .returning();
        if (!canceled) {
          throw new Error("Canceled subscription was not returned.");
        }
        const affectedEntitlements = await transaction
          .select({ id: entitlements.id })
          .from(entitlements)
          .where(
            and(
              eq(entitlements.organizationId, tenant.organization.id),
              eq(entitlements.subscriptionId, subscriptionId),
              lt(entitlements.periodStart, endsAt),
              gt(entitlements.periodEnd, endsAt),
            ),
          );
        if (affectedEntitlements.length > 0) {
          await transaction
            .update(quotaGrants)
            .set({ expiresAt: endsAt })
            .where(
              and(
                eq(quotaGrants.organizationId, tenant.organization.id),
                inArray(
                  quotaGrants.entitlementId,
                  affectedEntitlements.map((entitlement) => entitlement.id),
                ),
                gt(quotaGrants.expiresAt, endsAt),
              ),
            );
          await transaction
            .update(entitlements)
            .set({ periodEnd: endsAt, updatedAt: canceledAt })
            .where(
              and(
                eq(entitlements.organizationId, tenant.organization.id),
                inArray(
                  entitlements.id,
                  affectedEntitlements.map((entitlement) => entitlement.id),
                ),
              ),
            );
        }
        await writeAudit(transaction, {
          action: "subscription.canceled",
          actorUserId: tenant.actorUserId,
          organizationId: tenant.organization.id,
          requestId,
          resourceId: subscriptionId,
          resourceType: "subscription",
        });
        return {
          status: "ok",
          subscription: toSubscription(
            canceled,
            selected.customerKey,
            selected.planKey,
            selected.version,
          ),
        } as const;
      });
    },

    async createPlan(tenant, input, requestId) {
      if (!canManageCatalog(tenant.membership.role)) {
        return { status: "forbidden" };
      }
      try {
        return await database.transaction(async (transaction) => {
          const [created] = await transaction
            .insert(plans)
            .values({ key: input.key, name: input.name, organizationId: tenant.organization.id })
            .returning();
          if (!created) {
            throw new Error("Plan insertion returned no row.");
          }
          await writeAudit(transaction, {
            action: "plan.created",
            actorUserId: tenant.actorUserId,
            organizationId: tenant.organization.id,
            requestId,
            resourceId: created.id,
            resourceType: "plan",
          });
          return { plan: toPlan(created, [], []), status: "ok" } as const;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { status: "conflict" };
        }
        throw error;
      }
    },

    async createSubscription(tenant, input, requestId) {
      if (!canManageCatalog(tenant.membership.role)) {
        return { status: "forbidden" };
      }
      const startsAt = new Date(input.startsAt);
      const endsAt = input.endsAt ? new Date(input.endsAt) : null;
      const billingAnchor = new Date(input.billingAnchor);
      return database.transaction(async (transaction) => {
        const [customer] = await transaction
          .select({ billingTimezone: customers.billingTimezone, id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.organizationId, tenant.organization.id),
              eq(customers.externalKey, input.customerKey),
              isNull(customers.archivedAt),
            ),
          )
          .for("update")
          .limit(1);
        const [version] = await transaction
          .select({
            effectiveFrom: planVersions.effectiveFrom,
            id: planVersions.id,
            planKey: plans.key,
            version: planVersions.version,
          })
          .from(planVersions)
          .innerJoin(
            plans,
            and(
              eq(plans.organizationId, planVersions.organizationId),
              eq(plans.id, planVersions.planId),
            ),
          )
          .where(
            and(
              eq(planVersions.organizationId, tenant.organization.id),
              eq(plans.key, input.planKey),
              eq(planVersions.version, input.planVersion),
              eq(planVersions.status, "published"),
              isNull(plans.archivedAt),
            ),
          )
          .limit(1);
        if (!customer || !version) {
          return { status: "not_found" } as const;
        }
        if (startsAt < version.effectiveFrom) {
          return { status: "conflict" } as const;
        }
        const [overlap] = await transaction
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.organizationId, tenant.organization.id),
              eq(subscriptions.customerId, customer.id),
              eq(subscriptions.commercialSlot, input.commercialSlot),
              endsAt ? lt(subscriptions.startsAt, endsAt) : undefined,
              or(isNull(subscriptions.endsAt), gt(subscriptions.endsAt, startsAt)),
            ),
          )
          .limit(1);
        if (overlap) {
          return { status: "conflict" } as const;
        }
        const [created] = await transaction
          .insert(subscriptions)
          .values({
            billingAnchor,
            commercialSlot: input.commercialSlot,
            customerId: customer.id,
            endsAt,
            organizationId: tenant.organization.id,
            planVersionId: version.id,
            startsAt,
          })
          .returning();
        if (!created) {
          throw new Error("Subscription insertion returned no row.");
        }
        const componentRows = await transaction
          .select()
          .from(planComponents)
          .where(
            and(
              eq(planComponents.organizationId, tenant.organization.id),
              eq(planComponents.planVersionId, version.id),
            ),
          );
        const createdAt = now();
        await materializeInitialEntitlements(transaction, {
          billingAnchor,
          billingTimezone: customer.billingTimezone,
          components: componentRows,
          createdAt,
          customerId: customer.id,
          endsAt,
          organizationId: tenant.organization.id,
          requestId,
          startsAt,
          subscriptionId: created.id,
        });
        await writeAudit(transaction, {
          action: "subscription.created",
          actorUserId: tenant.actorUserId,
          organizationId: tenant.organization.id,
          requestId,
          resourceId: created.id,
          resourceType: "subscription",
        });
        return {
          status: "ok",
          subscription: toSubscription(
            created,
            input.customerKey,
            version.planKey,
            version.version,
          ),
        } as const;
      });
    },

    async createVersion(tenant, planKey, input, requestId) {
      if (!canManageCatalog(tenant.membership.role)) {
        return { status: "forbidden" };
      }
      try {
        validatePricing(input);
      } catch {
        return { status: "conflict" };
      }
      try {
        return await database.transaction(async (transaction) => {
          const [plan] = await transaction
            .select()
            .from(plans)
            .where(and(eq(plans.organizationId, tenant.organization.id), eq(plans.key, planKey)))
            .for("update")
            .limit(1);
          if (!plan) {
            return { status: "not_found" } as const;
          }
          if (plan.archivedAt) {
            return { status: "conflict" } as const;
          }
          const featureKeys = [
            ...new Set(
              input.components.flatMap((component) =>
                component.featureKey ? [component.featureKey] : [],
              ),
            ),
          ];
          const featureRows =
            featureKeys.length === 0
              ? []
              : await transaction
                  .select({ id: features.id, key: features.key, meterId: features.meterId })
                  .from(features)
                  .where(
                    and(
                      eq(features.organizationId, tenant.organization.id),
                      inArray(features.key, featureKeys),
                    ),
                  );
          if (featureRows.length !== featureKeys.length) {
            return { status: "not_found" } as const;
          }
          if (
            input.components.some(
              (component) =>
                component.price.model !== "flat" &&
                !featureRows.find((feature) => feature.key === component.featureKey)?.meterId,
            )
          ) {
            return { status: "conflict" } as const;
          }
          const [latest] = await transaction
            .select({ version: planVersions.version })
            .from(planVersions)
            .where(
              and(
                eq(planVersions.organizationId, tenant.organization.id),
                eq(planVersions.planId, plan.id),
              ),
            )
            .orderBy(desc(planVersions.version))
            .limit(1);
          const [created] = await transaction
            .insert(planVersions)
            .values({
              currency: input.currency,
              effectiveFrom: new Date(input.effectiveFrom),
              organizationId: tenant.organization.id,
              planId: plan.id,
              version: (latest?.version ?? 0) + 1,
            })
            .returning();
          if (!created) {
            throw new Error("Plan version insertion returned no row.");
          }
          const insertedComponents = await transaction
            .insert(planComponents)
            .values(
              input.components.map((component) => ({
                billingInterval: component.billingInterval,
                componentKey: component.componentKey,
                componentType: component.price.model,
                entitlementDefinition: component.entitlement,
                featureId:
                  featureRows.find((feature) => feature.key === component.featureKey)?.id ?? null,
                organizationId: tenant.organization.id,
                planVersionId: created.id,
                pricingDefinition: component.price,
                roundingDefinition: component.rounding,
              })),
            )
            .returning();
          if (insertedComponents.length !== input.components.length) {
            throw new Error("Not all plan components were inserted.");
          }
          await writeAudit(transaction, {
            action: "plan.version_created",
            actorUserId: tenant.actorUserId,
            organizationId: tenant.organization.id,
            requestId,
            resourceId: created.id,
            resourceType: "plan_version",
          });
          return {
            planVersion: toPlanVersion(
              created,
              insertedComponents.map((row) => ({
                featureKey:
                  featureRows.find((feature) => feature.id === row.featureId)?.key ?? null,
                row,
              })),
            ),
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

    async findPlan(organizationId, planKey) {
      const [plan] = await database
        .select({ id: plans.id })
        .from(plans)
        .where(and(eq(plans.organizationId, organizationId), eq(plans.key, planKey)))
        .limit(1);
      return plan ? loadPlan(database, organizationId, plan.id) : null;
    },

    async listPlans(tenant, page) {
      const cursor = decodeCursor(page.cursor);
      const rows = await database
        .select()
        .from(plans)
        .where(
          and(
            eq(plans.organizationId, tenant.organization.id),
            cursor ? gt(plans.id, cursor) : undefined,
          ),
        )
        .orderBy(asc(plans.id))
        .limit(page.limit + 1);
      const visible = rows.slice(0, page.limit);
      const versions =
        visible.length === 0
          ? []
          : await database
              .select()
              .from(planVersions)
              .where(
                and(
                  eq(planVersions.organizationId, tenant.organization.id),
                  inArray(
                    planVersions.planId,
                    visible.map((plan) => plan.id),
                  ),
                ),
              )
              .orderBy(asc(planVersions.planId), asc(planVersions.version));
      const components = await loadComponents(
        database,
        tenant.organization.id,
        versions.map((version) => version.id),
      );
      const last = visible.at(-1);
      return {
        items: visible.map((plan) =>
          toPlan(
            plan,
            versions.filter((version) => version.planId === plan.id),
            components.filter((component) =>
              versions.some(
                (version) =>
                  version.planId === plan.id && version.id === component.row.planVersionId,
              ),
            ),
          ),
        ),
        nextCursor: rows.length > page.limit && last ? encodeCursor(last.id) : null,
      };
    },

    async listSubscriptions(tenant, page) {
      const cursor = decodeCursor(page.cursor);
      const rows = await database
        .select({
          customerKey: customers.externalKey,
          planKey: plans.key,
          row: subscriptions,
          version: planVersions.version,
        })
        .from(subscriptions)
        .innerJoin(
          customers,
          and(
            eq(customers.organizationId, subscriptions.organizationId),
            eq(customers.id, subscriptions.customerId),
          ),
        )
        .innerJoin(
          planVersions,
          and(
            eq(planVersions.organizationId, subscriptions.organizationId),
            eq(planVersions.id, subscriptions.planVersionId),
          ),
        )
        .innerJoin(
          plans,
          and(
            eq(plans.organizationId, planVersions.organizationId),
            eq(plans.id, planVersions.planId),
          ),
        )
        .where(
          and(
            eq(subscriptions.organizationId, tenant.organization.id),
            cursor ? gt(subscriptions.id, cursor) : undefined,
          ),
        )
        .orderBy(asc(subscriptions.id))
        .limit(page.limit + 1);
      const visible = rows.slice(0, page.limit);
      const last = visible.at(-1);
      return {
        items: visible.map((item) =>
          toSubscription(item.row, item.customerKey, item.planKey, item.version),
        ),
        nextCursor: rows.length > page.limit && last ? encodeCursor(last.row.id) : null,
      };
    },

    async publishVersion(tenant, planKey, version, requestId) {
      if (!canManageCatalog(tenant.membership.role)) {
        return { status: "forbidden" };
      }
      return database.transaction(async (transaction) => {
        const [selected] = await transaction
          .select({ plan: plans, version: planVersions })
          .from(plans)
          .innerJoin(
            planVersions,
            and(
              eq(planVersions.organizationId, plans.organizationId),
              eq(planVersions.planId, plans.id),
            ),
          )
          .where(
            and(
              eq(plans.organizationId, tenant.organization.id),
              eq(plans.key, planKey),
              eq(planVersions.version, version),
            ),
          )
          .for("update")
          .limit(1);
        if (!selected) {
          return { status: "not_found" } as const;
        }
        if (selected.plan.archivedAt || selected.version.status === "archived") {
          return { status: "conflict" } as const;
        }
        let published = selected.version;
        if (selected.version.status === "draft") {
          const [updated] = await transaction
            .update(planVersions)
            .set({ publishedAt: new Date(), status: "published" })
            .where(
              and(
                eq(planVersions.organizationId, tenant.organization.id),
                eq(planVersions.id, selected.version.id),
                eq(planVersions.status, "draft"),
              ),
            )
            .returning();
          if (!updated) {
            throw new Error("Published plan version was not returned.");
          }
          published = updated;
          await writeAudit(transaction, {
            action: "plan.version_published",
            actorUserId: tenant.actorUserId,
            organizationId: tenant.organization.id,
            requestId,
            resourceId: published.id,
            resourceType: "plan_version",
          });
        }
        return {
          planVersion: toPlanVersion(
            published,
            await loadComponents(transaction, tenant.organization.id, [published.id]),
          ),
          status: "ok",
        } as const;
      });
    },
  };
}
