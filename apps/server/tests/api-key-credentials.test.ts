import { describe, expect, test } from "bun:test";

import {
  generateApiKey,
  hashApiKey,
  parseApiKeyPrefix,
  verifyApiKeyHash,
} from "../src/features/api-keys/credentials";

describe("API key credentials", () => {
  test("generates a separate lookup prefix and 256-bit secret", () => {
    const key = generateApiKey((size) => new Uint8Array(size).fill(7));

    expect(key.prefix).toMatch(/^mpk_[A-Za-z0-9_-]{12}$/);
    expect(key.key).toMatch(/^mpk_[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$/);
    expect(parseApiKeyPrefix(key.key)).toBe(key.prefix);
    expect(key.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(key.secretHash).not.toContain(key.key);
  });

  test("verifies the complete key against its SHA-256 hash", () => {
    const key = generateApiKey((size) => new Uint8Array(size).fill(11));

    expect(verifyApiKeyHash(key.key, key.secretHash)).toBe(true);
    expect(verifyApiKeyHash(`${key.key}tampered`, key.secretHash)).toBe(false);
    expect(verifyApiKeyHash(key.key, "invalid-hash")).toBe(false);
  });

  test("rejects malformed keys before repository lookup", () => {
    expect(parseApiKeyPrefix("not-a-key")).toBeNull();
    expect(parseApiKeyPrefix(`mpk_${"A".repeat(12)}.${"B".repeat(42)}`)).toBeNull();
  });

  test("hashing is deterministic", () => {
    expect(hashApiKey("credential")).toBe(hashApiKey("credential"));
  });
});
