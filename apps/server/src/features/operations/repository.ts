import type {
  AuditLogEntry,
  AuditLogQuery,
  BillingExport,
  BillingExportListQuery,
  CreateReconciliationRunRequest,
  CreateReplayRequest,
  CreateStripeInvoiceLineExportRequest,
  ReconciliationFinding,
  ReconciliationRun,
  ReconciliationRunListQuery,
  StripeInvoiceLineExportFile,
} from "@meterpilot/contracts/operations";

import type { PageResult, TenantAuthorization } from "../organizations/repository";

export type OperationMutationError = Readonly<{
  status: "conflict" | "forbidden" | "not_found";
}>;

export type ReconciliationMutationResult =
  | Readonly<{ jobId: string; run: ReconciliationRun; status: "ok" }>
  | OperationMutationError;

export type BillingExportMutationResult =
  | Readonly<{ export: BillingExport; jobId: string; status: "ok" }>
  | OperationMutationError;

export class InvalidOperationsCursorError extends Error {
  constructor() {
    super("The pagination cursor is invalid.");
    this.name = "InvalidOperationsCursorError";
  }
}

export class BillingExportNotReadyError extends Error {
  constructor() {
    super("The export file is available only after generation completes successfully.");
    this.name = "BillingExportNotReadyError";
  }
}

export type OperationsRepository = Readonly<{
  createExport: (
    tenant: TenantAuthorization,
    input: CreateStripeInvoiceLineExportRequest,
    requestId: string,
  ) => Promise<BillingExportMutationResult>;
  createReconciliation: (
    tenant: TenantAuthorization,
    input: CreateReconciliationRunRequest,
    requestId: string,
  ) => Promise<ReconciliationMutationResult>;
  createReplay: (
    tenant: TenantAuthorization,
    input: CreateReplayRequest,
    requestId: string,
  ) => Promise<ReconciliationMutationResult>;
  exportPayload: (
    tenant: TenantAuthorization,
    exportId: string,
  ) => Promise<StripeInvoiceLineExportFile | null>;
  findExport: (tenant: TenantAuthorization, exportId: string) => Promise<BillingExport | null>;
  findReconciliation: (
    tenant: TenantAuthorization,
    runId: string,
  ) => Promise<ReconciliationRun | null>;
  listExports: (
    tenant: TenantAuthorization,
    query: BillingExportListQuery,
  ) => Promise<PageResult<BillingExport>>;
  listReconciliations: (
    tenant: TenantAuthorization,
    query: ReconciliationRunListQuery,
  ) => Promise<PageResult<ReconciliationRun>>;
  listAudit: (
    tenant: TenantAuthorization,
    query: AuditLogQuery,
  ) => Promise<PageResult<AuditLogEntry>>;
  listFindings: (
    tenant: TenantAuthorization,
    runId: string,
    page: Readonly<{ cursor?: string | undefined; limit: number }>,
  ) => Promise<PageResult<ReconciliationFinding> | null>;
}>;
