import type { Database } from "@meterpilot/db";
import {
  auditLog,
  dataRetentionPolicies,
  jobs,
  PROCESS_USAGE_EVENT_JOB_TYPE,
  retentionEnforcementJob,
  usageEvents,
} from "@meterpilot/db/schema";
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";

import { retryableJobError } from "./errors";
import type { RetentionEnforcer } from "./retention-enforcer";

const ENFORCEMENT_BATCH_SIZE = 500;
const NEXT_ENFORCEMENT_DELAY_MS = 24 * 60 * 60 * 1_000;

export function createDrizzleRetentionEnforcer(
  database: Database["db"],
  now: () => Date = () => new Date(),
): RetentionEnforcer {
  return Object.freeze({
    async enforce(organizationId, policyVersion, requestId, currentJobId, signal) {
      if (signal.aborted) {
        throw retryableJobError("worker_shutdown", "Worker shutdown interrupted retention.");
      }

      return database.transaction(async (transaction) => {
        const [policy] = await transaction
          .select()
          .from(dataRetentionPolicies)
          .where(eq(dataRetentionPolicies.organizationId, organizationId))
          .for("update")
          .limit(1);
        if (
          !policy ||
          policy.version !== policyVersion ||
          policy.eventPropertiesRetentionDays === null
        ) {
          return { redactedCount: 0, status: "stale" } as const;
        }

        const enforcedAt = now();
        const cutoff = new Date(
          enforcedAt.getTime() - policy.eventPropertiesRetentionDays * 24 * 60 * 60 * 1_000,
        );
        const eligible = await transaction
          .select({ id: usageEvents.id })
          .from(usageEvents)
          .innerJoin(
            jobs,
            and(
              eq(jobs.organizationId, usageEvents.organizationId),
              eq(jobs.eventId, usageEvents.id),
              eq(jobs.type, PROCESS_USAGE_EVENT_JOB_TYPE),
              eq(jobs.status, "completed"),
            ),
          )
          .where(
            and(
              eq(usageEvents.organizationId, organizationId),
              isNull(usageEvents.propertiesRedactedAt),
              lte(usageEvents.receivedAt, cutoff),
            ),
          )
          .orderBy(asc(usageEvents.receivedAt), asc(usageEvents.id))
          .limit(ENFORCEMENT_BATCH_SIZE)
          .for("update", { skipLocked: true, of: usageEvents });

        if (signal.aborted) {
          throw retryableJobError("worker_shutdown", "Worker shutdown interrupted retention.");
        }

        const eventIds = eligible.map(({ id }) => id);
        if (eventIds.length > 0) {
          await transaction
            .update(usageEvents)
            .set({ properties: {}, propertiesRedactedAt: enforcedAt })
            .where(
              and(
                eq(usageEvents.organizationId, organizationId),
                inArray(usageEvents.id, eventIds),
                isNull(usageEvents.propertiesRedactedAt),
              ),
            );
          await transaction.insert(auditLog).values({
            action: "retention.properties_redacted",
            actorType: "system",
            metadata: {
              cutoff: cutoff.toISOString(),
              eventCount: eventIds.length,
              policyVersion,
            },
            occurredAt: enforcedAt,
            organizationId,
            requestId,
            resourceId: organizationId,
            resourceType: "retention_policy",
          });
        }

        const nextAttemptAt = new Date(
          enforcedAt.getTime() +
            (eventIds.length === ENFORCEMENT_BATCH_SIZE ? 0 : NEXT_ENFORCEMENT_DELAY_MS),
        );
        await transaction
          .insert(jobs)
          .values(
            retentionEnforcementJob({
              createdAt: enforcedAt,
              nextAttemptAt,
              organizationId,
              payload: { organizationId, policyVersion, requestId },
              resourceId: currentJobId,
            }),
          )
          .onConflictDoNothing({
            target: [jobs.organizationId, jobs.type, jobs.resourceType, jobs.resourceId],
          });

        return { redactedCount: eventIds.length, status: "enforced" } as const;
      });
    },
  });
}
