import { invoicePreviewListResponseSchema } from "@meterpilot/contracts/previews";

import { apiClient } from "../../lib/api/client";

export const overviewKeys = {
  preview: (organizationId: string) =>
    ["organizations", organizationId, "overview", "preview"] as const,
};

export function getLatestPreview(organizationId: string) {
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/invoice-previews?limit=1`,
    invoicePreviewListResponseSchema,
  );
}
