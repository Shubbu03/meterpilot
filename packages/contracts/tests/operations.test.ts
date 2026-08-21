import { describe, expect, test } from "bun:test";

import {
  billingExportSchema,
  billingExportListQuerySchema,
  createReconciliationRunRequestSchema,
  createReplayRequestSchema,
  reconciliationRunSchema,
  reconciliationRunListQuerySchema,
  stripeInvoiceLineExportFileSchema,
} from "../src/operations";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const PREVIEW_ID = "22222222-2222-4222-8222-222222222222";
const REVISION_ID = "33333333-3333-4333-8333-333333333333";
const HASH = "a".repeat(64);

describe("operations contracts", () => {
  test("normalizes a bounded UTC-hour reconciliation request", () => {
    expect(
      createReconciliationRunRequestSchema.parse({
        customerKey: "acme",
        meterKey: "api_requests",
        periodEnd: "2026-09-02T00:00:00.000Z",
        periodStart: "2026-09-01T00:00:00.000Z",
      }),
    ).toEqual({
      customerKey: "acme",
      meterKey: "api_requests",
      periodEnd: "2026-09-02T00:00:00.000Z",
      periodStart: "2026-09-01T00:00:00.000Z",
      repair: false,
    });
  });

  test("rejects partial hours and invalid replay intervals", () => {
    expect(
      createReconciliationRunRequestSchema.safeParse({
        customerKey: "acme",
        meterKey: "api_requests",
        periodEnd: "2026-09-02T00:00:00.000Z",
        periodStart: "2026-09-01T00:30:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      createReplayRequestSchema.safeParse({
        customerKey: "acme",
        meterKey: "api_requests",
        periodEnd: "2026-09-01T00:00:00.000Z",
        periodStart: "2026-09-02T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  test("keeps operation lifecycle states mutually exclusive", () => {
    const common = {
      completedAt: null,
      createdAt: "2026-09-02T00:00:00.000Z",
      customerKey: "acme",
      id: RUN_ID,
      inputWatermark: "2026-09-02T00:00:00.000Z",
      kind: "reconciliation",
      meterKey: "api_requests",
      periodEnd: "2026-09-02T00:00:00.000Z",
      periodStart: "2026-09-01T00:00:00.000Z",
      repairRequested: false,
    } as const;

    expect(
      reconciliationRunSchema.parse({
        ...common,
        afterHash: null,
        beforeHash: null,
        failureCode: null,
        status: "pending",
        summary: null,
      }).status,
    ).toBe("pending");
    expect(
      reconciliationRunSchema.safeParse({
        ...common,
        afterHash: HASH,
        beforeHash: HASH,
        failureCode: null,
        status: "completed",
        summary: null,
      }).success,
    ).toBe(false);
  });

  test("models an immutable Stripe invoice-item batch and its source revision", () => {
    const file = stripeInvoiceLineExportFileSchema.parse({
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
    });
    expect(file.source.previewRevisionId).toBe(REVISION_ID);

    expect(
      billingExportSchema.parse({
        completedAt: null,
        contentHash: null,
        createdAt: "2026-09-02T00:00:00.000Z",
        failureCode: null,
        id: RUN_ID,
        sourcePreviewHash: HASH,
        sourcePreviewId: PREVIEW_ID,
        sourcePreviewRevision: 2,
        sourcePreviewRevisionId: REVISION_ID,
        status: "pending",
        stripeCustomerId: "cus_12345",
      }).status,
    ).toBe("pending");
  });

  test("normalizes operation collection filters", () => {
    expect(
      reconciliationRunListQuerySchema.parse({
        kind: "replay",
        limit: "10",
        repairRequested: "true",
      }),
    ).toEqual({ kind: "replay", limit: 10, repairRequested: true });
    expect(
      billingExportListQuerySchema.parse({
        sourcePreviewId: PREVIEW_ID,
        status: "completed",
      }),
    ).toEqual({ limit: 50, sourcePreviewId: PREVIEW_ID, status: "completed" });
  });
});
