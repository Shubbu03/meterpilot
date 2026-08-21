import { STRIPE_INVOICE_LINE_EXPORT_JOB_TYPE } from "@meterpilot/db/schema";
import type { MeterPilotMetrics } from "@meterpilot/observability";
import { z } from "zod";

import type { BillingExportGenerator } from "./billing-export-generator";
import type { RegisteredJobHandler } from "./dispatcher";
import { JobHandlerError, permanentJobError } from "./errors";

const payloadSchema = z.strictObject({
  exportId: z.uuid(),
  requestId: z.string().trim().min(1).max(128),
});

export function createGenerateBillingExportHandler(
  options: Readonly<{ generator: BillingExportGenerator; metrics: MeterPilotMetrics }>,
): RegisteredJobHandler {
  return Object.freeze({
    async handle(job, context) {
      const payload = payloadSchema.safeParse(job.payload);
      if (
        !payload.success ||
        job.resourceType !== "billing_export" ||
        job.resourceId !== payload.data.exportId
      ) {
        throw permanentJobError(
          "invalid_job_payload",
          "Stored billing export metadata is invalid.",
        );
      }

      try {
        const result = await options.generator.generate(
          job.organizationId,
          payload.data.exportId,
          payload.data.requestId,
          context.signal,
        );
        if (result.status === "not_found") {
          throw permanentJobError(
            "billing_export_not_found",
            "The billing export referenced by this job does not exist.",
          );
        }
      } catch (error) {
        if (error instanceof JobHandlerError && !error.retryable) {
          options.metrics.recordFailure("export");
          await options.generator.fail(
            job.organizationId,
            payload.data.exportId,
            error.code,
            payload.data.requestId,
          );
        }
        throw error;
      }
    },
    type: STRIPE_INVOICE_LINE_EXPORT_JOB_TYPE,
  });
}
