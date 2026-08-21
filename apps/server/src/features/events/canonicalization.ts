import type {
  JsonValue,
  UsageEvent,
  UsageEventCorrectionRequest,
} from "@meterpilot/contracts/events";
import { payloadHash, type PayloadHash } from "@meterpilot/domain/idempotency";
import { createHash } from "node:crypto";

function serializePrimitive(value: string | number | boolean | null): string {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("Canonical JSON cannot contain non-finite numbers.");
  }

  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Canonical JSON contains an unsupported value.");
  }
  return serialized;
}

export function canonicalizeJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return serializePrimitive(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }

  const entries = Object.keys(value)
    .sort()
    .map((key) => `${serializePrimitive(key)}:${canonicalizeJson(value[key] as JsonValue)}`);
  return `{${entries.join(",")}}`;
}

export function canonicalUsageEvent(event: UsageEvent): string {
  return canonicalizeJson({
    id: event.id,
    occurredAt: new Date(event.occurredAt).toISOString(),
    properties: event.properties,
    subject: event.subject,
    type: event.type,
  });
}

export function hashUsageEvent(event: UsageEvent): PayloadHash {
  return payloadHash(createHash("sha256").update(canonicalUsageEvent(event), "utf8").digest("hex"));
}

export function canonicalUsageEventCorrection(
  correctedEventId: string,
  request: UsageEventCorrectionRequest,
): string {
  return canonicalizeJson(
    request.kind === "reverse"
      ? {
          correctedEventId,
          correctionEventId: request.id,
          kind: request.kind,
        }
      : {
          correctedEventId,
          event: {
            id: request.event.id,
            occurredAt: new Date(request.event.occurredAt).toISOString(),
            properties: request.event.properties,
            subject: request.event.subject,
            type: request.event.type,
          },
          kind: request.kind,
        },
  );
}

export function hashUsageEventCorrection(
  correctedEventId: string,
  request: UsageEventCorrectionRequest,
): PayloadHash {
  return payloadHash(
    createHash("sha256")
      .update(canonicalUsageEventCorrection(correctedEventId, request), "utf8")
      .digest("hex"),
  );
}
