import { describe, expect, test } from "bun:test";
import { createObservability } from "@meterpilot/observability";

import type { ApiKeyPrincipal } from "../src/features/api-keys/repository";
import type { AuthGateway } from "../src/features/identity/authentication";
import type { UsageRepository } from "../src/features/usage/repository";
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

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const API_KEY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CREATED_AT = "2026-08-01T00:00:00.000Z";
const KEY = `mpk_${"A".repeat(12)}.${"B".repeat(43)}`;
const QUERY =
  "customerKey=customer_acme&meterKey=llm.tokens&from=2026-08-01T00%3A00%3A00.000Z&to=2026-08-02T00%3A00%3A00.000Z";

const principal: ApiKeyPrincipal = {
  apiKeyId: API_KEY_ID,
  organizationId: ORGANIZATION_ID,
  scopes: ["usage:read"],
};

function createUsageTestApp(
  repository: UsageRepository,
  authenticatedPrincipal: ApiKeyPrincipal | null = principal,
) {
  const auth: AuthGateway = {
    getSession: () => Promise.resolve(null),
    handler: () => Promise.resolve(new Response("auth")),
  };

  return createApp({
    apiKeyService: createApiKeyServiceStub({
      authenticate: () => Promise.resolve(authenticatedPrincipal),
    }),
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
    organizationRepository: createOrganizationRepositoryStub(),
    usageRepository: repository,
  });
}

function createDashboardUsageTestApp(repository: UsageRepository) {
  const user = { email: "owner@example.com", id: USER_ID, name: "Owner" };
  const auth: AuthGateway = {
    getSession: () => Promise.resolve({ session: { id: "session" }, user }),
    handler: () => Promise.resolve(new Response("auth")),
  };

  return createApp({
    apiKeyService: createApiKeyServiceStub(),
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
          membership: { createdAt: CREATED_AT, role: "owner", user },
          organization: {
            createdAt: CREATED_AT,
            defaultTimezone: "UTC",
            id: ORGANIZATION_ID,
            name: "Acme",
            slug: "acme",
          },
        }),
    }),
    usageRepository: repository,
  });
}

describe("usage routes", () => {
  test("allows a dashboard session to read usage inside its organization tenant", async () => {
    let receivedOrganizationId: string | undefined;
    const usage = {
      customerKey: "customer_acme",
      eventCount: "3",
      freshness: null,
      from: "2026-08-01T00:00:00.000Z",
      meterKey: "llm.tokens",
      quantity: "42",
      to: "2026-08-02T00:00:00.000Z",
    } as const;
    const app = createDashboardUsageTestApp(
      createUsageRepositoryStub({
        getTotal(organizationId) {
          receivedOrganizationId = organizationId;
          return Promise.resolve({ status: "ok", usage });
        },
      }),
    );

    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/usage?${QUERY}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(receivedOrganizationId).toBe(ORGANIZATION_ID);
    expect(await response.json()).toMatchObject({ usage });
  });

  test("returns exact totals and aggregate freshness for the API-key tenant", async () => {
    let receivedOrganizationId: string | undefined;
    const usage = {
      customerKey: "customer_acme",
      eventCount: "3",
      freshness: {
        lagSeconds: 2,
        maxReceivedAt: "2026-08-01T01:00:00.000Z",
        updatedAt: "2026-08-01T01:00:02.000Z",
      },
      from: "2026-08-01T00:00:00.000Z",
      meterKey: "llm.tokens",
      quantity: "9007199254740993.1",
      to: "2026-08-02T00:00:00.000Z",
    } as const;
    const app = createUsageTestApp(
      createUsageRepositoryStub({
        getTotal(organizationId) {
          receivedOrganizationId = organizationId;
          return Promise.resolve({ status: "ok", usage });
        },
      }),
    );
    const response = await app.request(`/v1/usage?${QUERY}`, {
      headers: { Authorization: `Bearer ${KEY}`, "X-Request-Id": "request_usage" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(receivedOrganizationId).toBe(ORGANIZATION_ID);
    expect(await response.json()).toEqual({ requestId: "request_usage", usage });
  });

  test("returns an hourly time series without customer profile data", async () => {
    const app = createUsageTestApp(
      createUsageRepositoryStub({
        getTimeseries: () =>
          Promise.resolve({
            customerKey: "customer_acme",
            freshness: null,
            from: "2026-08-01T00:00:00.000Z",
            meterKey: "llm.tokens",
            points: [
              {
                bucketStart: "2026-08-01T00:00:00.000Z",
                eventCount: "2",
                quantity: "12.5",
              },
            ],
            status: "ok",
            to: "2026-08-02T00:00:00.000Z",
          }),
      }),
    );
    const response = await app.request(`/v1/usage/timeseries?${QUERY}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain("email");
    expect(body).not.toContain("metadata");
    expect(JSON.parse(body).points).toHaveLength(1);
  });

  test("requires usage:read and does not invoke the repository without it", async () => {
    let calls = 0;
    const app = createUsageTestApp(
      createUsageRepositoryStub({
        getTotal: () => {
          calls++;
          return Promise.resolve({ status: "not_found" });
        },
      }),
      { ...principal, scopes: ["events:read"] },
    );
    const response = await app.request(`/v1/usage?${QUERY}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });

    expect(response.status).toBe(403);
    expect(calls).toBe(0);
  });

  test("rejects partial-bucket ranges before persistence", async () => {
    let calls = 0;
    const app = createUsageTestApp(
      createUsageRepositoryStub({
        getTotal: () => {
          calls++;
          return Promise.resolve({ status: "not_found" });
        },
      }),
    );
    const invalidQuery = QUERY.replace("00%3A00%3A00.000Z", "00%3A30%3A00.000Z");
    const response = await app.request(`/v1/usage?${invalidQuery}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });

    expect(response.status).toBe(400);
    expect(calls).toBe(0);
  });

  test("does not distinguish missing customer and meter identities", async () => {
    const app = createUsageTestApp(createUsageRepositoryStub());
    const response = await app.request(`/v1/usage?${QUERY}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).toContain("usage scope");
    expect(body).not.toContain("customer_acme");
    expect(body).not.toContain("llm.tokens");
  });
});
