import {
  type CreateInvoicePreviewRequest,
  createInvoicePreviewRequestSchema,
  invoicePreviewListResponseSchema,
  invoicePreviewMutationResponseSchema,
  invoicePreviewResponseSchema,
} from "@meterpilot/contracts/previews";
import { apiClient } from "../../lib/api/client";

export const previewKeys = {
  all: (organizationId: string) => ["organizations", organizationId, "previews"] as const,
  detail: (organizationId: string, previewId: string) =>
    ["organizations", organizationId, "previews", previewId] as const,
};
const base = (organizationId: string) =>
  `/v1/organizations/${encodeURIComponent(organizationId)}/invoice-previews`;
export function listPreviews(organizationId: string) {
  return apiClient.request(`${base(organizationId)}?limit=100`, invoicePreviewListResponseSchema);
}
export function createPreview(organizationId: string, input: CreateInvoicePreviewRequest) {
  return apiClient.request(base(organizationId), invoicePreviewMutationResponseSchema, {
    json: createInvoicePreviewRequestSchema.parse(input),
    method: "POST",
  });
}
export function getPreview(organizationId: string, previewId: string) {
  return apiClient.request(
    `${base(organizationId)}/${encodeURIComponent(previewId)}`,
    invoicePreviewResponseSchema,
  );
}
