export type ProcessUsageEventResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{
      adjustmentPreviewRevisionCount?: number;
      bucketCount: number;
      occurredAt: Date;
      previewRevisionCount?: number;
      receivedAt: Date;
      status: "processed";
    }>;

export type UsageEventProcessor = Readonly<{
  process: (
    organizationId: string,
    eventId: string,
    signal: AbortSignal,
  ) => Promise<ProcessUsageEventResult>;
}>;
