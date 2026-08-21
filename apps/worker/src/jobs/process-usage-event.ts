import type { MeterPilotMetrics } from "@meterpilot/observability";
import { z } from "zod";

import type { RegisteredJobHandler } from "./dispatcher";
import { permanentJobError } from "./errors";
import type { UsageEventProcessor } from "./usage-event-processor";

export const PROCESS_USAGE_EVENT_JOB_TYPE = "usage_event.process";

const processUsageEventPayloadSchema = z.strictObject({
  eventId: z.uuid(),
  eventKey: z.string().trim().min(1).max(128),
  requestId: z.string().trim().min(1).max(128),
});

export function createProcessUsageEventHandler(
  options: Readonly<{
    metrics: MeterPilotMetrics;
    now?: () => Date;
    processor: UsageEventProcessor;
  }>,
): RegisteredJobHandler {
  const now = options.now ?? (() => new Date());

  return Object.freeze({
    async handle(job, context) {
      const payload = processUsageEventPayloadSchema.safeParse(job.payload);
      if (
        !payload.success ||
        job.resourceType !== "usage_event" ||
        job.resourceId !== payload.data.eventId
      ) {
        throw permanentJobError(
          "invalid_job_payload",
          "Stored usage-event job metadata is invalid.",
        );
      }

      const result = await options.processor.process(
        job.organizationId,
        payload.data.eventId,
        context.signal,
      );
      if (result.status === "not_found") {
        throw permanentJobError(
          "usage_event_not_found",
          "The usage event referenced by this job does not exist.",
        );
      }

      const visibleAt = now().getTime();
      options.metrics.recordAggregationLag(
        Math.max(0, visibleAt - result.receivedAt.getTime()),
        Math.max(0, visibleAt - result.occurredAt.getTime()),
      );
      if ((result.previewRevisionCount ?? 0) > 0) {
        options.metrics.recordLateUsage("late_event", result.previewRevisionCount);
      }
      if ((result.adjustmentPreviewRevisionCount ?? 0) > 0) {
        options.metrics.recordLateUsage("adjustment", result.adjustmentPreviewRevisionCount);
      }
    },
    type: PROCESS_USAGE_EVENT_JOB_TYPE,
  });
}
