import { describe, expect, test } from "bun:test";
import type { UsageEvent } from "@meterpilot/contracts/events";

import { canonicalUsageEvent, hashUsageEvent } from "../src/features/events/canonicalization";

const firstEvent: UsageEvent = {
  id: "evt_canonical",
  occurredAt: "2026-08-20T09:00:00+05:30",
  properties: {
    array: ["first", "second"],
    nested: { alpha: true, beta: "2" },
  },
  subject: "workspace_acme",
  type: "llm.tokens.consumed",
};

describe("event canonicalization", () => {
  test("normalizes timestamp offsets and recursively sorts object properties", () => {
    const reordered: UsageEvent = {
      type: "llm.tokens.consumed",
      subject: "workspace_acme",
      properties: {
        nested: { beta: "2", alpha: true },
        array: ["first", "second"],
      },
      occurredAt: "2026-08-20T03:30:00.000Z",
      id: "evt_canonical",
    };

    expect(canonicalUsageEvent(firstEvent)).toBe(canonicalUsageEvent(reordered));
    expect(hashUsageEvent(firstEvent)).toBe(hashUsageEvent(reordered));
  });

  test("preserves array order and changes the hash when semantics change", () => {
    const changed: UsageEvent = {
      ...firstEvent,
      properties: {
        ...firstEvent.properties,
        array: ["second", "first"],
      },
    };

    expect(hashUsageEvent(firstEvent)).not.toBe(hashUsageEvent(changed));
  });
});
