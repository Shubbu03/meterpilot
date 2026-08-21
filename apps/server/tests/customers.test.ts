import { describe, expect, test } from "bun:test";
import type { Customer } from "@meterpilot/contracts/customers";
import type { OrganizationMembershipRole } from "@meterpilot/contracts/organizations";
import { createObservability } from "@meterpilot/observability";

import type { CustomerRepository } from "../src/features/customers/repository";
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
const CREATED_AT = "2026-08-20T05:00:00.000Z";

const customer: Customer = {
  archivedAt: null,
  billingTimezone: "UTC",
  createdAt: CREATED_AT,
  email: "billing@example.com",
  externalKey: "customer_acme",
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  metadata: { plan: "growth" },
  name: "Acme",
  subjects: [
    {
      createdAt: CREATED_AT,
      externalKey: "customer_acme",
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    },
  ],
};

function createCustomerTestApp(
  repository: CustomerRepository,
  role: OrganizationMembershipRole = "owner",
) {
  const membership = {
    createdAt: CREATED_AT,
    role,
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
    customerRepository: repository,
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

describe("customer routes", () => {
  test("lists tenant customers with subjects and private caching", async () => {
    let receivedPage: unknown;
    const app = createCustomerTestApp(
      createCustomerRepositoryStub({
        list(_tenant, page) {
          receivedPage = page;
          return Promise.resolve({ items: [customer], nextCursor: "next-customer" });
        },
      }),
    );

    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/customers?limit=1`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(receivedPage).toEqual({ limit: 1 });
    expect(await response.json()).toEqual({ items: [customer], nextCursor: "next-customer" });
  });

  test("creates a customer with an explicit subject mapping", async () => {
    let receivedInput: unknown;
    const app = createCustomerTestApp(
      createCustomerRepositoryStub({
        create(_tenant, input) {
          receivedInput = input;
          return Promise.resolve({ customer, status: "ok" });
        },
      }),
    );
    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/customers`, {
      body: JSON.stringify({
        email: "BILLING@EXAMPLE.COM",
        externalKey: "customer_acme",
        metadata: { plan: "growth" },
        name: "Acme",
        subjects: ["workspace_acme"],
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
        "X-Request-Id": "request_customer_create",
      },
      method: "POST",
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(receivedInput).toEqual({
      billingTimezone: "UTC",
      email: "billing@example.com",
      externalKey: "customer_acme",
      metadata: { plan: "growth" },
      name: "Acme",
      subjects: ["workspace_acme"],
    });
    expect(await response.json()).toEqual({
      customer,
      requestId: "request_customer_create",
    });
  });

  test("reads a customer only through the resolved tenant", async () => {
    let receivedOrganizationId: string | undefined;
    const app = createCustomerTestApp(
      createCustomerRepositoryStub({
        find(organizationId) {
          receivedOrganizationId = organizationId;
          return Promise.resolve(customer);
        },
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/customers/customer_acme`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(receivedOrganizationId).toBe(ORGANIZATION_ID);
    expect(await response.json()).toEqual({ customer });
  });

  test("maps subject ownership conflicts without disclosing another customer", async () => {
    const app = createCustomerTestApp(
      createCustomerRepositoryStub({
        attachSubject: () => Promise.resolve({ status: "conflict" }),
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/customers/customer_acme/subjects`,
      {
        body: JSON.stringify({ externalKey: "workspace_other" }),
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        method: "POST",
      },
    );
    const body = await response.text();

    expect(response.status).toBe(409);
    expect(body).not.toContain("customer_acme");
  });

  test("does not call persistence for cross-origin mutations", async () => {
    let createCalls = 0;
    const app = createCustomerTestApp(
      createCustomerRepositoryStub({
        create: () => {
          createCalls++;
          return Promise.resolve({ status: "forbidden" });
        },
      }),
    );
    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/customers`, {
      body: JSON.stringify({ externalKey: "customer_acme", name: "Acme" }),
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(createCalls).toBe(0);
  });
});
