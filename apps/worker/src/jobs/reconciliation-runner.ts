export type ReconciliationRunResult =
  | Readonly<{ status: "not_found" | "terminal" }>
  | Readonly<{ driftCount: number; status: "completed"; totalMagnitude: string }>;

export type ReconciliationRunner = Readonly<{
  fail: (
    organizationId: string,
    runId: string,
    failureCode: string,
    requestId: string,
  ) => Promise<void>;
  run: (
    organizationId: string,
    runId: string,
    requestId: string,
    signal: AbortSignal,
  ) => Promise<ReconciliationRunResult>;
}>;
