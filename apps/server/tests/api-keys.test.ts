import { describe, expect, test } from "bun:test";
import type { ApiKey } from "@meterpilot/contracts/api-keys";
import type {
  OrganizationMembership,
  OrganizationMembershipRole,
} from "@meterpilot/contracts/organizations";
import { createObservability } from "@meterpilot/observability";

import type { ApiKeyService } from "../src/features/api-keys/service";
import type { AuthGateway } from "../src/features/identity/authentication";
import { createApp } from "../src/http/app";
import {
  createApiKeyServiceStub,
  createCatalogRepositoryStub,
  createCustomerRepositoryStub,
  createEntitlementRepositoryStub,
  createEventServiceStub,
  createMeterRepositoryStub,
  createOrganizationRepositoryStub,
  createUsageRepositoryStub,
} from "./helpers";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const API_KEY_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CREATED_AT = "2026-08-19T09:00:00.000Z";
const REVEALED_KEY = `mpk_${"A".repeat(12)}.${"B".repeat(43)}`;

function membership(role: OrganizationMembershipRole): OrganizationMembership {
  return {
    createdAt: CREATED_AT,
    role,
    user: { email: "owner@example.com", id: USER_ID, name: "Owner" },
  };
}

const apiKey: ApiKey = {
  createdAt: CREATED_AT,
  expiresAt: null,
  id: API_KEY_ID,
  lastUsedAt: null,
  prefix: `mpk_${"A".repeat(12)}`,
  revokedAt: null,
  scopes: ["events:write"],
};

function createApiKeyTestApp(service: ApiKeyService, role: OrganizationMembershipRole = "owner") {
  const actorMembership = membership(role);
  const auth: AuthGateway = {
    getSession: () => Promise.resolve({ session: { id: "session-1" }, user: actorMembership.user }),
    handler: () => Promise.resolve(new Response("auth")),
  };
  const organization = {
    createdAt: CREATED_AT,
    defaultTimezone: "UTC",
    id: ORGANIZATION_ID,
    name: "Acme",
    slug: "acme",
  } as const;

  return createApp({
    apiKeyService: service,
    auth,
    checkDatabaseHealth: () => Promise.resolve(),
    catalogRepository: createCatalogRepositoryStub(),
    customerRepository: createCustomerRepositoryStub(),
    entitlementRepository: createEntitlementRepositoryStub(),
    eventService: createEventServiceStub(),
    meterRepository: createMeterRepositoryStub(),
    observability: createObservability({
      environment: "test",
      level: "error",
      service: "meterpilot-server",
      write: () => undefined,
    }),
    organizationRepository: createOrganizationRepositoryStub({
      resolveTenant: () =>
        Promise.resolve({
          actorUserId: USER_ID,
          membership: actorMembership,
          organization,
        }),
    }),
    usageRepository: createUsageRepositoryStub(),
  });
}

describe("API key management routes", () => {
  test("creates and reveals a key once with no-store caching", async () => {
    let receivedInput: unknown;
    const app = createApiKeyTestApp(
      createApiKeyServiceStub({
        create(_tenant, input) {
          receivedInput = input;
          return Promise.resolve({
            revealed: { apiKey, key: REVEALED_KEY },
            status: "ok",
          });
        },
      }),
    );
    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/api-keys`, {
      body: JSON.stringify({ scopes: ["events:write"] }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
        "X-Request-Id": "request_create_key",
      },
      method: "POST",
    });
    const body = await response.text();

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(receivedInput).toEqual({ scopes: ["events:write"] });
    expect(JSON.parse(body)).toEqual({
      apiKey,
      key: REVEALED_KEY,
      requestId: "request_create_key",
    });
    expect(body).not.toContain("secretHash");
  });

  test("rejects duplicate and unknown scopes before calling the service", async () => {
    let createCalls = 0;
    const app = createApiKeyTestApp(
      createApiKeyServiceStub({
        create: () => {
          createCalls++;
          return Promise.resolve({ status: "forbidden" });
        },
      }),
    );

    for (const scopes of [["events:write", "events:write"], ["admin:all"]]) {
      const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/api-keys`, {
        body: JSON.stringify({ scopes }),
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        method: "POST",
      });

      expect(response.status).toBe(400);
    }
    expect(createCalls).toBe(0);
  });

  test("maps revoked rotation and missing revocation to stable errors", async () => {
    const revokedApp = createApiKeyTestApp(
      createApiKeyServiceStub({ rotate: () => Promise.resolve({ status: "revoked" }) }),
    );
    const rotateResponse = await revokedApp.request(
      `/v1/organizations/${ORGANIZATION_ID}/api-keys/${API_KEY_ID}/rotate`,
      { headers: { Origin: "http://localhost" }, method: "POST" },
    );
    expect(rotateResponse.status).toBe(409);

    const missingApp = createApiKeyTestApp(
      createApiKeyServiceStub({ revoke: () => Promise.resolve({ status: "not_found" }) }),
    );
    const revokeResponse = await missingApp.request(
      `/v1/organizations/${ORGANIZATION_ID}/api-keys/${API_KEY_ID}/revoke`,
      { headers: { Origin: "http://localhost" }, method: "POST" },
    );
    expect(revokeResponse.status).toBe(404);
  });

  test("returns a role-based denial when a developer lists keys", async () => {
    const app = createApiKeyTestApp(
      createApiKeyServiceStub({ list: () => Promise.resolve({ status: "forbidden" }) }),
      "developer",
    );
    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/api-keys`);

    expect(response.status).toBe(403);
  });

  test("rejects cross-origin creation before calling the service", async () => {
    let createCalls = 0;
    const app = createApiKeyTestApp(
      createApiKeyServiceStub({
        create: () => {
          createCalls++;
          return Promise.resolve({ status: "forbidden" });
        },
      }),
    );
    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/api-keys`, {
      body: JSON.stringify({ scopes: ["events:write"] }),
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
      },
      method: "POST",
    });
    const body = await response.text();

    expect(response.status).toBe(403);
    expect(createCalls).toBe(0);
    expect(body).not.toContain("attacker.example");
  });
});
