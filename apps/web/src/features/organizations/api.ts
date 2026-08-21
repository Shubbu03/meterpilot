import {
  type CreateOrganizationRequest,
  createOrganizationRequestSchema,
  createOrganizationResponseSchema,
  organizationListResponseSchema,
} from "@meterpilot/contracts/organizations";

import { apiClient } from "../../lib/api/client";

export const organizationKeys = {
  all: ["organizations"] as const,
  list: () => [...organizationKeys.all, "list"] as const,
};

export function listOrganizations() {
  return apiClient.request("/v1/organizations?limit=100", organizationListResponseSchema);
}

export function createOrganization(input: CreateOrganizationRequest) {
  const validatedInput = createOrganizationRequestSchema.parse(input);

  return apiClient.request("/v1/organizations", createOrganizationResponseSchema, {
    json: validatedInput,
    method: "POST",
  });
}
