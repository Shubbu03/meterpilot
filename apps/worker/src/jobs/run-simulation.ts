import { SIMULATION_RUN_JOB_TYPE } from "@meterpilot/db/schema";
import type { MeterPilotMetrics } from "@meterpilot/observability";
import { z } from "zod";

import type { RegisteredJobHandler } from "./dispatcher";
import { JobHandlerError, permanentJobError } from "./errors";
import type { SimulationRunner } from "./simulation-runner";

const payloadSchema = z.strictObject({
  requestId: z.string().trim().min(1).max(128),
  simulationId: z.uuid(),
});

export function createRunSimulationHandler(
  options: Readonly<{
    clock?: () => number;
    metrics: MeterPilotMetrics;
    runner: SimulationRunner;
    timer?: () => number;
  }>,
): RegisteredJobHandler {
  const clock = options.clock ?? Date.now;
  const timer = options.timer ?? (() => performance.now());
  return Object.freeze({
    async handle(job, context) {
      const payload = payloadSchema.safeParse(job.payload);
      if (
        !payload.success ||
        job.resourceType !== "simulation" ||
        job.resourceId !== payload.data.simulationId
      ) {
        throw permanentJobError("invalid_job_payload", "Stored simulation metadata is invalid.");
      }
      const queueMs = Math.max(0, clock() - job.createdAt.getTime());
      const startedAt = timer();
      try {
        const result = await options.runner.run(
          job.organizationId,
          payload.data.simulationId,
          payload.data.requestId,
          context.signal,
        );
        if (result.status === "not_found") {
          throw permanentJobError(
            "simulation_not_found",
            "The simulation referenced by this job does not exist.",
          );
        }
        options.metrics.recordSimulation(queueMs, Math.max(0, timer() - startedAt));
      } catch (error) {
        if (error instanceof JobHandlerError && !error.retryable) {
          await options.runner.fail(
            job.organizationId,
            payload.data.simulationId,
            error.code,
            payload.data.requestId,
          );
        }
        throw error;
      }
    },
    type: SIMULATION_RUN_JOB_TYPE,
  });
}
