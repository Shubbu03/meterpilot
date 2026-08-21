export type RebuildUsageAggregatesResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ eventCount: number; status: "rebuilt" }>;

export type UsageAggregateRebuilder = Readonly<{
  rebuild: (
    organizationId: string,
    meterVersionId: string,
    signal: AbortSignal,
  ) => Promise<RebuildUsageAggregatesResult>;
}>;
