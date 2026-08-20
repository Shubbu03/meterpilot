import { describe, expect, test } from "bun:test";
import type { Organization, OrganizationMembership } from "@meterpilot/contracts/organizations";
import { createObservability } from "@meterpilot/observability";

import type { AuthGateway } from "../src/features/identity/authentication";
import type { TenantAuthorization } from "../src/features/organizations/repository";
import { createApp } from "../src/http/app";
import {
  createApiKeyServiceStub,
  createEventServiceStub,
  createOrganizationRepositoryStub,
} from "./helpers";

const USER_A_ID = "11111111-1111-4111-8111-111111111111";
const USER_B_ID = "22222222-2222-4222-8222-222222222222";
const ORGANIZATION_A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORGANIZATION_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CREATED_AT = "2026-08-19T09:00:00.000Z";

function organization(id: string, slug: string): Organization {
  return {
    createdAt: CREATED_AT,
    defaultTimezone: "UTC",
    id,
    name: slug.toUpperCase(),
    slug,
  };
}

function membership(userId: string): OrganizationMembership {
  return {
    createdAt: CREATED_AT,
    role: "owner",
    user: {
      email: `${userId.slice(0, 4)}@example.com`,
      id: userId,
      name: userId === USER_A_ID ? "User A" : "User B",
    },
  };
}

const tenantA: TenantAuthorization = {
  actorUserId: USER_A_ID,
  membership: membership(USER_A_ID),
  organization: organization(ORGANIZATION_A_ID, "organization-a"),
};
const tenantB: TenantAuthorization = {
  actorUserId: USER_B_ID,
  membership: membership(USER_B_ID),
  organization: organization(ORGANIZATION_B_ID, "organization-b"),
};

function createIsolationApp(authenticatedUserId: string | null) {
  let apiKeyListReads = 0;
  let memberListReads = 0;
  const tenants = new Map([
    [`${USER_A_ID}:${ORGANIZATION_A_ID}`, tenantA],
    [`${USER_B_ID}:${ORGANIZATION_B_ID}`, tenantB],
  ]);
  const auth: AuthGateway = {
    getSession: () => {
      if (!authenticatedUserId) {
        return Promise.resolve(null);
      }

      return Promise.resolve({
        session: { id: `session-${authenticatedUserId}` },
        user: membership(authenticatedUserId).user,
      });
    },
    handler: () => Promise.resolve(new Response("auth")),
  };
  const repository = createOrganizationRepositoryStub({
    listMemberships: (tenant) => {
      memberListReads++;
      return Promise.resolve({ items: [tenant.membership], nextCursor: null });
    },
    resolveTenant: (actorUserId, organizationId) =>
      Promise.resolve(tenants.get(`${actorUserId}:${organizationId}`) ?? null),
  });
  const app = createApp({
    apiKeyService: createApiKeyServiceStub({
      list: () => {
        apiKeyListReads++;
        return Promise.resolve({
          page: { items: [], nextCursor: null },
          status: "ok",
        });
      },
    }),
    auth,
    checkDatabaseHealth: () => Promise.resolve(),
    eventService: createEventServiceStub(),
    observability: createObservability({
      environment: "test",
      level: "error",
      service: "meterpilot-server",
      write: () => undefined,
    }),
    organizationRepository: repository,
  });

  return {
    apiKeyListReads: () => apiKeyListReads,
    app,
    memberListReads: () => memberListReads,
  };
}

describe("tenant isolation", () => {
  test("rejects organization routes without a dashboard session", async () => {
    const { app } = createIsolationApp(null);
    const response = await app.request(`/v1/organizations/${ORGANIZATION_A_ID}`);

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  test("allows a member to read their own organization", async () => {
    const { app } = createIsolationApp(USER_A_ID);
    const response = await app.request(`/v1/organizations/${ORGANIZATION_A_ID}`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { organization: { id: string } };
    expect(body.organization.id).toBe(ORGANIZATION_A_ID);
  });

  test("does not reveal another organization's fixture to a valid user", async () => {
    const { app, memberListReads } = createIsolationApp(USER_A_ID);
    const response = await app.request(`/v1/organizations/${ORGANIZATION_B_ID}/members`, {
      headers: { "X-Request-Id": "request_cross_org" },
    });
    const body = await response.text();

    expect(response.status).toBe(403);
    expect(memberListReads()).toBe(0);
    expect(body).not.toContain(ORGANIZATION_B_ID);
    expect(body).not.toContain("organization-b");
    expect(JSON.parse(body)).toEqual({
      error: {
        code: "forbidden",
        message: "You do not have access to this organization.",
        requestId: "request_cross_org",
      },
    });
  });

  test("does not query API keys before cross-tenant authorization succeeds", async () => {
    const { apiKeyListReads, app } = createIsolationApp(USER_A_ID);
    const response = await app.request(`/v1/organizations/${ORGANIZATION_B_ID}/api-keys`, {
      headers: { "X-Request-Id": "request_cross_org_keys" },
    });
    const body = await response.text();

    expect(response.status).toBe(403);
    expect(apiKeyListReads()).toBe(0);
    expect(body).not.toContain(ORGANIZATION_B_ID);
    expect(body).not.toContain("organization-b");
  });

  test("validates the tenant identifier before repository access", async () => {
    const { app, memberListReads } = createIsolationApp(USER_A_ID);
    const response = await app.request("/v1/organizations/not-a-uuid/members");

    expect(response.status).toBe(400);
    expect(memberListReads()).toBe(0);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });
});
