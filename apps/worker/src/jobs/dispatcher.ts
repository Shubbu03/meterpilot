import { permanentJobError } from "./errors";
import type { ClaimedJob } from "./repository";

const JOB_TYPE_PATTERN = /^[a-z][a-z0-9]*([._-][a-z0-9]+)*$/;
const MAX_JOB_TYPE_LENGTH = 128;

export type JobHandlerContext = Readonly<{
  signal: AbortSignal;
}>;

export type JobHandler = (job: ClaimedJob, context: JobHandlerContext) => Promise<void>;

export type RegisteredJobHandler = Readonly<{
  handle: JobHandler;
  type: string;
}>;

export type JobDispatcher = Readonly<{
  dispatch: (job: ClaimedJob, context: JobHandlerContext) => Promise<void>;
}>;

export function createJobDispatcher(handlers: readonly RegisteredJobHandler[]): JobDispatcher {
  const registry = new Map<string, JobHandler>();

  for (const handler of handlers) {
    if (!JOB_TYPE_PATTERN.test(handler.type) || handler.type.length > MAX_JOB_TYPE_LENGTH) {
      throw new TypeError("Registered job type must be a bounded event-style identifier.");
    }
    if (registry.has(handler.type)) {
      throw new TypeError(`Duplicate job handler registration: ${handler.type}`);
    }
    registry.set(handler.type, handler.handle);
  }

  return Object.freeze({
    async dispatch(job, context) {
      const handler = registry.get(job.type);
      if (!handler) {
        throw permanentJobError(
          "unsupported_job_type",
          "No handler is registered for this job type.",
        );
      }
      await handler(job, context);
    },
  });
}
