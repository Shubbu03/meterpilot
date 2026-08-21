import { describe, expect, test } from "bun:test";
import type { FailedJob } from "@meterpilot/contracts/jobs";
import { createObservability } from "@meterpilot/observability";

import type { AuthGateway } from "../src/features/identity/authentication";
import type { JobOperationsRepository } from "../src/features/job-operations/repository";
import { InvalidFailedJobCursorError } from "../src/features/job-operations/repository";
import { createApp } from "../src/http/app";
import {
  createApiKeyServiceStub,
  createCatalogRepositoryStub,
  createCustomerRepositoryStub,
  createEntitlementRepositoryStub,
  createEventServiceStub,
  createJobOperationsRepositoryStub,
  createMeterRepositoryStub,
  createOrganizationRepositoryStub,
  createUsageRepositoryStub,
} from "./helpers";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RESOURCE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FAILED_AT = "2026-08-20T10:05:00.000Z";

const failedJob: FailedJob = {
  attemptCount: 8,
  createdAt: "2026-08-20T10:00:00.000Z",
  failedAt: FAILED_AT,
  failure: {
    code: "database_unavailable",
    message: "Database temporarily unavailable.",
  },
  id: JOB_ID,
  manualRetryCount: 0,
  payloadMetadata: { previewId: RESOURCE_ID, requestId: "preview-request" },
  resourceId: RESOURCE_ID,
  resourceType: "invoice_preview",
  retryable: true,
  type: "invoice_preview.generate",
};

function createJobOperationsTestApp(repository: JobOperationsRepository) {
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
    jobOperationsRepository: repository,
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
          membership: {
            createdAt: failedJob.createdAt,
            role: "owner",
            user,
          },
          organization: {
            createdAt: failedJob.createdAt,
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

describe("failed job operation routes", () => {
  test("lists newest failed jobs through tenant authorization with private caching", async () => {
    let receivedQuery: unknown;
    const app = createJobOperationsTestApp(
      createJobOperationsRepositoryStub({
        listFailedJobs(_tenant, query) {
          receivedQuery = query;
          return Promise.resolve({
            page: { items: [failedJob], nextCursor: "next-page" },
            status: "ok",
          });
        },
      }),
    );

    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/failed-jobs?limit=1&type=invoice_preview.generate`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(receivedQuery).toEqual({ limit: 1, type: "invoice_preview.generate" });
    expect(await response.json()).toEqual({ items: [failedJob], nextCursor: "next-page" });
  });

  test("reads one failed job without exposing a cacheable response", async () => {
    const app = createJobOperationsTestApp(
      createJobOperationsRepositoryStub({
        findFailedJob: () => Promise.resolve({ job: failedJob, status: "ok" }),
      }),
    );

    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/failed-jobs/${JOB_ID}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ job: failedJob });
  });

  test("queues a retry only after acknowledging the current failure generation", async () => {
    let received: unknown;
    const retriedAt = new Date("2026-08-20T10:10:00.000Z");
    const app = createJobOperationsTestApp(
      createJobOperationsRepositoryStub({
        retryFailedJob(_tenant, jobId, input, requestId) {
          received = { input, jobId, requestId };
          return Promise.resolve({
            jobId,
            manualRetryCount: 1,
            nextAttemptAt: retriedAt,
            status: "ok",
          });
        },
      }),
    );

    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/failed-jobs/${JOB_ID}/retry`,
      {
        body: JSON.stringify({
          acknowledgedAttemptCount: 8,
          acknowledgedFailureCode: "database_unavailable",
          acknowledgedManualRetryCount: 0,
        }),
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
          "X-Request-Id": "manual-retry-request",
        },
        method: "POST",
      },
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(received).toEqual({
      input: {
        acknowledgedAttemptCount: 8,
        acknowledgedFailureCode: "database_unavailable",
        acknowledgedManualRetryCount: 0,
      },
      jobId: JOB_ID,
      requestId: "manual-retry-request",
    });
    expect(await response.json()).toEqual({
      jobId: JOB_ID,
      manualRetryCount: 1,
      nextAttemptAt: retriedAt.toISOString(),
      requestId: "manual-retry-request",
      status: "pending",
    });
  });

  test("rejects stale, exhausted, and permanently failed retries with stable conflicts", async () => {
    for (const status of ["conflict", "retry_limit", "not_retryable"] as const) {
      const app = createJobOperationsTestApp(
        createJobOperationsRepositoryStub({
          retryFailedJob: () => Promise.resolve({ status }),
        }),
      );
      const response = await app.request(
        `/v1/organizations/${ORGANIZATION_ID}/failed-jobs/${JOB_ID}/retry`,
        {
          body: JSON.stringify({
            acknowledgedAttemptCount: 8,
            acknowledgedFailureCode: "database_unavailable",
            acknowledgedManualRetryCount: 0,
          }),
          headers: { "Content-Type": "application/json", Origin: "http://localhost" },
          method: "POST",
        },
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "conflict" } });
    }
  });

  test("rejects cross-origin retries before persistence", async () => {
    let calls = 0;
    const app = createJobOperationsTestApp(
      createJobOperationsRepositoryStub({
        retryFailedJob: () => {
          calls++;
          return Promise.resolve({ status: "conflict" });
        },
      }),
    );

    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/failed-jobs/${JOB_ID}/retry`,
      {
        body: JSON.stringify({
          acknowledgedAttemptCount: 8,
          acknowledgedFailureCode: "database_unavailable",
          acknowledgedManualRetryCount: 0,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );

    expect(response.status).toBe(403);
    expect(calls).toBe(0);
  });

  test("maps an invalid opaque cursor to a bounded validation error", async () => {
    const app = createJobOperationsTestApp(
      createJobOperationsRepositoryStub({
        listFailedJobs: () => Promise.reject(new InvalidFailedJobCursorError()),
      }),
    );

    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/failed-jobs?cursor=invalid`,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "validation_error" } });
  });
});
