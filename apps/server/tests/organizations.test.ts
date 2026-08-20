import { describe, expect, test } from "bun:test";
import type {
  OrganizationListItem,
  OrganizationMembership,
} from "@meterpilot/contracts/organizations";
import { createObservability } from "@meterpilot/observability";

import type { AuthGateway } from "../src/features/identity/authentication";
import type { OrganizationRepository } from "../src/features/organizations/repository";
import { createApp } from "../src/http/app";
import { createApiKeyServiceStub, createOrganizationRepositoryStub } from "./helpers";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CREATED_AT = "2026-08-19T09:00:00.000Z";

const ownerMembership: OrganizationMembership = {
  createdAt: CREATED_AT,
  role: "owner",
  user: {
    email: "owner@example.com",
    id: USER_ID,
    name: "Owner",
  },
};

const organizationItem: OrganizationListItem = {
  membership: ownerMembership,
  organization: {
    createdAt: CREATED_AT,
    defaultTimezone: "UTC",
    id: ORGANIZATION_ID,
    name: "Acme",
    slug: "acme",
  },
};

function createOrganizationTestApp(repository: OrganizationRepository) {
  const auth: AuthGateway = {
    getSession: () =>
      Promise.resolve({
        session: { id: "session-1" },
        user: ownerMembership.user,
      }),
    handler: () => Promise.resolve(new Response("auth")),
  };

  return createApp({
    apiKeyService: createApiKeyServiceStub(),
    auth,
    checkDatabaseHealth: () => Promise.resolve(),
    observability: createObservability({
      environment: "test",
      level: "error",
      service: "meterpilot-server",
      write: () => undefined,
    }),
    organizationRepository: repository,
  });
}

describe("organization routes", () => {
  test("creates an organization and its owner membership together", async () => {
    let receivedInput: unknown;
    const repository = createOrganizationRepositoryStub({
      createOrganization(_actor, input) {
        receivedInput = input;
        return Promise.resolve(organizationItem);
      },
    });
    const app = createOrganizationTestApp(repository);
    const response = await app.request("/v1/organizations", {
      body: JSON.stringify({ name: " Acme ", slug: "acme" }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
        "X-Request-Id": "request_create_org",
      },
      method: "POST",
    });

    expect(response.status).toBe(201);
    expect(receivedInput).toEqual({ defaultTimezone: "UTC", name: "Acme", slug: "acme" });
    expect(await response.json()).toEqual({
      ...organizationItem,
      requestId: "request_create_org",
    });
  });

  test("returns cursor-paginated organizations for the authenticated user", async () => {
    const repository = createOrganizationRepositoryStub({
      listOrganizations: () =>
        Promise.resolve({ items: [organizationItem], nextCursor: "next-page" }),
    });
    const app = createOrganizationTestApp(repository);
    const response = await app.request("/v1/organizations?limit=10");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [organizationItem],
      nextCursor: "next-page",
    });
  });

  test("maps last-owner protection to a stable conflict", async () => {
    const repository = createOrganizationRepositoryStub({
      resolveTenant: () =>
        Promise.resolve({
          actorUserId: USER_ID,
          ...organizationItem,
        }),
      updateMembership: () => Promise.resolve({ status: "last_owner" }),
    });
    const app = createOrganizationTestApp(repository);
    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/members/${USER_ID}`, {
      body: JSON.stringify({ role: "admin" }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
        "X-Request-Id": "request_last_owner",
      },
      method: "PATCH",
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "conflict",
        message: "An organization must retain an owner.",
        requestId: "request_last_owner",
      },
    });
  });

  test("rejects cross-origin organization mutations", async () => {
    let createCalls = 0;
    const repository = createOrganizationRepositoryStub({
      createOrganization: () => {
        createCalls++;
        return Promise.resolve(organizationItem);
      },
    });
    const app = createOrganizationTestApp(repository);
    const response = await app.request("/v1/organizations", {
      body: JSON.stringify({ name: "Acme", slug: "acme" }),
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
      },
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(createCalls).toBe(0);
    expect((await response.text()).includes("attacker.example")).toBe(false);
  });
});
