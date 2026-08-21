import { retentionPolicySchema, type RetentionPolicy } from "@meterpilot/contracts/retention";
import type { Database } from "@meterpilot/db";
import {
  auditLog,
  dataRetentionPolicies,
  jobs,
  retentionEnforcementJob,
} from "@meterpilot/db/schema";
import { eq, sql } from "drizzle-orm";

import { canManageDataRetention } from "../organizations/authorization";
import type { RetentionRepository } from "./repository";

function toPolicy(row: typeof dataRetentionPolicies.$inferSelect): RetentionPolicy {
  return retentionPolicySchema.parse({
    eventPropertiesRetentionDays: row.eventPropertiesRetentionDays,
    organizationId: row.organizationId,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    version: row.version,
  });
}

function disabledPolicy(organizationId: string): RetentionPolicy {
  return {
    eventPropertiesRetentionDays: null,
    organizationId,
    updatedAt: null,
    updatedBy: null,
    version: 0,
  };
}

export function createDrizzleRetentionRepository(
  database: Database["db"],
  now: () => Date = () => new Date(),
): RetentionRepository {
  return Object.freeze({
    async findPolicy(tenant) {
      const [row] = await database
        .select()
        .from(dataRetentionPolicies)
        .where(eq(dataRetentionPolicies.organizationId, tenant.organization.id))
        .limit(1);
      return row ? toPolicy(row) : disabledPolicy(tenant.organization.id);
    },

    async updatePolicy(tenant, input, requestId) {
      if (!canManageDataRetention(tenant.membership.role)) {
        return { status: "forbidden" };
      }

      return database.transaction(async (transaction) => {
        const updatedAt = now();
        const [previous] = await transaction
          .select({
            eventPropertiesRetentionDays: dataRetentionPolicies.eventPropertiesRetentionDays,
            version: dataRetentionPolicies.version,
          })
          .from(dataRetentionPolicies)
          .where(eq(dataRetentionPolicies.organizationId, tenant.organization.id))
          .for("update")
          .limit(1);
        const [updated] = await transaction
          .insert(dataRetentionPolicies)
          .values({
            eventPropertiesRetentionDays: input.eventPropertiesRetentionDays,
            organizationId: tenant.organization.id,
            updatedAt,
            updatedBy: tenant.actorUserId,
          })
          .onConflictDoUpdate({
            set: {
              eventPropertiesRetentionDays: input.eventPropertiesRetentionDays,
              updatedAt,
              updatedBy: tenant.actorUserId,
              version: sql`${dataRetentionPolicies.version} + 1`,
            },
            target: dataRetentionPolicies.organizationId,
          })
          .returning();
        if (!updated) {
          throw new Error("Retention policy update returned no row.");
        }

        let jobId: string | null = null;
        if (updated.eventPropertiesRetentionDays !== null) {
          const [job] = await transaction
            .insert(jobs)
            .values(
              retentionEnforcementJob({
                createdAt: updatedAt,
                organizationId: updated.organizationId,
                payload: {
                  organizationId: updated.organizationId,
                  policyVersion: updated.version,
                  requestId,
                },
                resourceId: crypto.randomUUID(),
              }),
            )
            .returning({ id: jobs.id });
          if (!job) {
            throw new Error("Retention enforcement job insertion returned no row.");
          }
          jobId = job.id;
        }

        await transaction.insert(auditLog).values({
          action: "retention.policy_updated",
          actorType: "user",
          actorUserId: tenant.actorUserId,
          metadata: {
            nextEventPropertiesRetentionDays: updated.eventPropertiesRetentionDays,
            previousEventPropertiesRetentionDays: previous?.eventPropertiesRetentionDays ?? null,
            version: updated.version,
          },
          occurredAt: updatedAt,
          organizationId: tenant.organization.id,
          requestId,
          resourceId: tenant.organization.id,
          resourceType: "retention_policy",
        });

        return { jobId, policy: toPolicy(updated), status: "ok" } as const;
      });
    },
  });
}
