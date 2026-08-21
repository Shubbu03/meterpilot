import { describe, expect, test } from "bun:test";

import {
  createInvoicePreviewRequestSchema,
  invoicePreviewListQuerySchema,
  invoicePreviewSchema,
} from "../src/previews";

describe("invoice preview contracts", () => {
  test("accepts bounded latest-series filters", () => {
    expect(
      invoicePreviewListQuerySchema.parse({
        customerKey: "customer_acme",
        limit: "25",
        status: "completed",
      }),
    ).toEqual({ customerKey: "customer_acme", limit: 25, status: "completed" });
  });

  test("accepts an explicit half-open subscription period", () => {
    expect(
      createInvoicePreviewRequestSchema.parse({
        periodEnd: "2026-10-01T00:00:00.000Z",
        periodStart: "2026-09-01T00:00:00.000Z",
        subscriptionId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toEqual({
      periodEnd: "2026-10-01T00:00:00.000Z",
      periodStart: "2026-09-01T00:00:00.000Z",
      subscriptionId: "11111111-1111-4111-8111-111111111111",
    });
  });

  test("rejects reversed periods", () => {
    expect(
      createInvoicePreviewRequestSchema.safeParse({
        periodEnd: "2026-09-01T00:00:00.000Z",
        periodStart: "2026-10-01T00:00:00.000Z",
        subscriptionId: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(false);
  });

  test("keeps pending previews free of fabricated totals", () => {
    expect(
      invoicePreviewSchema.parse({
        adjustmentOfPreviewId: null,
        calculationHash: null,
        completedAt: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        currency: "USD",
        failureCode: null,
        id: "22222222-2222-4222-8222-222222222222",
        inputSnapshot: {},
        lines: [],
        periodEnd: "2026-10-01T00:00:00.000Z",
        periodStart: "2026-09-01T00:00:00.000Z",
        planVersionId: "33333333-3333-4333-8333-333333333333",
        revision: 1,
        seriesId: "22222222-2222-4222-8222-222222222222",
        status: "pending",
        subscriptionId: "11111111-1111-4111-8111-111111111111",
        subtotalMinor: null,
      }).status,
    ).toBe("pending");
  });
});
