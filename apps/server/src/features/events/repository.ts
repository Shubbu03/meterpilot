import type { EventProcessingState, UsageEvent } from "@meterpilot/contracts/events";
import type { PayloadHash } from "@meterpilot/domain/idempotency";

export const PROCESS_USAGE_EVENT_JOB_TYPE = "usage_event.process";

export type EventWrite = Readonly<{
  event: UsageEvent;
  payloadHash: PayloadHash;
  receivedAt: Date;
  requestId: string;
}>;

export type EventPersistenceResult = Readonly<{
  id: string;
  status: "accepted" | "duplicate" | "idempotency_conflict";
}>;

export type StoredUsageEvent = Readonly<{
  event: UsageEvent;
  processingState: EventProcessingState;
  receivedAt: Date;
}>;

export type EventSource = Readonly<{
  apiKeyId: string;
  organizationId: string;
}>;

export type EventRepository = Readonly<{
  find: (organizationId: string, eventKey: string) => Promise<StoredUsageEvent | null>;
  ingest: (
    source: EventSource,
    writes: readonly EventWrite[],
  ) => Promise<readonly EventPersistenceResult[]>;
}>;
