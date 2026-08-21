import { describe, expect, test } from "bun:test";
import type { Meter, MeterVersion } from "@meterpilot/contracts/meters";
import { createObservability } from "@meterpilot/observability";

import type { AuthGateway } from "../src/features/identity/authentication";
import type { MeterRepository } from "../src/features/meters/repository";
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

const version: MeterVersion = {
  aggregation: "sum",
  createdAt: CREATED_AT,
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  effectiveTo: null,
  eventType: "llm.tokens",
  filters: [{ operation: "equals", property: "model", value: "small" }],
  groupByKeys: ["region"],
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  publishedAt: null,
  valueProperty: "tokens",
  version: 1,
};

const meter: Meter = {
  createdAt: CREATED_AT,
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  key: "llm.tokens",
  name: "LLM tokens",
  status: "draft",
  updatedAt: CREATED_AT,
  versions: [],
};

function createMeterTestApp(repository: MeterRepository) {
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
    apiKeyService: createApiKeyServiceStub(),
    auth,
    checkDatabaseHealth: () => Promise.resolve(),
    catalogRepository: createCatalogRepositoryStub(),
    customerRepository: createCustomerRepositoryStub(),
    entitlementRepository: createEntitlementRepositoryStub(),
    eventService: createEventServiceStub(),
    meterRepository: repository,
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

describe("meter routes", () => {
  test("creates a draft meter", async () => {
    let receivedInput: unknown;
    const app = createMeterTestApp(
      createMeterRepositoryStub({
        create(_tenant, input) {
          receivedInput = input;
          return Promise.resolve({ meter, status: "ok" });
        },
      }),
    );
    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/meters`, {
      body: JSON.stringify({ key: "llm.tokens", name: " LLM tokens " }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
        "X-Request-Id": "request_meter_create",
      },
      method: "POST",
    });

    expect(response.status).toBe(201);
    expect(receivedInput).toEqual({ key: "llm.tokens", name: "LLM tokens" });
    expect(await response.json()).toEqual({ meter, requestId: "request_meter_create" });
  });

  test("creates an immutable version with normalized defaults", async () => {
    let receivedInput: unknown;
    const app = createMeterTestApp(
      createMeterRepositoryStub({
        createVersion(_tenant, _meterKey, input) {
          receivedInput = input;
          return Promise.resolve({ meterVersion: version, status: "ok" });
        },
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/meters/llm.tokens/versions`,
      {
        body: JSON.stringify({
          aggregation: "sum",
          effectiveFrom: "2026-08-01T00:00:00.000Z",
          eventType: "llm.tokens",
          filters: [{ operation: "equals", property: "model", value: "small" }],
          groupByKeys: ["region"],
          valueProperty: "tokens",
        }),
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        method: "POST",
      },
    );

    expect(response.status).toBe(201);
    expect(receivedInput).toEqual({
      aggregation: "sum",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      effectiveTo: null,
      eventType: "llm.tokens",
      filters: [{ operation: "equals", property: "model", value: "small" }],
      groupByKeys: ["region"],
      valueProperty: "tokens",
    });
  });

  test("publishes a version and exposes its durable rebuild job", async () => {
    const publishedVersion = { ...version, publishedAt: CREATED_AT };
    const rebuildJobId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const app = createMeterTestApp(
      createMeterRepositoryStub({
        publish: () =>
          Promise.resolve({ meterVersion: publishedVersion, rebuildJobId, status: "ok" }),
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/meters/llm.tokens/versions/1/publish`,
      {
        headers: { Origin: "http://localhost", "X-Request-Id": "request_publish" },
        method: "POST",
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      meterVersion: publishedVersion,
      rebuildJobId,
      requestId: "request_publish",
    });
  });

  test("rejects invalid effective ranges before persistence", async () => {
    let calls = 0;
    const app = createMeterTestApp(
      createMeterRepositoryStub({
        createVersion: () => {
          calls++;
          return Promise.resolve({ status: "forbidden" });
        },
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/meters/llm.tokens/versions`,
      {
        body: JSON.stringify({
          aggregation: "count",
          effectiveFrom: "2026-08-02T00:00:00.000Z",
          effectiveTo: "2026-08-01T00:00:00.000Z",
          eventType: "api.request",
        }),
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        method: "POST",
      },
    );

    expect(response.status).toBe(400);
    expect(calls).toBe(0);
  });

  test("lists only through the resolved tenant and validates cursors", async () => {
    let receivedTenantId: string | undefined;
    const app = createMeterTestApp(
      createMeterRepositoryStub({
        list(tenant) {
          receivedTenantId = tenant.organization.id;
          return Promise.resolve({ items: [meter], nextCursor: null });
        },
      }),
    );
    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/meters?limit=10`);

    expect(response.status).toBe(200);
    expect(receivedTenantId).toBe(ORGANIZATION_ID);
    expect(await response.json()).toEqual({ items: [meter], nextCursor: null });
  });
});
