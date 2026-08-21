import { describe, expect, test } from "bun:test";
import type {
  EntitlementBalance,
  Feature,
  QuotaGrant,
  QuotaReservation,
} from "@meterpilot/contracts/entitlements";
import { createObservability } from "@meterpilot/observability";

import type { EntitlementRepository } from "../src/features/entitlements/repository";
import type { AuthGateway } from "../src/features/identity/authentication";
import type { ApiKeyService } from "../src/features/api-keys/service";
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
const CREATED_AT = "2026-08-20T05:00:00.000Z";

const feature: Feature = {
  createdAt: CREATED_AT,
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  key: "ai.tokens",
  meterKey: "llm.tokens",
  name: "AI tokens",
  updatedAt: CREATED_AT,
};

const entitlement: EntitlementBalance = {
  allowed: true,
  availableQuantity: "1000",
  committedQuantity: "0",
  customerKey: "customer_acme",
  enabled: true,
  featureKey: "ai.tokens",
  grantedQuantity: "1000",
  mode: "hard",
  overageQuantity: "0",
  periodEnd: "2026-09-01T00:00:00.000Z",
  periodStart: "2026-08-01T00:00:00.000Z",
  reservedQuantity: "0",
  updatedAt: CREATED_AT,
  version: 2,
};

const grant: QuotaGrant = {
  createdAt: CREATED_AT,
  effectiveAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2026-09-01T00:00:00.000Z",
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  quantity: "1000",
  reason: "Monthly allowance",
};

const reservation: QuotaReservation = {
  committedQuantity: null,
  completedAt: null,
  createdAt: CREATED_AT,
  customerKey: "customer_acme",
  entitlementId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  expiresAt: "2026-08-20T06:00:00.000Z",
  featureKey: "ai.tokens",
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  idempotencyKey: "request-1",
  requestedQuantity: "10",
  status: "pending",
  usageEventKey: null,
};

function createEntitlementTestApp(
  repository: EntitlementRepository,
  apiKeyService: ApiKeyService = createApiKeyServiceStub(),
) {
  const membership = {
    createdAt: CREATED_AT,
    role: "owner" as const,
    user: { email: "owner@example.com", id: USER_ID, name: "Owner" },
  };
  const auth: AuthGateway = {
    getSession: () => Promise.resolve({ session: { id: "session-1" }, user: membership.user }),
    handler: () => Promise.resolve(new Response("auth")),
  };

  return createApp({
    apiKeyService,
    auth,
    checkDatabaseHealth: () => Promise.resolve(),
    catalogRepository: createCatalogRepositoryStub(),
    customerRepository: createCustomerRepositoryStub(),
    entitlementRepository: repository,
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
          membership,
          organization: {
            createdAt: CREATED_AT,
            defaultTimezone: "UTC",
            id: ORGANIZATION_ID,
            name: "Acme",
            slug: "acme",
          },
        }),
    }),
    usageRepository: createUsageRepositoryStub(),
  });
}

describe("entitlement routes", () => {
  test("lists tenant features with private caching", async () => {
    let receivedPage: unknown;
    const app = createEntitlementTestApp(
      createEntitlementRepositoryStub({
        listFeatures(_tenant, page) {
          receivedPage = page;
          return Promise.resolve({ items: [feature], nextCursor: "next-feature" });
        },
      }),
    );

    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/features?limit=1`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(receivedPage).toEqual({ limit: 1 });
    expect(await response.json()).toEqual({ items: [feature], nextCursor: "next-feature" });
  });

  test("creates a tenant-scoped metered feature", async () => {
    let receivedInput: unknown;
    const app = createEntitlementTestApp(
      createEntitlementRepositoryStub({
        createFeature(_tenant, input) {
          receivedInput = input;
          return Promise.resolve({ feature, status: "ok" });
        },
      }),
    );
    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/features`, {
      body: JSON.stringify({ key: "ai.tokens", meterKey: "llm.tokens", name: " AI tokens " }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
        "X-Request-Id": "request_feature",
      },
      method: "POST",
    });

    expect(response.status).toBe(201);
    expect(receivedInput).toEqual({ key: "ai.tokens", meterKey: "llm.tokens", name: "AI tokens" });
    expect(await response.json()).toEqual({ feature, requestId: "request_feature" });
  });

  test("configures a bounded entitlement period", async () => {
    let receivedInput: unknown;
    const app = createEntitlementTestApp(
      createEntitlementRepositoryStub({
        configure(_tenant, _customerKey, _featureKey, input) {
          receivedInput = input;
          return Promise.resolve({
            entitlement: { ...entitlement, grantedQuantity: "0" },
            status: "ok",
          });
        },
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/customers/customer_acme/entitlements/ai.tokens`,
      {
        body: JSON.stringify({
          mode: "hard",
          periodEnd: "2026-09-01T00:00:00.000Z",
          periodStart: "2026-08-01T00:00:00.000Z",
        }),
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        method: "PUT",
      },
    );

    expect(response.status).toBe(201);
    expect(receivedInput).toEqual({
      enabled: true,
      mode: "hard",
      periodEnd: "2026-09-01T00:00:00.000Z",
      periodStart: "2026-08-01T00:00:00.000Z",
    });
  });

  test("reads an explicitly advisory or hard balance with freshness", async () => {
    let receivedAt: Date | undefined;
    let receivedOrganizationId: string | undefined;
    const app = createEntitlementTestApp(
      createEntitlementRepositoryStub({
        findBalance(organizationId, _customerKey, _featureKey, at) {
          receivedOrganizationId = organizationId;
          receivedAt = at;
          return Promise.resolve(entitlement);
        },
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/customers/customer_acme/entitlements/ai.tokens`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(receivedOrganizationId).toBe(ORGANIZATION_ID);
    expect(receivedAt?.getTime()).toBeFinite();
    const body = (await response.json()) as { entitlement: EntitlementBalance };
    expect(body.entitlement.mode).toBe("hard");
  });

  test("adds exact grants without numeric coercion", async () => {
    let receivedQuantity: string | undefined;
    const app = createEntitlementTestApp(
      createEntitlementRepositoryStub({
        addGrant(_tenant, _customerKey, _featureKey, input) {
          receivedQuantity = input.quantity;
          return Promise.resolve({ entitlement, grant, status: "ok" });
        },
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/customers/customer_acme/entitlements/ai.tokens/grants`,
      {
        body: JSON.stringify({
          effectiveAt: grant.effectiveAt,
          expiresAt: grant.expiresAt,
          quantity: "1000",
          reason: grant.reason,
        }),
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        method: "POST",
      },
    );

    expect(response.status).toBe(201);
    expect(receivedQuantity).toBe("1000");
    expect(await response.json()).toEqual({
      entitlement,
      grant,
      requestId: expect.any(String),
    });
  });

  test("blocks cross-origin grants before repository access", async () => {
    let calls = 0;
    const app = createEntitlementTestApp(
      createEntitlementRepositoryStub({
        addGrant: () => {
          calls++;
          return Promise.resolve({ status: "forbidden" });
        },
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/customers/customer_acme/entitlements/ai.tokens/grants`,
      {
        body: JSON.stringify({
          effectiveAt: grant.effectiveAt,
          quantity: "1000",
          reason: grant.reason,
        }),
        headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
        method: "POST",
      },
    );

    expect(response.status).toBe(403);
    expect(calls).toBe(0);
  });

  test("creates an exact hard-quota reservation", async () => {
    let receivedInput: unknown;
    const app = createEntitlementTestApp(
      createEntitlementRepositoryStub({
        reserve(_tenant, _customerKey, input) {
          receivedInput = input;
          return Promise.resolve({
            entitlement: { ...entitlement, availableQuantity: "990", reservedQuantity: "10" },
            reservation,
            status: "ok",
          });
        },
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/customers/customer_acme/reservations`,
      {
        body: JSON.stringify({
          expiresAt: reservation.expiresAt,
          featureKey: reservation.featureKey,
          idempotencyKey: reservation.idempotencyKey,
          quantity: reservation.requestedQuantity,
        }),
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        method: "POST",
      },
    );

    expect(response.status).toBe(201);
    expect(receivedInput).toEqual({
      expiresAt: reservation.expiresAt,
      featureKey: reservation.featureKey,
      idempotencyKey: reservation.idempotencyKey,
      quantity: reservation.requestedQuantity,
    });
  });

  test("commits a reservation with bounded event properties", async () => {
    let receivedInput: unknown;
    const committed = {
      ...reservation,
      committedQuantity: "8",
      completedAt: "2026-08-20T05:30:00.000Z",
      status: "committed" as const,
      usageEventKey: `quota_reservation:${reservation.id}`,
    };
    const app = createEntitlementTestApp(
      createEntitlementRepositoryStub({
        commitReservation(_tenant, _reservationId, input) {
          receivedInput = input;
          return Promise.resolve({ entitlement, reservation: committed, status: "ok" });
        },
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/reservations/${reservation.id}/commit`,
      {
        body: JSON.stringify({
          occurredAt: "2026-08-20T05:30:00.000Z",
          properties: { model: "gpt-5" },
          quantity: "8",
        }),
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        method: "POST",
      },
    );

    expect(response.status).toBe(200);
    expect(receivedInput).toEqual({
      occurredAt: "2026-08-20T05:30:00.000Z",
      properties: { model: "gpt-5" },
      quantity: "8",
    });
    expect((await response.json()) as { reservation: QuotaReservation }).toMatchObject({
      reservation: committed,
    });
  });

  test("returns stable quota errors", async () => {
    const app = createEntitlementTestApp(
      createEntitlementRepositoryStub({
        reserve: () => Promise.resolve({ status: "over_limit" }),
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/customers/customer_acme/reservations`,
      {
        body: JSON.stringify({
          expiresAt: reservation.expiresAt,
          featureKey: reservation.featureKey,
          idempotencyKey: reservation.idempotencyKey,
          quantity: reservation.requestedQuantity,
        }),
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        method: "POST",
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "quota_exceeded" } });
  });

  test("releases a pending reservation idempotently", async () => {
    const released = {
      ...reservation,
      completedAt: "2026-08-20T05:20:00.000Z",
      status: "released" as const,
    };
    const app = createEntitlementTestApp(
      createEntitlementRepositoryStub({
        releaseReservation: () =>
          Promise.resolve({ entitlement, reservation: released, status: "ok" }),
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/reservations/${reservation.id}/release`,
      {
        headers: { Origin: "http://localhost" },
        method: "POST",
      },
    );

    expect(response.status).toBe(200);
    expect((await response.json()) as { reservation: QuotaReservation }).toMatchObject({
      reservation: released,
    });
  });

  test("supports server-to-server reservations with a scoped API key", async () => {
    let receivedOrganizationId: string | undefined;
    const app = createEntitlementTestApp(
      createEntitlementRepositoryStub({
        reserve(authorization) {
          receivedOrganizationId =
            "organizationId" in authorization
              ? authorization.organizationId
              : authorization.organization.id;
          return Promise.resolve({ entitlement, reservation, status: "ok" });
        },
      }),
      createApiKeyServiceStub({
        authenticate: () =>
          Promise.resolve({
            apiKeyId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            organizationId: ORGANIZATION_ID,
            scopes: ["reservations:write"],
          }),
      }),
    );
    const response = await app.request("/v1/customers/customer_acme/reservations", {
      body: JSON.stringify({
        expiresAt: reservation.expiresAt,
        featureKey: reservation.featureKey,
        idempotencyKey: reservation.idempotencyKey,
        quantity: reservation.requestedQuantity,
      }),
      headers: { Authorization: "Bearer test-key", "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(201);
    expect(receivedOrganizationId).toBe(ORGANIZATION_ID);
  });

  test("rejects quota operations when an API key lacks reservation scope", async () => {
    let calls = 0;
    const app = createEntitlementTestApp(
      createEntitlementRepositoryStub({
        reserve: () => {
          calls++;
          return Promise.resolve({ status: "forbidden" });
        },
      }),
      createApiKeyServiceStub({
        authenticate: () =>
          Promise.resolve({
            apiKeyId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            organizationId: ORGANIZATION_ID,
            scopes: ["events:write"],
          }),
      }),
    );
    const response = await app.request("/v1/customers/customer_acme/reservations", {
      body: JSON.stringify({
        expiresAt: reservation.expiresAt,
        featureKey: reservation.featureKey,
        idempotencyKey: reservation.idempotencyKey,
        quantity: reservation.requestedQuantity,
      }),
      headers: { Authorization: "Bearer test-key", "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(calls).toBe(0);
  });
});
