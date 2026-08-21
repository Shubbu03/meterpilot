import { describe, expect, test } from "bun:test";
import { INVOICE_PREVIEW_GENERATE_JOB_TYPE } from "@meterpilot/db/schema";

import { createGenerateInvoicePreviewHandler } from "../src/jobs/generate-invoice-preview";
import { permanentJobError } from "../src/jobs/errors";

const PREVIEW_ID = "11111111-1111-4111-8111-111111111111";

function job() {
  return {
    attemptCount: 1,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    id: "22222222-2222-4222-8222-222222222222",
    leaseExpiresAt: new Date("2026-09-01T00:01:00.000Z"),
    organizationId: "33333333-3333-4333-8333-333333333333",
    payload: { previewId: PREVIEW_ID, requestId: "preview-request" },
    resourceId: PREVIEW_ID,
    resourceType: "invoice_preview",
    type: INVOICE_PREVIEW_GENERATE_JOB_TYPE,
  };
}

describe("generate invoice preview handler", () => {
  test("dispatches trusted preview metadata", async () => {
    let received: readonly unknown[] = [];
    const handler = createGenerateInvoicePreviewHandler({
      generator: {
        fail: () => Promise.resolve(),
        generate(...input) {
          received = input;
          return Promise.resolve({ status: "completed" });
        },
      },
    });

    await handler.handle(job(), { signal: new AbortController().signal });

    expect(received.slice(0, 3)).toEqual([
      "33333333-3333-4333-8333-333333333333",
      PREVIEW_ID,
      "preview-request",
    ]);
  });

  test("rejects tampered resource identity", async () => {
    const handler = createGenerateInvoicePreviewHandler({
      generator: {
        fail: () => Promise.resolve(),
        generate: () => Promise.resolve({ status: "terminal" }),
      },
    });

    await expect(
      handler.handle(
        { ...job(), resourceId: crypto.randomUUID() },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: "invalid_job_payload", retryable: false });
  });

  test("records a stable failure code when generation fails permanently", async () => {
    let failedWith: string | undefined;
    const handler = createGenerateInvoicePreviewHandler({
      generator: {
        fail(_organizationId, _previewId, failureCode) {
          failedWith = failureCode;
          return Promise.resolve();
        },
        generate: () => {
          throw permanentJobError("invalid_plan_version", "The plan version is invalid.");
        },
      },
    });

    await expect(
      handler.handle(job(), { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "invalid_plan_version", retryable: false });
    expect(failedWith).toBe("invalid_plan_version");
  });
});
