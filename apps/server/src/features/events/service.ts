import {
  createUsageEventSchema,
  eventIdSchema,
  type EventIngestionResponse,
  type EventIngestionResult,
  type StoredUsageEvent as StoredUsageEventContract,
} from "@meterpilot/contracts/events";

import type { ApiKeyPrincipal } from "../api-keys/repository";
import { hashUsageEvent } from "./canonicalization";
import type { EventRepository, EventWrite } from "./repository";

export type EventService = Readonly<{
  find: (principal: ApiKeyPrincipal, eventKey: string) => Promise<StoredUsageEventContract | null>;
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

  return {
    async find(principal, eventKey) {
      const stored = await repository.find(principal.organizationId, eventKey);
      if (!stored) {
        return null;
      }

      return {
        ...stored.event,
        processingState: stored.processingState,
        receivedAt: stored.receivedAt.toISOString(),
      };
    },

    ingestBatch(principal, inputs, requestId) {
      return ingest(principal, inputs, requestId);
    },

    ingestOne(principal, input, requestId) {
      return ingest(principal, [input], requestId);
    },
  };
}
