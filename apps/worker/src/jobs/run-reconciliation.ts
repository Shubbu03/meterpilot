import { RECONCILIATION_RUN_JOB_TYPE } from "@meterpilot/db/schema";
import type { MeterPilotMetrics } from "@meterpilot/observability";
import { z } from "zod";

import type { RegisteredJobHandler } from "./dispatcher";
import { JobHandlerError, permanentJobError } from "./errors";
import type { ReconciliationRunner } from "./reconciliation-runner";

const payloadSchema = z.strictObject({
  requestId: z.string().trim().min(1).max(128),
  runId: z.uuid(),
});

export function createRunReconciliationHandler(
  options: Readonly<{ metrics: MeterPilotMetrics; runner: ReconciliationRunner }>,
): RegisteredJobHandler {
  return Object.freeze({
    async handle(job, context) {
      const payload = payloadSchema.safeParse(job.payload);
      if (
        !payload.success ||
        job.resourceType !== "reconciliation_run" ||
        job.resourceId !== payload.data.runId
      ) {
        throw permanentJobError(
          "invalid_job_payload",
          "Stored reconciliation metadata is invalid.",
        );
      }

      try {
        const result = await options.runner.run(
          job.organizationId,
          payload.data.runId,
          payload.data.requestId,
          context.signal,
        );
        if (result.status === "not_found") {
          throw permanentJobError(
            "reconciliation_not_found",
            "The reconciliation run referenced by this job does not exist.",
          );
        }
        if (result.status === "completed") {
          options.metrics.recordReconciliationDrift(
            result.driftCount,
            Number(result.totalMagnitude),
          );
        }
      } catch (error) {
        if (error instanceof JobHandlerError && !error.retryable) {
          await options.runner.fail(
            job.organizationId,
            payload.data.runId,
            error.code,
            payload.data.requestId,
          );
        }
        throw error;
      }
    },
    type: RECONCILIATION_RUN_JOB_TYPE,
  });
}
