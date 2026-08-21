import { describe, expect, test } from "bun:test";
import type { InvoicePreview, InvoicePreviewSummary } from "@meterpilot/contracts/previews";
import { createObservability } from "@meterpilot/observability";

import type { AuthGateway } from "../src/features/identity/authentication";
import type { PreviewRepository } from "../src/features/previews/repository";
import { createApp } from "../src/http/app";
import {
  createApiKeyServiceStub,
  createCatalogRepositoryStub,
  createCustomerRepositoryStub,
  createEntitlementRepositoryStub,
  createEventServiceStub,
  createMeterRepositoryStub,
  createOrganizationRepositoryStub,
  createPreviewRepositoryStub,
  createUsageRepositoryStub,
} from "./helpers";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PREVIEW_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CREATED_AT = "2026-09-01T00:00:00.000Z";

const preview: InvoicePreview = {
  adjustmentOfPreviewId: null,
  calculationHash: null,
  completedAt: null,
  createdAt: CREATED_AT,
  currency: "USD",
  failureCode: null,
  id: PREVIEW_ID,
  inputSnapshot: {},
  lines: [],
  periodEnd: "2026-10-01T00:00:00.000Z",
  periodStart: CREATED_AT,
  planVersionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  revision: 1,
  seriesId: PREVIEW_ID,
  status: "pending",
  subscriptionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  subtotalMinor: null,
};

const previewSummary: InvoicePreviewSummary = {
  adjustmentOfPreviewId: preview.adjustmentOfPreviewId,
  calculationHash: preview.calculationHash,
  completedAt: preview.completedAt,
  createdAt: preview.createdAt,
  currency: preview.currency,
  customerKey: "customer_acme",
  failureCode: preview.failureCode,
  id: preview.id,
  periodEnd: preview.periodEnd,
  periodStart: preview.periodStart,
  planVersionId: preview.planVersionId,
  revision: preview.revision,
  seriesId: preview.seriesId,
  status: preview.status,
  subscriptionId: preview.subscriptionId,
  subtotalMinor: preview.subtotalMinor,
};

function createPreviewTestApp(repository: PreviewRepository) {
  const membership = {
    createdAt: CREATED_AT,
    role: "owner" as const,
    user: { email: "owner@example.com", id: USER_ID, name: "Owner" },
  };
  const auth: AuthGateway = {
    getSession: () => Promise.resolve({ session: { id: "session" }, user: membership.user }),
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
    previewRepository: repository,
    usageRepository: createUsageRepositoryStub(),
  });
}

describe("invoice preview routes", () => {
  test("lists latest preview series and their revision history", async () => {
    let listQuery: unknown;
    let revisionPage: unknown;
    const app = createPreviewTestApp(
      createPreviewRepositoryStub({
        list(_tenant, query) {
          listQuery = query;
          return Promise.resolve({ items: [previewSummary], nextCursor: "next-preview" });
        },
        listRevisions(_tenant, _previewId, page) {
          revisionPage = page;
          return Promise.resolve({ items: [previewSummary], nextCursor: null });
        },
      }),
    );

    const list = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/invoice-previews?limit=1&status=pending`,
    );
    const revisions = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/invoice-previews/${PREVIEW_ID}/revisions?limit=10`,
    );

    expect(list.status).toBe(200);
    expect(list.headers.get("Cache-Control")).toBe("no-store");
    expect(listQuery).toEqual({ limit: 1, status: "pending" });
    expect(await list.json()).toEqual({ items: [previewSummary], nextCursor: "next-preview" });
    expect(revisions.status).toBe(200);
    expect(revisions.headers.get("Cache-Control")).toBe("no-store");
    expect(revisionPage).toEqual({ limit: 10 });
    expect(await revisions.json()).toEqual({ items: [previewSummary], nextCursor: null });
  });

  test("reads one immutable historical revision", async () => {
    let received: unknown;
    const historical = { ...preview, revision: 2 };
    const app = createPreviewTestApp(
      createPreviewRepositoryStub({
        findRevision(_tenant, previewId, revision) {
          received = { previewId, revision };
          return Promise.resolve(historical);
        },
      }),
    );

    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/invoice-previews/${PREVIEW_ID}/revisions/2`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(received).toEqual({ previewId: PREVIEW_ID, revision: 2 });
    expect(await response.json()).toEqual({ preview: historical });
  });

  test("accepts durable asynchronous preview work", async () => {
    let receivedInput: unknown;
    const jobId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const app = createPreviewTestApp(
      createPreviewRepositoryStub({
        create(_tenant, input) {
          receivedInput = input;
          return Promise.resolve({ jobId, preview, status: "ok" });
        },
      }),
    );
    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/invoice-previews`, {
      body: JSON.stringify({
        periodEnd: preview.periodEnd,
        periodStart: preview.periodStart,
        subscriptionId: preview.subscriptionId,
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
        "X-Request-Id": "preview-request",
      },
      method: "POST",
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(receivedInput).toEqual({
      periodEnd: preview.periodEnd,
      periodStart: preview.periodStart,
      subscriptionId: preview.subscriptionId,
    });
    expect(await response.json()).toEqual({ jobId, preview, requestId: "preview-request" });
  });

  test("reads the latest revision through tenant authorization", async () => {
    let receivedTenant: string | undefined;
    const app = createPreviewTestApp(
      createPreviewRepositoryStub({
        find(tenant) {
          receivedTenant = tenant.organization.id;
          return Promise.resolve({ ...preview, revision: 2 });
        },
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/invoice-previews/${PREVIEW_ID}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(receivedTenant).toBe(ORGANIZATION_ID);
    expect(await response.json()).toEqual({ preview: { ...preview, revision: 2 } });
  });

  test("rejects invalid periods before persistence", async () => {
    let calls = 0;
    const app = createPreviewTestApp(
      createPreviewRepositoryStub({
        create: () => {
          calls++;
          return Promise.resolve({ status: "forbidden" });
        },
      }),
    );
    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/invoice-previews`, {
      body: JSON.stringify({
        periodEnd: preview.periodStart,
        periodStart: preview.periodEnd,
        subscriptionId: preview.subscriptionId,
      }),
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(calls).toBe(0);
  });
});
