export type RetentionEnforcementResult = Readonly<{
  redactedCount: number;
  status: "enforced" | "stale";
}>;

export type RetentionEnforcer = Readonly<{
  enforce: (
    organizationId: string,
    policyVersion: number,
    requestId: string,
    currentJobId: string,
    signal: AbortSignal,
  ) => Promise<RetentionEnforcementResult>;
}>;
