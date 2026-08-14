import { describe, expect, test } from "bun:test";

import { decideIdempotency, payloadHash } from "../src/idempotency";

const FIRST_HASH = payloadHash("a".repeat(64));
const SECOND_HASH = payloadHash("b".repeat(64));

describe("idempotency semantics", () => {
  test("distinguishes new, duplicate, and conflicting requests", () => {
    expect(decideIdempotency(null, FIRST_HASH)).toEqual({ status: "new" });
    expect(decideIdempotency(FIRST_HASH, FIRST_HASH)).toEqual({
      payloadHash: FIRST_HASH,
      status: "duplicate",
    });
    expect(decideIdempotency(FIRST_HASH, SECOND_HASH)).toEqual({
      existingPayloadHash: FIRST_HASH,
      incomingPayloadHash: SECOND_HASH,
      status: "conflict",
    });
  });

  test("rejects non-SHA-256 payload hashes", () => {
    expect(() => payloadHash("not-a-hash")).toThrow("SHA-256");
  });
});
