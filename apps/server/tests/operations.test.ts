import { describe, expect, test } from "bun:test";
import type {
  BillingExport,
  ReconciliationRun,
  StripeInvoiceLineExportFile,
} from "@meterpilot/contracts/operations";
import { createObservability } from "@meterpilot/observability";

import type { AuthGateway } from "../src/features/identity/authentication";
import type { OperationsRepository } from "../src/features/operations/repository";
import { createApp } from "../src/http/app";
import {
  createApiKeyServiceStub,
  createCatalogRepositoryStub,
  createCustomerRepositoryStub,
  createEntitlementRepositoryStub,
  createEventServiceStub,
  createMeterRepositoryStub,
  createOperationsRepositoryStub,
  createOrganizationRepositoryStub,
  createUsageRepositoryStub,
} from "./helpers";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EXPORT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PREVIEW_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const REVISION_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const JOB_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const CREATED_AT = "2026-09-02T00:00:00.000Z";
const HASH = "a".repeat(64);

const run: ReconciliationRun = {
  afterHash: null,
  beforeHash: null,
  completedAt: null,
  createdAt: CREATED_AT,
  customerKey: "acme",
  failureCode: null,
  id: RUN_ID,
  inputWatermark: CREATED_AT,
  kind: "reconciliation",
  meterKey: "api_requests",
  periodEnd: CREATED_AT,
  periodStart: "2026-09-01T00:00:00.000Z",
  repairRequested: false,
  status: "pending",
  summary: null,
};

const billingExport: BillingExport = {
  completedAt: CREATED_AT,
  contentHash: HASH,
  createdAt: CREATED_AT,
  failureCode: null,
  id: EXPORT_ID,
  sourcePreviewHash: HASH,
  sourcePreviewId: PREVIEW_ID,
  sourcePreviewRevision: 2,
  sourcePreviewRevisionId: REVISION_ID,
  status: "completed",
  stripeCustomerId: "cus_12345",
};

const exportFile: StripeInvoiceLineExportFile = {
  items: [
    {
      amount: 1250,
      currency: "usd",
      customer: "cus_12345",
      description: "API requests",
      metadata: { meterpilot_preview_hash: HASH },
    },
  ],
  object: "meterpilot.stripe_invoice_item_batch",
  source: {
    previewHash: HASH,
    previewId: PREVIEW_ID,
    previewRevision: 2,
    previewRevisionId: REVISION_ID,
  },
  version: "2026-08-20",
};

function createOperationsTestApp(repository: OperationsRepository) {
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
    operationsRepository: repository,
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
    usageRepository: createUsageRepositoryStub(),
  });
}

describe("operations routes", () => {
  test("accepts a durable reconciliation request", async () => {
    let input: unknown;
    const app = createOperationsTestApp(
      createOperationsRepositoryStub({
        createReconciliation(_tenant, value) {
          input = value;
          return Promise.resolve({ jobId: JOB_ID, run, status: "ok" });
        },
      }),
    );
    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/reconciliation-runs`, {
      body: JSON.stringify({
        customerKey: "acme",
        meterKey: "api_requests",
        periodEnd: CREATED_AT,
        periodStart: "2026-09-01T00:00:00.000Z",
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
        "X-Request-Id": "reconcile-request",
      },
      method: "POST",
    });

    expect(response.status).toBe(202);
    expect(input).toEqual({
      customerKey: "acme",
      meterKey: "api_requests",
      periodEnd: CREATED_AT,
      periodStart: "2026-09-01T00:00:00.000Z",
      repair: false,
    });
    expect(await response.json()).toEqual({
      jobId: JOB_ID,
      requestId: "reconcile-request",
      run,
    });
  });

  test("returns tenant-scoped findings and private audit entries", async () => {
    const app = createOperationsTestApp(
      createOperationsRepositoryStub({
        listAudit: () => Promise.resolve({ items: [], nextCursor: null }),
        listFindings: () => Promise.resolve({ items: [], nextCursor: null }),
      }),
    );
    const findings = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/reconciliation-runs/${RUN_ID}/findings?limit=10`,
    );
    const audit = await app.request(`/v1/organizations/${ORGANIZATION_ID}/audit-log?limit=10`);

    expect(findings.status).toBe(200);
    expect(findings.headers.get("Cache-Control")).toBe("no-store");
    expect(audit.status).toBe(200);
    expect(audit.headers.get("Cache-Control")).toBe("no-store");
  });

  test("lists reconciliation runs and billing exports with typed filters", async () => {
    let reconciliationQuery: unknown;
    let exportQuery: unknown;
    const app = createOperationsTestApp(
      createOperationsRepositoryStub({
        listExports(_tenant, query) {
          exportQuery = query;
          return Promise.resolve({ items: [billingExport], nextCursor: null });
        },
        listReconciliations(_tenant, query) {
          reconciliationQuery = query;
          return Promise.resolve({ items: [run], nextCursor: "next" });
        },
      }),
    );
    const reconciliations = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/reconciliation-runs?limit=10&kind=reconciliation&repairRequested=false&status=pending`,
    );
    const exports = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/exports?limit=20&sourcePreviewId=${PREVIEW_ID}&status=completed`,
    );

    expect(reconciliations.status).toBe(200);
    expect(reconciliations.headers.get("Cache-Control")).toBe("no-store");
    expect(reconciliationQuery).toEqual({
      kind: "reconciliation",
      limit: 10,
      repairRequested: false,
      status: "pending",
    });
    expect(await reconciliations.json()).toEqual({ items: [run], nextCursor: "next" });
    expect(exports.status).toBe(200);
    expect(exports.headers.get("Cache-Control")).toBe("no-store");
    expect(exportQuery).toEqual({
      limit: 20,
      sourcePreviewId: PREVIEW_ID,
      status: "completed",
    });
    expect(await exports.json()).toEqual({ items: [billingExport], nextCursor: null });
  });

  test("downloads a completed immutable Stripe export", async () => {
    const app = createOperationsTestApp(
      createOperationsRepositoryStub({
        exportPayload: () => Promise.resolve(exportFile),
        findExport: () => Promise.resolve(billingExport),
      }),
    );
    const status = await app.request(`/v1/organizations/${ORGANIZATION_ID}/exports/${EXPORT_ID}`);
    const download = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/exports/${EXPORT_ID}/download`,
    );

    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ export: billingExport });
    expect(download.status).toBe(200);
    expect(download.headers.get("Cache-Control")).toBe("no-store");
    expect(download.headers.get("Content-Disposition")).toContain(EXPORT_ID);
    expect(await download.json()).toEqual(exportFile);
  });

  test("blocks cross-origin operation mutations before persistence", async () => {
    let calls = 0;
    const app = createOperationsTestApp(
      createOperationsRepositoryStub({
        createReplay: () => {
          calls++;
          return Promise.resolve({ jobId: JOB_ID, run, status: "ok" });
        },
      }),
    );
    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/replays`, {
      body: JSON.stringify({
        customerKey: "acme",
        meterKey: "api_requests",
        periodEnd: CREATED_AT,
        periodStart: "2026-09-01T00:00:00.000Z",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(calls).toBe(0);
  });
});
