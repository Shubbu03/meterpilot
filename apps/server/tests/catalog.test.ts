import { describe, expect, test } from "bun:test";
import type { Plan, PlanVersion, Subscription } from "@meterpilot/contracts/catalog";
import { createObservability } from "@meterpilot/observability";

import type { CatalogRepository } from "../src/features/catalog/repository";
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
const CREATED_AT = "2026-08-20T08:00:00.000Z";

const version: PlanVersion = {
  archivedAt: null,
  components: [
    {
      billingInterval: "month",
      componentKey: "api.calls",
      createdAt: CREATED_AT,
      entitlement: { enabled: true, mode: "hard", quantity: "1000" },
      featureKey: "api.calls",
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      price: { includedQuantity: "1000", model: "included_overage", overageRate: "0.01" },
      rounding: { minorUnitScale: 2, mode: "half_away_from_zero" },
    },
  ],
  createdAt: CREATED_AT,
  currency: "USD",
  effectiveFrom: "2026-09-01T00:00:00.000Z",
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  publishedAt: null,
  status: "draft",
  version: 1,
};

const plan: Plan = {
  archivedAt: null,
  createdAt: CREATED_AT,
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  key: "starter",
  name: "Starter",
  updatedAt: CREATED_AT,
  versions: [],
};

const subscription: Subscription = {
  billingAnchor: "2026-09-01T00:00:00.000Z",
  canceledAt: null,
  commercialSlot: "default",
  createdAt: CREATED_AT,
  customerKey: "acme",
  endsAt: null,
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  planKey: "starter",
  planVersion: 1,
  planVersionId: version.id,
  startsAt: "2026-09-01T00:00:00.000Z",
  status: "active",
  updatedAt: CREATED_AT,
};

function createCatalogTestApp(repository: CatalogRepository) {
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
    catalogRepository: repository,
    checkDatabaseHealth: () => Promise.resolve(),
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

describe("catalog routes", () => {
  test("creates a normalized plan through the resolved tenant", async () => {
    let receivedInput: unknown;
    const app = createCatalogTestApp(
      createCatalogRepositoryStub({
        createPlan(_tenant, input) {
          receivedInput = input;
          return Promise.resolve({ plan, status: "ok" });
        },
      }),
    );
    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/plans`, {
      body: JSON.stringify({ key: "starter", name: " Starter " }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
        "X-Request-Id": "request_plan_create",
      },
      method: "POST",
    });

    expect(response.status).toBe(201);
    expect(receivedInput).toEqual({ key: "starter", name: "Starter" });
    expect(await response.json()).toEqual({ plan, requestId: "request_plan_create" });
  });

  test("creates an exact-decimal draft version with normalized policy defaults", async () => {
    let receivedInput: unknown;
    const app = createCatalogTestApp(
      createCatalogRepositoryStub({
        createVersion(_tenant, _planKey, input) {
          receivedInput = input;
          return Promise.resolve({ planVersion: version, status: "ok" });
        },
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/plans/starter/versions`,
      {
        body: JSON.stringify({
          components: [
            {
              componentKey: "api.calls",
              entitlement: { mode: "hard", quantity: "1000" },
              featureKey: "api.calls",
              price: {
                includedQuantity: "1000",
                model: "included_overage",
                overageRate: "0.01",
              },
            },
          ],
          currency: "USD",
          effectiveFrom: "2026-09-01T00:00:00.000Z",
        }),
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        method: "POST",
      },
    );

    expect(response.status).toBe(201);
    expect(receivedInput).toMatchObject({
      components: [
        {
          billingInterval: "month",
          entitlement: { enabled: true, mode: "hard", quantity: "1000" },
          rounding: { minorUnitScale: 2, mode: "half_away_from_zero" },
        },
      ],
    });
  });

  test("publishes an explicit immutable version", async () => {
    const published = { ...version, publishedAt: CREATED_AT, status: "published" as const };
    const app = createCatalogTestApp(
      createCatalogRepositoryStub({
        publishVersion: () => Promise.resolve({ planVersion: published, status: "ok" }),
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/plans/starter/versions/1/publish`,
      { headers: { Origin: "http://localhost" }, method: "POST" },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { planVersion: PlanVersion };
    expect(body.planVersion).toEqual(published);
  });

  test("duplicates a published version into a draft with selective price overrides", async () => {
    const published = {
      ...version,
      publishedAt: CREATED_AT,
      status: "published" as const,
    };
    const candidate = {
      ...version,
      effectiveFrom: "2026-10-01T00:00:00.000Z",
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      version: 2,
    };
    let receivedInput: unknown;
    const app = createCatalogTestApp(
      createCatalogRepositoryStub({
        createVersion(_tenant, _planKey, input) {
          receivedInput = input;
          return Promise.resolve({ planVersion: candidate, status: "ok" });
        },
        findPlan: () => Promise.resolve({ ...plan, versions: [published] }),
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/plans/starter/versions/1/duplicate`,
      {
        body: JSON.stringify({
          effectiveFrom: candidate.effectiveFrom,
          priceOverrides: {
            "api.calls": { model: "per_unit", unitRate: "0.02" },
          },
        }),
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        method: "POST",
      },
    );

    expect(response.status).toBe(201);
    expect(receivedInput).toEqual({
      components: [
        {
          billingInterval: "month",
          componentKey: "api.calls",
          entitlement: published.components[0]?.entitlement,
          featureKey: "api.calls",
          price: { model: "per_unit", unitRate: "0.02" },
          rounding: { minorUnitScale: 2, mode: "half_away_from_zero" },
        },
      ],
      currency: "USD",
      effectiveFrom: candidate.effectiveFrom,
    });
    expect(await response.json()).toMatchObject({ planVersion: candidate });
  });

  test("rejects a candidate override for a component absent from the source", async () => {
    const published = {
      ...version,
      publishedAt: CREATED_AT,
      status: "published" as const,
    };
    let createCalls = 0;
    const app = createCatalogTestApp(
      createCatalogRepositoryStub({
        createVersion: () => {
          createCalls++;
          return Promise.resolve({ status: "forbidden" });
        },
        findPlan: () => Promise.resolve({ ...plan, versions: [published] }),
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/plans/starter/versions/1/duplicate`,
      {
        body: JSON.stringify({
          effectiveFrom: "2026-10-01T00:00:00.000Z",
          priceOverrides: { unknown: { amount: "10", model: "flat" } },
        }),
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        method: "POST",
      },
    );

    expect(response.status).toBe(400);
    expect(createCalls).toBe(0);
  });

  test("creates a subscription with a normalized commercial slot", async () => {
    let receivedInput: unknown;
    const app = createCatalogTestApp(
      createCatalogRepositoryStub({
        createSubscription(_tenant, input) {
          receivedInput = input;
          return Promise.resolve({ status: "ok", subscription });
        },
      }),
    );
    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/subscriptions`, {
      body: JSON.stringify({
        billingAnchor: "2026-09-01T00:00:00.000Z",
        customerKey: "acme",
        planKey: "starter",
        planVersion: 1,
        startsAt: "2026-09-01T00:00:00.000Z",
      }),
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      method: "POST",
    });

    expect(response.status).toBe(201);
    expect(receivedInput).toMatchObject({ commercialSlot: "default", endsAt: null });
    const body = (await response.json()) as { subscription: Subscription };
    expect(body.subscription).toEqual(subscription);
  });

  test("does not call persistence for an invalid graduated definition", async () => {
    let calls = 0;
    const app = createCatalogTestApp(
      createCatalogRepositoryStub({
        createVersion: () => {
          calls++;
          return Promise.resolve({ status: "forbidden" });
        },
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/plans/starter/versions`,
      {
        body: JSON.stringify({
          components: [
            {
              componentKey: "api.calls",
              featureKey: "api.calls",
              price: { model: "graduated", tiers: [{ unitRate: "1", upTo: "100" }] },
            },
          ],
          currency: "USD",
          effectiveFrom: "2026-09-01T00:00:00.000Z",
        }),
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        method: "POST",
      },
    );

    expect(response.status).toBe(400);
    expect(calls).toBe(0);
  });

  test("returns stable lifecycle conflicts without leaking persistence details", async () => {
    const app = createCatalogTestApp(
      createCatalogRepositoryStub({
        createSubscription: () => Promise.resolve({ status: "conflict" }),
      }),
    );
    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/subscriptions`, {
      body: JSON.stringify({
        billingAnchor: "2026-09-01T00:00:00.000Z",
        customerKey: "acme",
        planKey: "starter",
        planVersion: 1,
        startsAt: "2026-09-01T00:00:00.000Z",
      }),
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      method: "POST",
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "conflict" } });
  });
});
