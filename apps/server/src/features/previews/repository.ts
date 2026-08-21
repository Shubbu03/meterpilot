import type {
  CreateInvoicePreviewRequest,
  InvoicePreview,
  InvoicePreviewListQuery,
  InvoicePreviewSummary,
} from "@meterpilot/contracts/previews";

import type { PageRequest, PageResult, TenantAuthorization } from "../organizations/repository";

export class InvalidPreviewCursorError extends Error {
  override readonly name = "InvalidPreviewCursorError";

  constructor() {
    super("The pagination cursor is invalid.");
  }
}

export type PreviewMutationResult =
  | Readonly<{ jobId: string; preview: InvoicePreview; status: "ok" }>
  | Readonly<{ status: "conflict" | "forbidden" | "not_found" }>;

export type PreviewRepository = Readonly<{
  create: (
    tenant: TenantAuthorization,
    input: CreateInvoicePreviewRequest,
    requestId: string,
  ) => Promise<PreviewMutationResult>;
  find: (tenant: TenantAuthorization, seriesId: string) => Promise<InvoicePreview | null>;
  findRevision: (
    tenant: TenantAuthorization,
    seriesId: string,
    revision: number,
  ) => Promise<InvoicePreview | null>;
  list: (
    tenant: TenantAuthorization,
    query: InvoicePreviewListQuery,
  ) => Promise<PageResult<InvoicePreviewSummary>>;
  listRevisions: (
    tenant: TenantAuthorization,
    seriesId: string,
    page: PageRequest,
  ) => Promise<PageResult<InvoicePreviewSummary> | null>;
}>;
