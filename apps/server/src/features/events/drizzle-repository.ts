import {
  eventPropertiesSchema,
  type EventProcessingState,
  usageEventSchema,
} from "@meterpilot/contracts/events";
import type { Database } from "@meterpilot/db";
import { auditLog, customers, jobs, subjects, usageEvents } from "@meterpilot/db/schema";
import { decideIdempotency, payloadHash } from "@meterpilot/domain/idempotency";
import { and, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";

import {
  PROCESS_USAGE_EVENT_JOB_TYPE,
  InvalidEventCursorError,
  type EventPersistenceResult,
  type EventRepository,
} from "./repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function encodeCursor(row: Readonly<{ id: string; receivedAt: Date }>): string {
  return Buffer.from(
    JSON.stringify({ id: row.id, receivedAt: row.receivedAt.toISOString() }),
  ).toString("base64url");
}

function decodeCursor(cursor?: string): Readonly<{ id: string; receivedAt: Date }> | undefined {
  if (!cursor) return undefined;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (Buffer.from(decoded).toString("base64url") !== cursor) {
      throw new InvalidEventCursorError();
    }
    const value = JSON.parse(decoded) as unknown;
    if (
      typeof value !== "object" ||
      value === null ||
      !("id" in value) ||
      !("receivedAt" in value) ||
      typeof value.id !== "string" ||
      typeof value.receivedAt !== "string" ||
      !UUID_PATTERN.test(value.id)
    ) {
      throw new InvalidEventCursorError();
    }
    const receivedAt = new Date(value.receivedAt);
    if (!Number.isFinite(receivedAt.getTime()) || receivedAt.toISOString() !== value.receivedAt) {
      throw new InvalidEventCursorError();
    }
    return { id: value.id, receivedAt };
  } catch (error) {
    if (error instanceof InvalidEventCursorError) throw error;
    throw new InvalidEventCursorError();
  }
}

function storedJobStatus(state: EventProcessingState) {
  return state === "processed" ? ("completed" as const) : state;
}

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
          correctionKind: usageEvents.correctionKind,
          correctionOfEventId: usageEvents.correctionOfEventId,
          id: usageEvents.id,
          jobStatus: jobs.status,
          occurredAt: usageEvents.occurredAt,
          properties: usageEvents.properties,
          propertiesRedactedAt: usageEvents.propertiesRedactedAt,
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

      const [correctedEvent, correctingEvent] = await Promise.all([
        row.correctionOfEventId
          ? database
              .select({ eventKey: usageEvents.eventKey })
              .from(usageEvents)
              .where(
                and(
                  eq(usageEvents.organizationId, organizationId),
                  eq(usageEvents.id, row.correctionOfEventId),
                ),
              )
              .limit(1)
              .then((rows) => rows[0] ?? null)
          : Promise.resolve(null),
        database
          .select({ eventKey: usageEvents.eventKey, kind: usageEvents.correctionKind })
          .from(usageEvents)
          .where(
            and(
              eq(usageEvents.organizationId, organizationId),
              eq(usageEvents.correctionOfEventId, row.id),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null),
      ]);

      if (row.correctionOfEventId && (!correctedEvent || !row.correctionKind)) {
        throw new Error("Usage event correction reference is incomplete.");
      }
      if (correctingEvent && !correctingEvent.kind) {
        throw new Error("Correcting usage event has no correction kind.");
      }

      const event = usageEventSchema.parse({
        id: row.eventKey,
        occurredAt: row.occurredAt.toISOString(),
        properties: eventPropertiesSchema.parse(row.properties),
        subject: row.subjectKey,
        type: row.eventType,
      });

      return {
        correctedBy: correctingEvent?.kind
          ? { eventId: correctingEvent.eventKey, kind: correctingEvent.kind }
          : null,
        correctionOf:
          correctedEvent && row.correctionKind
            ? { eventId: correctedEvent.eventKey, kind: row.correctionKind }
            : null,
        event,
        propertiesRedactedAt: row.propertiesRedactedAt,
        processingState: processingState(row.jobStatus),
        receivedAt: row.receivedAt,
      };
    },

    async list(organizationId, query) {
      const cursor = decodeCursor(query.cursor);
      const rows = await database
        .select({
          correctionKind: usageEvents.correctionKind,
          correctionOfEventId: usageEvents.correctionOfEventId,
          customerKey: customers.externalKey,
          eventKey: usageEvents.eventKey,
          eventType: usageEvents.eventType,
          id: usageEvents.id,
          jobStatus: jobs.status,
          occurredAt: usageEvents.occurredAt,
          propertiesRedactedAt: usageEvents.propertiesRedactedAt,
          receivedAt: usageEvents.receivedAt,
          subjectKey: usageEvents.subjectKey,
        })
        .from(usageEvents)
        .innerJoin(
          customers,
          and(
            eq(customers.organizationId, usageEvents.organizationId),
            eq(customers.id, usageEvents.customerId),
          ),
        )
        .innerJoin(
          jobs,
          and(
            eq(jobs.organizationId, usageEvents.organizationId),
            eq(jobs.eventId, usageEvents.id),
            eq(jobs.type, PROCESS_USAGE_EVENT_JOB_TYPE),
          ),
        )
        .where(
          and(
            eq(usageEvents.organizationId, organizationId),
            query.customerKey ? eq(customers.externalKey, query.customerKey) : undefined,
            query.occurredAfter
              ? gte(usageEvents.occurredAt, new Date(query.occurredAfter))
              : undefined,
            query.occurredBefore
              ? lt(usageEvents.occurredAt, new Date(query.occurredBefore))
              : undefined,
            query.processingState
              ? eq(jobs.status, storedJobStatus(query.processingState))
              : undefined,
            query.subject ? eq(usageEvents.subjectKey, query.subject) : undefined,
            query.type ? eq(usageEvents.eventType, query.type) : undefined,
            cursor
              ? or(
                  lt(usageEvents.receivedAt, cursor.receivedAt),
                  and(eq(usageEvents.receivedAt, cursor.receivedAt), lt(usageEvents.id, cursor.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(usageEvents.receivedAt), desc(usageEvents.id))
        .limit(query.limit + 1);
      const hasNext = rows.length > query.limit;
      const selected = rows.slice(0, query.limit);
      const parentIds = selected.flatMap((row) =>
        row.correctionOfEventId ? [row.correctionOfEventId] : [],
      );
      const [parents, children] = await Promise.all([
        parentIds.length === 0
          ? Promise.resolve([])
          : database
              .select({ eventKey: usageEvents.eventKey, id: usageEvents.id })
              .from(usageEvents)
              .where(
                and(
                  eq(usageEvents.organizationId, organizationId),
                  inArray(usageEvents.id, parentIds),
                ),
              ),
        selected.length === 0
          ? Promise.resolve([])
          : database
              .select({
                correctionOfEventId: usageEvents.correctionOfEventId,
                eventKey: usageEvents.eventKey,
                kind: usageEvents.correctionKind,
              })
              .from(usageEvents)
              .where(
                and(
                  eq(usageEvents.organizationId, organizationId),
                  inArray(
                    usageEvents.correctionOfEventId,
                    selected.map((row) => row.id),
                  ),
                ),
              ),
      ]);
      const parentKeys = new Map(parents.map((parent) => [parent.id, parent.eventKey]));
      const childrenByParent = new Map(
        children.flatMap((child) =>
          child.correctionOfEventId && child.kind
            ? [[child.correctionOfEventId, { eventId: child.eventKey, kind: child.kind }] as const]
            : [],
        ),
      );
      const items = selected.map((row) => ({
        correctedBy: childrenByParent.get(row.id) ?? null,
        correctionOf:
          row.correctionOfEventId && row.correctionKind
            ? {
                eventId: parentKeys.get(row.correctionOfEventId) ?? "",
                kind: row.correctionKind,
              }
            : null,
        customerKey: row.customerKey,
        eventKey: row.eventKey,
        eventType: row.eventType,
        occurredAt: row.occurredAt,
        processingState: processingState(row.jobStatus),
        propertiesRedactedAt: row.propertiesRedactedAt,
        receivedAt: row.receivedAt,
        subjectKey: row.subjectKey,
      }));
      if (items.some((item) => item.correctionOf?.eventId === "")) {
        throw new Error("Usage event correction reference is incomplete.");
      }
      const last = selected.at(-1);
      return {
        items,
        nextCursor: hasNext && last ? encodeCursor(last) : null,
      };
    },

    async correct(source, write) {
      return database.transaction(async (transaction) => {
        const correctionEventId =
          write.request.kind === "reverse" ? write.request.id : write.request.event.id;
        const [existingCorrection] = await transaction
          .select({
            correctionKind: usageEvents.correctionKind,
            correctionOfEventId: usageEvents.correctionOfEventId,
            payloadHash: usageEvents.payloadHash,
          })
          .from(usageEvents)
          .where(
            and(
              eq(usageEvents.organizationId, source.organizationId),
              eq(usageEvents.eventKey, correctionEventId),
            ),
          )
          .limit(1);
        if (existingCorrection) {
          const decision = decideIdempotency(
            payloadHash(existingCorrection.payloadHash),
            write.payloadHash,
          );
          if (
            decision.status === "duplicate" &&
            existingCorrection.correctionKind === write.request.kind &&
            existingCorrection.correctionOfEventId
          ) {
            const [corrected] = await transaction
              .select({ eventKey: usageEvents.eventKey })
              .from(usageEvents)
              .where(
                and(
                  eq(usageEvents.organizationId, source.organizationId),
                  eq(usageEvents.id, existingCorrection.correctionOfEventId),
                ),
              )
              .limit(1);
            if (corrected?.eventKey === write.correctedEventKey) {
              return {
                correctedEventId: write.correctedEventKey,
                correctionEventId,
                kind: write.request.kind,
                status: "duplicate",
              } as const;
            }
          }
          return { status: "idempotency_conflict" } as const;
        }

        const [corrected] = await transaction
          .select({
            customerId: usageEvents.customerId,
            eventType: usageEvents.eventType,
            id: usageEvents.id,
            occurredAt: usageEvents.occurredAt,
            properties: usageEvents.properties,
            propertiesRedactedAt: usageEvents.propertiesRedactedAt,
            subjectKey: usageEvents.subjectKey,
          })
          .from(usageEvents)
          .where(
            and(
              eq(usageEvents.organizationId, source.organizationId),
              eq(usageEvents.eventKey, write.correctedEventKey),
            ),
          )
          .for("update")
          .limit(1);
        if (!corrected) {
          return { status: "not_found" } as const;
        }
        if (corrected.propertiesRedactedAt) {
          return { status: "properties_redacted" } as const;
        }

        const [existingChild] = await transaction
          .select({ id: usageEvents.id })
          .from(usageEvents)
          .where(
            and(
              eq(usageEvents.organizationId, source.organizationId),
              eq(usageEvents.correctionOfEventId, corrected.id),
            ),
          )
          .limit(1);
        if (existingChild) {
          return { status: "already_corrected" } as const;
        }

        let customerId = corrected.customerId;
        if (write.request.kind === "replace") {
          const [replacementSubject] = await transaction
            .select({ customerId: subjects.customerId })
            .from(subjects)
            .innerJoin(
              customers,
              and(
                eq(customers.organizationId, subjects.organizationId),
                eq(customers.id, subjects.customerId),
              ),
            )
            .where(
              and(
                eq(subjects.organizationId, source.organizationId),
                eq(subjects.externalKey, write.request.event.subject),
                isNull(customers.archivedAt),
              ),
            )
            .limit(1);
          if (!replacementSubject) {
            return { status: "unknown_subject" } as const;
          }
          customerId = replacementSubject.customerId;
        }

        const correctionEvent =
          write.request.kind === "reverse"
            ? {
                id: write.request.id,
                occurredAt: corrected.occurredAt,
                properties: corrected.properties,
                subject: corrected.subjectKey,
                type: corrected.eventType,
              }
            : {
                id: write.request.event.id,
                occurredAt: new Date(write.request.event.occurredAt),
                properties: write.request.event.properties,
                subject: write.request.event.subject,
                type: write.request.event.type,
              };

        const [created] = await transaction
          .insert(usageEvents)
          .values({
            correctionKind: write.request.kind,
            correctionOfEventId: corrected.id,
            customerId,
            eventKey: correctionEvent.id,
            eventType: correctionEvent.type,
            occurredAt: correctionEvent.occurredAt,
            organizationId: source.organizationId,
            payloadHash: write.payloadHash,
            properties: correctionEvent.properties,
            receivedAt: write.receivedAt,
            sourceApiKeyId: source.apiKeyId,
            subjectKey: correctionEvent.subject,
          })
          .onConflictDoNothing()
          .returning({ id: usageEvents.id });
        if (!created) {
          const [concurrentById] = await transaction
            .select({ payloadHash: usageEvents.payloadHash })
            .from(usageEvents)
            .where(
              and(
                eq(usageEvents.organizationId, source.organizationId),
                eq(usageEvents.eventKey, correctionEventId),
              ),
            )
            .limit(1);
          if (concurrentById) {
            const decision = decideIdempotency(
              payloadHash(concurrentById.payloadHash),
              write.payloadHash,
            );
            if (decision.status === "duplicate") {
              return {
                correctedEventId: write.correctedEventKey,
                correctionEventId,
                kind: write.request.kind,
                status: "duplicate",
              } as const;
            }
            return { status: "idempotency_conflict" } as const;
          }
          return { status: "already_corrected" } as const;
        }

        await transaction.insert(jobs).values({
          createdAt: write.receivedAt,
          eventId: created.id,
          nextAttemptAt: write.receivedAt,
          organizationId: source.organizationId,
          payload: {
            eventId: created.id,
            eventKey: correctionEventId,
            requestId: write.requestId,
          },
          resourceId: created.id,
          resourceType: "usage_event",
          type: PROCESS_USAGE_EVENT_JOB_TYPE,
          updatedAt: write.receivedAt,
        });
        await transaction.insert(auditLog).values({
          action: "usage_event.corrected",
          actorApiKeyId: source.apiKeyId,
          actorType: "api_key",
          metadata: {
            correctedEventId: write.correctedEventKey,
            correctionEventId,
            kind: write.request.kind,
          },
          occurredAt: write.receivedAt,
          organizationId: source.organizationId,
          requestId: write.requestId,
          resourceId: correctionEventId,
          resourceType: "usage_event",
        });

        return {
          correctedEventId: write.correctedEventKey,
          correctionEventId,
          kind: write.request.kind,
          status: "accepted",
        } as const;
      });
    },

    async ingest(source, writes) {
      return database.transaction(async (transaction) => {
        const results: EventPersistenceResult[] = [];

        for (const write of writes) {
          const [previous] = await transaction
            .select({ id: usageEvents.id, payloadHash: usageEvents.payloadHash })
            .from(usageEvents)
            .where(
              and(
                eq(usageEvents.organizationId, source.organizationId),
                eq(usageEvents.eventKey, write.event.id),
              ),
            )
            .limit(1);

          if (previous) {
            const decision = decideIdempotency(
              payloadHash(previous.payloadHash),
              write.payloadHash,
            );
            if (decision.status === "duplicate") {
              await transaction
                .insert(jobs)
                .values({
                  createdAt: write.receivedAt,
                  eventId: previous.id,
                  nextAttemptAt: write.receivedAt,
                  organizationId: source.organizationId,
                  payload: {
                    eventId: previous.id,
                    eventKey: write.event.id,
                    requestId: write.requestId,
                  },
                  resourceId: previous.id,
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
            continue;
          }

          const [subject] = await transaction
            .select({ customerId: subjects.customerId })
            .from(subjects)
            .innerJoin(
              customers,
              and(
                eq(customers.organizationId, subjects.organizationId),
                eq(customers.id, subjects.customerId),
              ),
            )
            .where(
              and(
                eq(subjects.organizationId, source.organizationId),
                eq(subjects.externalKey, write.event.subject),
                isNull(customers.archivedAt),
              ),
            )
            .limit(1);

          if (!subject) {
            results.push({
              code: "unknown_subject",
              id: write.event.id,
              message: "The event subject is not registered.",
              status: "rejected",
            });
            continue;
          }

          const [created] = await transaction
            .insert(usageEvents)
            .values({
              customerId: subject.customerId,
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
