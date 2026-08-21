import { INVOICE_PREVIEW_GENERATE_JOB_TYPE } from "@meterpilot/db/schema";
import type { MeterPilotMetrics } from "@meterpilot/observability";
import { z } from "zod";

import type { RegisteredJobHandler } from "./dispatcher";
import { JobHandlerError, permanentJobError } from "./errors";
import type { InvoicePreviewGenerator } from "./invoice-preview-generator";

const payloadSchema = z.strictObject({
  previewId: z.uuid(),
  requestId: z.string().trim().min(1).max(128),
});

export function createGenerateInvoicePreviewHandler(
  options: Readonly<{ generator: InvoicePreviewGenerator; metrics?: MeterPilotMetrics }>,
): RegisteredJobHandler {
  return Object.freeze({
    async handle(job, context) {
      const payload = payloadSchema.safeParse(job.payload);
      if (
        !payload.success ||
        job.resourceType !== "invoice_preview" ||
        job.resourceId !== payload.data.previewId
      ) {
        throw permanentJobError(
          "invalid_job_payload",
          "Stored invoice preview metadata is invalid.",
        );
      }
      let result: Awaited<ReturnType<InvoicePreviewGenerator["generate"]>>;
      try {
        result = await options.generator.generate(
          job.organizationId,
          payload.data.previewId,
          payload.data.requestId,
          context.signal,
        );
      } catch (error) {
        if (error instanceof JobHandlerError && !error.retryable) {
          options.metrics?.recordFailure("preview");
          await options.generator.fail(
            job.organizationId,
            payload.data.previewId,
            error.code,
            payload.data.requestId,
          );
        }
        throw error;
      }
      if (result.status === "not_found") {
        throw permanentJobError(
          "invoice_preview_not_found",
          "The invoice preview referenced by this job does not exist.",
        );
      }
    },
    type: INVOICE_PREVIEW_GENERATE_JOB_TYPE,
  });
}
