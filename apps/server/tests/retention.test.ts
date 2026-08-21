import { describe, expect, test } from "bun:test";
import { createObservability } from "@meterpilot/observability";

import type { AuthGateway } from "../src/features/identity/authentication";
import type { RetentionRepository } from "../src/features/retention/repository";
import { createApp } from "../src/http/app";
import {
  createApiKeyServiceStub,
  createCatalogRepositoryStub,
  createCustomerRepositoryStub,
  createEntitlementRepositoryStub,
  createEventServiceStub,
  createMeterRepositoryStub,
  createOrganizationRepositoryStub,
  createRetentionRepositoryStub,
  createUsageRepositoryStub,
} from "./helpers";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UPDATED_AT = "2026-08-20T10:00:00.000Z";

function createRetentionTestApp(repository: RetentionRepository) {
  const user = { email: "owner@example.com", id: USER_ID, name: "Owner" };
  const auth: AuthGateway = {
    getSession: () => Promise.resolve({ session: { id: "session" }, user }),
    handler: () => Promise.resolve(new Response("auth")),
  };
  return createApp({
    apiKeyService: createApiKeyServiceStub(),
    auth,
    catalogRepository: createCatalogRepositoryStub(),
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
          membership: { createdAt: UPDATED_AT, role: "owner", user },
          organization: {
            createdAt: UPDATED_AT,
            defaultTimezone: "UTC",
            id: ORGANIZATION_ID,
            name: "Acme",
            slug: "acme",
          },
        }),
    }),
    retentionRepository: repository,
    usageRepository: createUsageRepositoryStub(),
  });
}

describe("retention policy routes", () => {
  test("reads the disabled default without fabricating an update", async () => {
    const app = createRetentionTestApp(createRetentionRepositoryStub());

    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/retention-policy`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      policy: {
        eventPropertiesRetentionDays: null,
        organizationId: ORGANIZATION_ID,
        updatedAt: null,
        updatedBy: null,
        version: 0,
      },
    });
  });

  test("queues an audited durable enforcement after an authorized update", async () => {
    let input: unknown;
    let requestId: string | undefined;
    const app = createRetentionTestApp(
      createRetentionRepositoryStub({
        updatePolicy(_tenant, value, receivedRequestId) {
          input = value;
          requestId = receivedRequestId;
          return Promise.resolve({
            jobId: JOB_ID,
            policy: {
              eventPropertiesRetentionDays: 90,
              organizationId: ORGANIZATION_ID,
              updatedAt: UPDATED_AT,
              updatedBy: USER_ID,
              version: 1,
            },
            status: "ok",
          });
        },
      }),
    );

    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/retention-policy`, {
      body: JSON.stringify({ eventPropertiesRetentionDays: 90 }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
        "X-Request-Id": "retention-update",
      },
      method: "PUT",
    });

    expect(response.status).toBe(202);
    expect(input).toEqual({ eventPropertiesRetentionDays: 90 });
    expect(requestId).toBe("retention-update");
    expect(await response.json()).toEqual({
      jobId: JOB_ID,
      policy: {
        eventPropertiesRetentionDays: 90,
        organizationId: ORGANIZATION_ID,
        updatedAt: UPDATED_AT,
        updatedBy: USER_ID,
        version: 1,
      },
      requestId: "retention-update",
    });
  });

  test("rejects cross-origin and unauthorized policy changes", async () => {
    let calls = 0;
    const app = createRetentionTestApp(
      createRetentionRepositoryStub({
        updatePolicy: () => {
          calls++;
          return Promise.resolve({ status: "forbidden" });
        },
      }),
    );
    const crossOrigin = await app.request(`/v1/organizations/${ORGANIZATION_ID}/retention-policy`, {
      body: JSON.stringify({ eventPropertiesRetentionDays: null }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });
    expect(crossOrigin.status).toBe(403);
    expect(calls).toBe(0);

    const forbidden = await app.request(`/v1/organizations/${ORGANIZATION_ID}/retention-policy`, {
      body: JSON.stringify({ eventPropertiesRetentionDays: null }),
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      method: "PUT",
    });
    expect(forbidden.status).toBe(403);
    expect(calls).toBe(1);
  });
});
