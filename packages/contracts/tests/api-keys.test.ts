import { describe, expect, test } from "bun:test";

import {
  apiKeyParamSchema,
  createApiKeyRequestSchema,
  revealedApiKeyResponseSchema,
} from "../src/api-keys";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const API_KEY_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CREATED_AT = "2026-08-19T09:00:00.000Z";
const REVEALED_KEY = `mpk_${"A".repeat(12)}.${"B".repeat(43)}`;

describe("API key contracts", () => {
  test("accepts only allowlisted, unique scopes", () => {
    expect(createApiKeyRequestSchema.parse({ scopes: ["events:write", "usage:read"] })).toEqual({
      scopes: ["events:write", "usage:read"],
    });
    expect(
      createApiKeyRequestSchema.safeParse({ scopes: ["events:write", "events:write"] }).success,
    ).toBe(false);
    expect(createApiKeyRequestSchema.safeParse({ scopes: ["admin:all"] }).success).toBe(false);
  });

  test("requires organization-qualified UUID parameters", () => {
    expect(
      apiKeyParamSchema.safeParse({ apiKeyId: API_KEY_ID, organizationId: ORGANIZATION_ID })
        .success,
    ).toBe(true);
    expect(
      apiKeyParamSchema.safeParse({ apiKeyId: API_KEY_ID, organizationId: "another-tenant" })
        .success,
    ).toBe(false);
  });

  test("models one-time reveal without exposing a stored hash", () => {
    const response = revealedApiKeyResponseSchema.parse({
      apiKey: {
        createdAt: CREATED_AT,
        expiresAt: null,
        id: API_KEY_ID,
        lastUsedAt: null,
        prefix: `mpk_${"A".repeat(12)}`,
        revokedAt: null,
        scopes: ["events:write"],
      },
      key: REVEALED_KEY,
      requestId: "request_key_create",
    });

    expect(response.key).toBe(REVEALED_KEY);
    expect(response.apiKey).not.toHaveProperty("secretHash");
  });
});
