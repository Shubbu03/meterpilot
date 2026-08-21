import { retentionEnforcementJobPayloadSchema } from "@meterpilot/contracts/retention";
import { RETENTION_ENFORCEMENT_JOB_TYPE } from "@meterpilot/db/schema";
import type { MeterPilotMetrics } from "@meterpilot/observability";

import type { RegisteredJobHandler } from "./dispatcher";
import { permanentJobError } from "./errors";
import type { RetentionEnforcer } from "./retention-enforcer";

export function createEnforceRetentionHandler(
  options: Readonly<{ enforcer: RetentionEnforcer; metrics: MeterPilotMetrics }>,
): RegisteredJobHandler {
  return Object.freeze({
    async handle(job, context) {
      const payload = retentionEnforcementJobPayloadSchema.safeParse(job.payload);
      if (
        !payload.success ||
        job.resourceType !== "retention_policy" ||
        payload.data.organizationId !== job.organizationId
      ) {
        throw permanentJobError(
          "invalid_job_payload",
          "Stored retention-enforcement metadata is invalid.",
        );
      }

      const result = await options.enforcer.enforce(
        job.organizationId,
        payload.data.policyVersion,
        payload.data.requestId,
        job.id,
        context.signal,
      );
      if (result.status === "enforced" && result.redactedCount > 0) {
        options.metrics.recordRetention(result.redactedCount);
      }
    },
    type: RETENTION_ENFORCEMENT_JOB_TYPE,
  });
}
