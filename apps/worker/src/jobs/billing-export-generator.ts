export type BillingExportGenerationResult = Readonly<{
  status: "completed" | "not_found" | "terminal";
}>;

export type BillingExportGenerator = Readonly<{
  fail: (
    organizationId: string,
    exportId: string,
    failureCode: string,
    requestId: string,
  ) => Promise<void>;
  generate: (
    organizationId: string,
    exportId: string,
    requestId: string,
    signal: AbortSignal,
  ) => Promise<BillingExportGenerationResult>;
}>;
