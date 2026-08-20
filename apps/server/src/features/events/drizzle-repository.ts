import {
  eventPropertiesSchema,
  type EventProcessingState,
  usageEventSchema,
} from "@meterpilot/contracts/events";
import type { Database } from "@meterpilot/db";
import { jobs, usageEvents } from "@meterpilot/db/schema";
import { decideIdempotency, payloadHash } from "@meterpilot/domain/idempotency";
import { and, eq } from "drizzle-orm";

import {
  PROCESS_USAGE_EVENT_JOB_TYPE,
  type EventPersistenceResult,
  type EventRepository,
} from "./repository";

function processingState(
  status: "completed" | "failed" | "pending" | "processing",
): EventProcessingState {
  return status === "completed" ? "processed" : status;
}

export function createDrizzleEventRepository(database: Database["db"]): EventRepository {
  return {
    async find(organizationId, eventKey) {
      const [row] = await database
        .select({
          eventKey: usageEvents.eventKey,
          eventType: usageEvents.eventType,
          jobStatus: jobs.status,
          occurredAt: usageEvents.occurredAt,
          properties: usageEvents.properties,
          receivedAt: usageEvents.receivedAt,
          subjectKey: usageEvents.subjectKey,
        })
        .from(usageEvents)
        .innerJoin(
          jobs,
          and(
            eq(jobs.organizationId, usageEvents.organizationId),
            eq(jobs.eventId, usageEvents.id),
            eq(jobs.type, PROCESS_USAGE_EVENT_JOB_TYPE),
          ),
        )
        .where(
          and(eq(usageEvents.organizationId, organizationId), eq(usageEvents.eventKey, eventKey)),
        )
        .limit(1);

      if (!row) {
        return null;
      }

      const event = usageEventSchema.parse({
        id: row.eventKey,
        occurredAt: row.occurredAt.toISOString(),
        properties: eventPropertiesSchema.parse(row.properties),
        subject: row.subjectKey,
        type: row.eventType,
      });

      return {
        event,
        processingState: processingState(row.jobStatus),
        receivedAt: row.receivedAt,
      };
    },

    async ingest(source, writes) {
      return database.transaction(async (transaction) => {
        const results: EventPersistenceResult[] = [];

        for (const write of writes) {
          const [created] = await transaction
            .insert(usageEvents)
            .values({
              eventKey: write.event.id,
              eventType: write.event.type,
              occurredAt: new Date(write.event.occurredAt),
              organizationId: source.organizationId,
              payloadHash: write.payloadHash,
              properties: write.event.properties,
              receivedAt: write.receivedAt,
              sourceApiKeyId: source.apiKeyId,
              subjectKey: write.event.subject,
            })
            .onConflictDoNothing({
              target: [usageEvents.organizationId, usageEvents.eventKey],
            })
            .returning({ id: usageEvents.id });

          if (created) {
            await transaction.insert(jobs).values({
              createdAt: write.receivedAt,
              eventId: created.id,
              nextAttemptAt: write.receivedAt,
              organizationId: source.organizationId,
              payload: {
                eventId: created.id,
                eventKey: write.event.id,
                requestId: write.requestId,
              },
              resourceId: created.id,
              resourceType: "usage_event",
              type: PROCESS_USAGE_EVENT_JOB_TYPE,
              updatedAt: write.receivedAt,
            });
            results.push({ id: write.event.id, status: "accepted" });
            continue;
          }

          const [existing] = await transaction
            .select({ id: usageEvents.id, payloadHash: usageEvents.payloadHash })
            .from(usageEvents)
            .where(
              and(
                eq(usageEvents.organizationId, source.organizationId),
                eq(usageEvents.eventKey, write.event.id),
              ),
            )
            .limit(1);

          if (!existing) {
            throw new Error("Conflicting usage event was not visible after insertion.");
          }

          const decision = decideIdempotency(payloadHash(existing.payloadHash), write.payloadHash);
          if (decision.status === "duplicate") {
            await transaction
              .insert(jobs)
              .values({
                createdAt: write.receivedAt,
                eventId: existing.id,
                nextAttemptAt: write.receivedAt,
                organizationId: source.organizationId,
                payload: {
                  eventId: existing.id,
                  eventKey: write.event.id,
                  requestId: write.requestId,
                },
                resourceId: existing.id,
                resourceType: "usage_event",
                type: PROCESS_USAGE_EVENT_JOB_TYPE,
                updatedAt: write.receivedAt,
              })
              .onConflictDoNothing({
                target: [jobs.organizationId, jobs.type, jobs.resourceType, jobs.resourceId],
              });
          }
          results.push({
            id: write.event.id,
            status: decision.status === "conflict" ? "idempotency_conflict" : "duplicate",
          });
        }

        return results;
      });
    },
  };
}
