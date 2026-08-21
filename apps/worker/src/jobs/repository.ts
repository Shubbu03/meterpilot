export type ClaimedJob = Readonly<{
  attemptCount: number;
  createdAt: Date;
  id: string;
  leaseExpiresAt: Date;
  organizationId: string;
  payload: Record<string, unknown>;
  resourceId: string;
  resourceType: string;
  type: string;
}>;

export type ClaimJobsOptions = Readonly<{
  leaseDurationMs: number;
  limit: number;
  now: Date;
  workerId: string;
}>;

export type FinishJobOptions = Readonly<{
  jobId: string;
  now: Date;
  workerId: string;
}>;

export type RetryJobOptions = FinishJobOptions &
  Readonly<{
    lastError: string;
    nextAttemptAt: Date;
  }>;

export type FailJobOptions = FinishJobOptions &
  Readonly<{
    lastError: string;
    retryable: boolean;
  }>;

export type JobTransitionResult = "lease_lost" | "updated";

export type JobQueueState = Readonly<{
  depth: number;
  oldestAgeMs: number;
}>;

export type JobRepository = Readonly<{
  claim: (options: ClaimJobsOptions) => Promise<readonly ClaimedJob[]>;
  complete: (options: FinishJobOptions) => Promise<JobTransitionResult>;
  fail: (options: FailJobOptions) => Promise<JobTransitionResult>;
  inspect: (now: Date) => Promise<JobQueueState>;
  retry: (options: RetryJobOptions) => Promise<JobTransitionResult>;
}>;
