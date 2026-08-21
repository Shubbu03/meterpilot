import type { MeterPilotMetrics } from "@meterpilot/observability";
import { z } from "zod";

import type { RegisteredJobHandler } from "./dispatcher";
import { permanentJobError } from "./errors";
import type { UsageAggregateRebuilder } from "./usage-aggregate-rebuilder";

export const REBUILD_USAGE_AGGREGATES_JOB_TYPE = "usage_aggregate.rebuild";

const rebuildPayloadSchema = z
  .strictObject({
    effectiveFrom: z.iso.datetime({ offset: true }),
    effectiveTo: z.iso.datetime({ offset: true }).nullable(),
    meterVersionId: z.uuid(),
    requestId: z.string().trim().min(1).max(128),
  })
  .refine(
    (payload) =>
      payload.effectiveTo === null ||
      Date.parse(payload.effectiveTo) > Date.parse(payload.effectiveFrom),
    { message: "effectiveTo must be later than effectiveFrom", path: ["effectiveTo"] },
  );

export function createRebuildUsageAggregatesHandler(
  options: Readonly<{
    metrics: MeterPilotMetrics;
    now?: () => number;
    rebuilder: UsageAggregateRebuilder;
  }>,
): RegisteredJobHandler {
  const now = options.now ?? (() => performance.now());

  return Object.freeze({
    async handle(job, context) {
      const payload = rebuildPayloadSchema.safeParse(job.payload);
      if (
        !payload.success ||
        job.resourceType !== "meter_version" ||
        job.resourceId !== payload.data.meterVersionId
      ) {
        throw permanentJobError(
          "invalid_job_payload",
          "Stored usage-rebuild job metadata is invalid.",
        );
      }

      const startedAt = now();
      const result = await options.rebuilder.rebuild(
        job.organizationId,
        payload.data.meterVersionId,
        context.signal,
      );
      if (result.status === "not_found") {
        throw permanentJobError(
          "meter_version_not_found",
          "The published meter version referenced by this job does not exist.",
        );
      }
      options.metrics.recordBucketRebuild(Math.max(0, now() - startedAt));
    },
    type: REBUILD_USAGE_AGGREGATES_JOB_TYPE,
  });
}
