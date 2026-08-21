export type InvoicePreviewGenerationResult = Readonly<{
  status: "completed" | "not_found" | "terminal";
}>;

export type InvoicePreviewGenerator = Readonly<{
  fail: (
    organizationId: string,
    previewId: string,
    failureCode: string,
    requestId: string,
  ) => Promise<void>;
  generate: (
    organizationId: string,
    previewId: string,
    requestId: string,
    signal: AbortSignal,
  ) => Promise<InvoicePreviewGenerationResult>;
}>;
