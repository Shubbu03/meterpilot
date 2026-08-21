import type {
  EventProcessingState,
  UsageEvent,
  UsageEventCorrectionKind,
  UsageEventCorrectionRequest,
  UsageEventCorrectionReference,
  UsageEventListQuery,
} from "@meterpilot/contracts/events";
import type { PayloadHash } from "@meterpilot/domain/idempotency";

export const PROCESS_USAGE_EVENT_JOB_TYPE = "usage_event.process";

export type EventWrite = Readonly<{
  event: UsageEvent;
  payloadHash: PayloadHash;
  receivedAt: Date;
  requestId: string;
}>;

export type EventPersistenceResult =
  | Readonly<{
      id: string;
      status: "accepted" | "duplicate" | "idempotency_conflict";
    }>
  | Readonly<{
      code: "unknown_subject";
      id: string;
      message: string;
      status: "rejected";
    }>;

export type StoredUsageEvent = Readonly<{
  correctedBy?: UsageEventCorrectionReference | null;
  correctionOf?: UsageEventCorrectionReference | null;
  event: UsageEvent;
  propertiesRedactedAt: Date | null;
  processingState: EventProcessingState;
  receivedAt: Date;
}>;

export type StoredUsageEventSummary = Readonly<{
  correctedBy: UsageEventCorrectionReference | null;
  correctionOf: UsageEventCorrectionReference | null;
  customerKey: string;
  eventKey: string;
  eventType: string;
  occurredAt: Date;
  processingState: EventProcessingState;
  propertiesRedactedAt: Date | null;
  receivedAt: Date;
  subjectKey: string;
}>;

export type EventListResult = Readonly<{
  items: readonly StoredUsageEventSummary[];
  nextCursor: string | null;
}>;

export class InvalidEventCursorError extends Error {
  override readonly name = "InvalidEventCursorError";

  constructor() {
    super("The pagination cursor is invalid.");
  }
}

export type EventSource = Readonly<{
  apiKeyId: string;
  organizationId: string;
}>;

export type EventCorrectionWrite = Readonly<{
  correctedEventKey: string;
  payloadHash: PayloadHash;
  receivedAt: Date;
  request: UsageEventCorrectionRequest;
  requestId: string;
}>;

export type EventCorrectionPersistenceResult =
  | Readonly<{
      correctedEventId: string;
      correctionEventId: string;
      kind: UsageEventCorrectionKind;
      status: "accepted" | "duplicate";
    }>
  | Readonly<{
      status:
        | "already_corrected"
        | "idempotency_conflict"
        | "not_found"
        | "properties_redacted"
        | "unknown_subject";
    }>;

export type EventRepository = Readonly<{
  correct: (
    source: EventSource,
    write: EventCorrectionWrite,
  ) => Promise<EventCorrectionPersistenceResult>;
  find: (organizationId: string, eventKey: string) => Promise<StoredUsageEvent | null>;
  list: (organizationId: string, query: UsageEventListQuery) => Promise<EventListResult>;
  ingest: (
    source: EventSource,
    writes: readonly EventWrite[],
  ) => Promise<readonly EventPersistenceResult[]>;
}>;
