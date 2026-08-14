import { DomainInvariantError } from "./errors";
import type { UsageEventId } from "./identity";

export type UsageCorrection =
  | Readonly<{
      correctedEventId: UsageEventId;
      correctionEventId: UsageEventId;
      kind: "reverse";
    }>
  | Readonly<{
      correctedEventId: UsageEventId;
      kind: "replace";
      replacementEventId: UsageEventId;
    }>;

function assertDifferentEvents(left: UsageEventId, right: UsageEventId): void {
  if (left === right) {
    throw new DomainInvariantError(
      "invalid_correction",
      "A correction must reference a different usage event.",
    );
  }
}

export function reverseUsageEvent(
  correctedEventId: UsageEventId,
  correctionEventId: UsageEventId,
): UsageCorrection {
  assertDifferentEvents(correctedEventId, correctionEventId);
  return Object.freeze({ correctedEventId, correctionEventId, kind: "reverse" });
}

export function replaceUsageEvent(
  correctedEventId: UsageEventId,
  replacementEventId: UsageEventId,
): UsageCorrection {
  assertDifferentEvents(correctedEventId, replacementEventId);
  return Object.freeze({ correctedEventId, kind: "replace", replacementEventId });
}
