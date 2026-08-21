import {
  auditLogListResponseSchema,
  billingExportListResponseSchema,
  billingExportMutationResponseSchema,
  type CreateReconciliationRunRequest,
  createReconciliationRunRequestSchema,
  createStripeInvoiceLineExportRequestSchema,
  reconciliationRunListResponseSchema,
  reconciliationRunMutationResponseSchema,
} from "@meterpilot/contracts/operations";
import { apiClient } from "../../lib/api/client";
export const operationKeys = {
  all: (id: string) => ["organizations", id, "operations"] as const,
  audit: (id: string) => ["organizations", id, "operations", "audit"] as const,
  exports: (id: string) => ["organizations", id, "operations", "exports"] as const,
  reconciliation: (id: string) => ["organizations", id, "operations", "reconciliation"] as const,
};
const base = (id: string) => `/v1/organizations/${encodeURIComponent(id)}`;
export function listReconciliations(id: string) {
  return apiClient.request(
    `${base(id)}/reconciliation-runs?limit=100`,
    reconciliationRunListResponseSchema,
  );
}
export function createReconciliation(id: string, input: CreateReconciliationRunRequest) {
  return apiClient.request(
    `${base(id)}/reconciliation-runs`,
    reconciliationRunMutationResponseSchema,
    { json: createReconciliationRunRequestSchema.parse(input), method: "POST" },
  );
}
export function listAudit(id: string) {
  return apiClient.request(`${base(id)}/audit-log?limit=100`, auditLogListResponseSchema);
}
export function listExports(id: string) {
  return apiClient.request(`${base(id)}/exports?limit=100`, billingExportListResponseSchema);
}
export function createExport(id: string, previewId: string, stripeCustomerId: string) {
  return apiClient.request(
    `${base(id)}/exports/stripe/invoice-lines`,
    billingExportMutationResponseSchema,
    {
      json: createStripeInvoiceLineExportRequestSchema.parse({ previewId, stripeCustomerId }),
      method: "POST",
    },
  );
}
