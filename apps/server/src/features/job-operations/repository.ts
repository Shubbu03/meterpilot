import type {
  FailedJob,
  FailedJobListQuery,
  RetryFailedJobRequest,
} from "@meterpilot/contracts/jobs";

import type { PageResult, TenantAuthorization } from "../organizations/repository";

export class InvalidFailedJobCursorError extends Error {
  override readonly name = "InvalidFailedJobCursorError";

  constructor() {
    super("The pagination cursor is invalid.");
  }
}

export type FailedJobReadResult =
  | Readonly<{ job: FailedJob; status: "ok" }>
  | Readonly<{ status: "forbidden" | "not_found" }>;

export type FailedJobListResult =
  | Readonly<{ page: PageResult<FailedJob>; status: "ok" }>
  | Readonly<{ status: "forbidden" }>;

export type FailedJobRetryResult =
  | Readonly<{
      jobId: string;
      manualRetryCount: number;
      nextAttemptAt: Date;
      status: "ok";
    }>
  | Readonly<{
      status: "conflict" | "forbidden" | "not_found" | "not_retryable" | "retry_limit";
    }>;

export type JobOperationsRepository = Readonly<{
  findFailedJob: (tenant: TenantAuthorization, jobId: string) => Promise<FailedJobReadResult>;
  listFailedJobs: (
    tenant: TenantAuthorization,
    query: FailedJobListQuery,
  ) => Promise<FailedJobListResult>;
  retryFailedJob: (
    tenant: TenantAuthorization,
    jobId: string,
    input: RetryFailedJobRequest,
    requestId: string,
  ) => Promise<FailedJobRetryResult>;
}>;
