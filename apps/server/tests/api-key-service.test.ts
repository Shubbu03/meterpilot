import { describe, expect, test } from "bun:test";
import type { ApiKey } from "@meterpilot/contracts/api-keys";

import { hashApiKey, type GeneratedApiKey } from "../src/features/api-keys/credentials";
import { createApiKeyService } from "../src/features/api-keys/service";
import type { TenantAuthorization } from "../src/features/organizations/repository";
import { createApiKeyRepositoryStub } from "./helpers";

const NOW = new Date("2026-08-19T09:00:00.000Z");
const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_KEY_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const KEY = `mpk_${"A".repeat(12)}.${"B".repeat(43)}`;
const PREFIX = `mpk_${"A".repeat(12)}`;
const HASH = hashApiKey(KEY);

const tenant: TenantAuthorization = {
  actorUserId: USER_ID,
  membership: {
    createdAt: NOW.toISOString(),
    role: "owner",
    user: { email: "owner@example.com", id: USER_ID, name: "Owner" },
  },
  organization: {
    createdAt: NOW.toISOString(),
    defaultTimezone: "UTC",
    id: ORGANIZATION_ID,
    name: "Acme",
    slug: "acme",
  },
};

const apiKey: ApiKey = {
  createdAt: NOW.toISOString(),
  expiresAt: null,
  id: API_KEY_ID,
  lastUsedAt: null,
  prefix: PREFIX,
  revokedAt: null,
  scopes: ["events:write"],
};

const credential: GeneratedApiKey = {
  key: KEY,
  prefix: PREFIX,
  secretHash: HASH,
};

describe("API key service", () => {
  test("reveals a generated key once while persisting only its hash", async () => {
    let persistedWrite: unknown;
    const repository = createApiKeyRepositoryStub({
      create(_tenant, write) {
        persistedWrite = write;
        return Promise.resolve({ apiKey, status: "ok" });
      },
    });
    const service = createApiKeyService(repository, {
      generate: () => credential,
      now: () => NOW,
    });
    const result = await service.create(tenant, { scopes: ["events:write"] }, "request_create");

    expect(result).toEqual({ revealed: { apiKey, key: KEY }, status: "ok" });
    expect(persistedWrite).toEqual({
      createdAt: NOW,
      expiresAt: null,
      prefix: PREFIX,
      scopes: ["events:write"],
      secretHash: HASH,
    });
    expect(JSON.stringify(persistedWrite)).not.toContain(KEY);
  });

  test("rejects past expiration before generating or writing a credential", async () => {
    let generated = false;
    let writes = 0;
    const service = createApiKeyService(
      createApiKeyRepositoryStub({
        create: () => {
          writes++;
          return Promise.resolve({ status: "prefix_conflict" });
        },
      }),
      {
        generate: () => {
          generated = true;
          return credential;
        },
        now: () => NOW,
      },
    );

    expect(
      await service.create(
        tenant,
        { expiresAt: "2026-08-19T08:59:59.000Z", scopes: ["events:write"] },
        "request_expired",
      ),
    ).toEqual({ status: "invalid_expiration" });
    expect(generated).toBe(false);
    expect(writes).toBe(0);
  });

  test("retries bounded prefix collisions", async () => {
    let attempts = 0;
    const service = createApiKeyService(
      createApiKeyRepositoryStub({
        create: () => {
          attempts++;
          return Promise.resolve({ status: "prefix_conflict" });
        },
      }),
      { generate: () => credential, now: () => NOW },
    );

    expect(await service.create(tenant, { scopes: ["events:write"] }, "request_collision")).toEqual(
      { status: "conflict" },
    );
    expect(attempts).toBe(3);
  });

  test("authenticates an active hashed key and atomically records use", async () => {
    let activatedAt: Date | undefined;
    const service = createApiKeyService(
      createApiKeyRepositoryStub({
        activate(_candidate, usedAt) {
          activatedAt = usedAt;
          return Promise.resolve(true);
        },
        findAuthenticationCandidate: () =>
          Promise.resolve({
            apiKeyId: API_KEY_ID,
            expiresAt: null,
            organizationId: ORGANIZATION_ID,
            revokedAt: null,
            scopes: ["events:write"],
            secretHash: HASH,
          }),
      }),
      { now: () => NOW },
    );

    expect(await service.authenticate(KEY)).toEqual({
      apiKeyId: API_KEY_ID,
      organizationId: ORGANIZATION_ID,
      scopes: ["events:write"],
    });
    expect(activatedAt).toEqual(NOW);
  });

  test("rejects malformed, tampered, revoked, and expired keys", async () => {
    let lookups = 0;
    const candidate = {
      apiKeyId: API_KEY_ID,
      expiresAt: null,
      organizationId: ORGANIZATION_ID,
      revokedAt: null,
      scopes: ["events:write"] as const,
      secretHash: HASH,
    };
    const repository = createApiKeyRepositoryStub({
      findAuthenticationCandidate: () => {
        lookups++;
        return Promise.resolve(candidate);
      },
    });
    const service = createApiKeyService(repository, { now: () => NOW });

    expect(await service.authenticate("malformed")).toBeNull();
    expect(lookups).toBe(0);
    expect(await service.authenticate(`${KEY.slice(0, -1)}C`)).toBeNull();

    const revokedService = createApiKeyService(
      createApiKeyRepositoryStub({
        findAuthenticationCandidate: () =>
          Promise.resolve({ ...candidate, revokedAt: new Date("2026-08-19T08:00:00.000Z") }),
      }),
      { now: () => NOW },
    );
    expect(await revokedService.authenticate(KEY)).toBeNull();

    const expiredService = createApiKeyService(
      createApiKeyRepositoryStub({
        findAuthenticationCandidate: () =>
          Promise.resolve({ ...candidate, expiresAt: new Date("2026-08-19T08:00:00.000Z") }),
      }),
      { now: () => NOW },
    );
    expect(await expiredService.authenticate(KEY)).toBeNull();
  });
});
