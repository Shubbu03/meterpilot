import {
  createUsageEventCorrectionRequestSchema,
  createUsageEventSchema,
  eventIdSchema,
  type EventIngestionResponse,
  type EventIngestionResult,
  type StoredUsageEvent as StoredUsageEventContract,
  type UsageEventListQuery,
  type UsageEventSummary,
  type UsageEventCorrectionResponse,
} from "@meterpilot/contracts/events";

import type { ApiKeyPrincipal } from "../api-keys/repository";
import { hashUsageEvent, hashUsageEventCorrection } from "./canonicalization";
import type { EventRepository, EventWrite } from "./repository";

export type EventService = Readonly<{
  correct: (
    principal: ApiKeyPrincipal,
    correctedEventKey: string,
    input: unknown,
    requestId: string,
  ) => Promise<EventCorrectionServiceResult>;
  find: (principal: ApiKeyPrincipal, eventKey: string) => Promise<StoredUsageEventContract | null>;
  findForOrganization: (
    organizationId: string,
    eventKey: string,
  ) => Promise<StoredUsageEventContract | null>;
  ingestBatch: (
    principal: ApiKeyPrincipal,
    inputs: readonly unknown[],
    requestId: string,
  ) => Promise<EventIngestionResponse>;
  ingestOne: (
    principal: ApiKeyPrincipal,
    input: unknown,
    requestId: string,
  ) => Promise<EventIngestionResponse>;
  listForOrganization: (
    organizationId: string,
    query: UsageEventListQuery,
  ) => Promise<Readonly<{ items: readonly UsageEventSummary[]; nextCursor: string | null }>>;
}>;

export type EventCorrectionServiceResult =
  | Readonly<{ response: UsageEventCorrectionResponse; status: "ok" }>
  | Readonly<{
      issues: readonly Readonly<{ message: string; path: readonly PropertyKey[] }>[];
      status: "validation_error";
    }>
  | Readonly<{
      status:
        | "already_corrected"
        | "idempotency_conflict"
        | "not_found"
        | "properties_redacted"
        | "unknown_subject";
    }>;

export type EventServiceOptions = Readonly<{
  now?: () => Date;
}>;

function rejectedEvent(input: unknown): EventIngestionResult {
  const candidateId =
    typeof input === "object" && input !== null && "id" in input
      ? eventIdSchema.safeParse(input.id)
      : null;

  return {
    code: "invalid_event",
    ...(candidateId?.success ? { id: candidateId.data } : {}),
    message: "The event is invalid.",
    status: "rejected",
  };
}

export function createEventService(
  repository: EventRepository,
  options: EventServiceOptions = {},
): EventService {
  const now = options.now ?? (() => new Date());

  async function ingest(
    principal: ApiKeyPrincipal,
    inputs: readonly unknown[],
    requestId: string,
  ): Promise<EventIngestionResponse> {
    const receivedAt = now();
    const schema = createUsageEventSchema({ now: receivedAt });
    const orderedResults: Array<EventIngestionResult | undefined> = Array.from({
      length: inputs.length,
    });
    const writes: EventWrite[] = [];
    const writeIndexes: number[] = [];

    inputs.forEach((input, index) => {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        orderedResults[index] = rejectedEvent(input);
        return;
      }

      writes.push({
        event: parsed.data,
        payloadHash: hashUsageEvent(parsed.data),
        receivedAt,
        requestId,
      });
      writeIndexes.push(index);
    });

    if (writes.length > 0) {
      const persisted = await repository.ingest(
        {
          apiKeyId: principal.apiKeyId,
          organizationId: principal.organizationId,
        },
        writes,
      );

      if (persisted.length !== writes.length) {
        throw new Error("Event repository returned an unexpected result count.");
      }

      persisted.forEach((result, index) => {
        const resultIndex = writeIndexes[index];
        if (resultIndex === undefined) {
          throw new Error("Event result could not be paired with its input.");
        }
        orderedResults[resultIndex] = result;
      });
    }

    const results = orderedResults.filter(
      (result): result is EventIngestionResult => result !== undefined,
    );
    if (results.length !== inputs.length) {
      throw new Error("Event service did not produce a result for every input.");
    }

    return { requestId, results };
  }

  async function findForOrganization(
    organizationId: string,
    eventKey: string,
  ): Promise<StoredUsageEventContract | null> {
    const stored = await repository.find(organizationId, eventKey);
    if (!stored) return null;
    return {
      correctedBy: stored.correctedBy ?? null,
      correctionOf: stored.correctionOf ?? null,
      ...stored.event,
      processingState: stored.processingState,
      propertiesRedactedAt: stored.propertiesRedactedAt?.toISOString() ?? null,
      receivedAt: stored.receivedAt.toISOString(),
    };
  }

  return {
    async correct(principal, correctedEventKey, input, requestId) {
      const receivedAt = now();
      const parsed = createUsageEventCorrectionRequestSchema({ now: receivedAt }).safeParse(input);
      if (!parsed.success) {
        return { issues: parsed.error.issues, status: "validation_error" };
      }

      const correctionEventId =
        parsed.data.kind === "reverse" ? parsed.data.id : parsed.data.event.id;
      if (correctionEventId === correctedEventKey) {
        return {
          issues: [
            {
              message: "A correction must use a different event identifier.",
              path: parsed.data.kind === "reverse" ? ["id"] : ["event", "id"],
            },
          ],
          status: "validation_error",
        };
      }

      const result = await repository.correct(
        {
          apiKeyId: principal.apiKeyId,
          organizationId: principal.organizationId,
        },
        {
          correctedEventKey,
          payloadHash: hashUsageEventCorrection(correctedEventKey, parsed.data),
          receivedAt,
          request: parsed.data,
          requestId,
        },
      );
      if (!("correctedEventId" in result)) {
        return result;
      }

      return {
        response: {
          correction: result,
          requestId,
        },
        status: "ok",
      };
    },

    async find(principal, eventKey) {
      return findForOrganization(principal.organizationId, eventKey);
    },

    findForOrganization,

    ingestBatch(principal, inputs, requestId) {
      return ingest(principal, inputs, requestId);
    },

    ingestOne(principal, input, requestId) {
      return ingest(principal, [input], requestId);
    },

    async listForOrganization(organizationId, query) {
      const page = await repository.list(organizationId, query);
      return {
        items: page.items.map((event) => ({
          correctedBy: event.correctedBy,
          correctionOf: event.correctionOf,
          customerKey: event.customerKey,
          id: event.eventKey,
          occurredAt: event.occurredAt.toISOString(),
          processingState: event.processingState,
          propertiesRedactedAt: event.propertiesRedactedAt?.toISOString() ?? null,
          receivedAt: event.receivedAt.toISOString(),
          subject: event.subjectKey,
          type: event.eventType,
        })),
        nextCursor: page.nextCursor,
      };
    },
  };
}
