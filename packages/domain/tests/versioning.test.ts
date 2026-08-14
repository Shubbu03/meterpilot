import { describe, expect, test } from "bun:test";

import { usageEventId } from "../src/identity";
import { instant } from "../src/time";
import {
  archiveVersion,
  assertDraftVersion,
  draftVersion,
  publishVersion,
} from "../src/versioning";
import { replaceUsageEvent, reverseUsageEvent } from "../src/corrections";

describe("immutable versions and corrections", () => {
  test("allows only draft to published to archived transitions", () => {
    const draft = draftVersion();
    const published = publishVersion(draft, instant("2026-08-01T00:00:00.000Z"));
    const archived = archiveVersion(published, instant("2026-09-01T00:00:00.000Z"));

    expect(archived.status).toBe("archived");
    expect(() => publishVersion(published, instant("2026-10-01T00:00:00.000Z"))).toThrow(
      "Only a draft",
    );
    expect(() => assertDraftVersion(archived)).toThrow("immutable");
  });

  test("models corrections as relationships between distinct immutable events", () => {
    const original = usageEventId("evt_original");
    const correction = usageEventId("evt_correction");

    expect(reverseUsageEvent(original, correction)).toEqual({
      correctedEventId: original,
      correctionEventId: correction,
      kind: "reverse",
    });
    expect(replaceUsageEvent(original, correction)).toEqual({
      correctedEventId: original,
      kind: "replace",
      replacementEventId: correction,
    });
    expect(() => reverseUsageEvent(original, original)).toThrow("different usage event");
  });
});
