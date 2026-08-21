import type { Database } from "@meterpilot/db";
import {
  auditLog,
  customers,
  entitlements,
  jobs,
  planComponents,
  quotaGrants,
  subscriptionEntitlementRefreshJob,
  subscriptions,
} from "@meterpilot/db/schema";
import { billingPeriodAt } from "@meterpilot/domain";
import { and, eq } from "drizzle-orm";

import { retryableJobError } from "./errors";
import type { SubscriptionEntitlementRefresher } from "./subscription-entitlement-refresher";

function isZeroDecimal(value: string): boolean {
  return /^0(?:\.0+)?$/.test(value);
}

export function createDrizzleSubscriptionEntitlementRefresher(
  database: Database["db"],
): SubscriptionEntitlementRefresher {
  return Object.freeze({
    async refresh(organizationId, subscriptionId, periodStart, requestId, signal) {
      if (signal.aborted) {
        throw retryableJobError(
          "worker_shutdown",
          "Worker shutdown interrupted subscription entitlement refresh.",
        );
      }

      return database.transaction(async (transaction) => {
        const [subscription] = await transaction
          .select({
            billingAnchor: subscriptions.billingAnchor,
            billingTimezone: customers.billingTimezone,
            customerId: subscriptions.customerId,
            endsAt: subscriptions.endsAt,
            planVersionId: subscriptions.planVersionId,
            startsAt: subscriptions.startsAt,
          })
          .from(subscriptions)
          .innerJoin(
            customers,
            and(
              eq(customers.organizationId, subscriptions.organizationId),
              eq(customers.id, subscriptions.customerId),
            ),
          )
          .where(
            and(
              eq(subscriptions.organizationId, organizationId),
              eq(subscriptions.id, subscriptionId),
            ),
          )
          .for("update")
          .limit(1);
        if (!subscription) {
          return { status: "not_found" } as const;
        }
        if (
          periodStart < subscription.startsAt ||
          (subscription.endsAt && periodStart >= subscription.endsAt)
        ) {
          return { status: "terminal" } as const;
        }

        const period = billingPeriodAt({
          at: periodStart,
          billingAnchor: subscription.billingAnchor,
          subscriptionEnd: subscription.endsAt,
          subscriptionStart: subscription.startsAt,
          timeZone: subscription.billingTimezone,
        });
        if (period.start.getTime() !== periodStart.getTime()) {
          return { status: "conflict" } as const;
        }
        const components = await transaction
          .select()
          .from(planComponents)
          .where(
            and(
              eq(planComponents.organizationId, organizationId),
              eq(planComponents.planVersionId, subscription.planVersionId),
            ),
          );
        const entitlementComponents = components.filter(
          (component) => component.featureId && component.entitlementDefinition,
        );
        let insertedCount = 0;

        for (const component of entitlementComponents) {
          if (signal.aborted) {
            throw retryableJobError(
              "worker_shutdown",
              "Worker shutdown interrupted subscription entitlement refresh.",
            );
          }
          const definition = component.entitlementDefinition;
          if (!component.featureId || !definition) {
            continue;
          }
          const [created] = await transaction
            .insert(entitlements)
            .values({
              customerId: subscription.customerId,
              enabled: definition.enabled,
              featureId: component.featureId,
              grantedQuantity: definition.quantity,
              mode: definition.mode,
              organizationId,
              periodEnd: period.end,
              periodStart: period.start,
              subscriptionId,
            })
            .onConflictDoNothing()
            .returning({ id: entitlements.id });

          if (!created) {
            const [existing] = await transaction
              .select({ subscriptionId: entitlements.subscriptionId })
              .from(entitlements)
              .where(
                and(
                  eq(entitlements.organizationId, organizationId),
                  eq(entitlements.customerId, subscription.customerId),
                  eq(entitlements.featureId, component.featureId),
                  eq(entitlements.periodStart, period.start),
                  eq(entitlements.periodEnd, period.end),
                ),
              )
              .limit(1);
            if (existing?.subscriptionId !== subscriptionId) {
              return { status: "conflict" } as const;
            }
            continue;
          }

          insertedCount++;
          if (definition.mode !== "boolean" && !isZeroDecimal(definition.quantity)) {
            await transaction.insert(quotaGrants).values({
              effectiveAt: period.start,
              entitlementId: created.id,
              expiresAt: period.end,
              organizationId,
              quantity: definition.quantity,
              reason: `Plan subscription ${subscriptionId}`,
            });
          }
        }

        if (!subscription.endsAt || period.nextCycleStart < subscription.endsAt) {
          await transaction
            .insert(jobs)
            .values(
              subscriptionEntitlementRefreshJob({
                createdAt: periodStart,
                organizationId,
                periodStart: period.nextCycleStart,
                requestId,
                subscriptionId,
              }),
            )
            .onConflictDoNothing();
        }
        if (insertedCount > 0) {
          await transaction.insert(auditLog).values({
            action: "subscription.entitlements_refreshed",
            actorType: "system",
            metadata: {
              entitlementCount: insertedCount,
              periodEnd: period.end.toISOString(),
              periodStart: period.start.toISOString(),
            },
            organizationId,
            requestId,
            resourceId: subscriptionId,
            resourceType: "subscription",
          });
        }

        return { status: "refreshed" } as const;
      });
    },
  });
}
