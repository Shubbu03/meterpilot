import {
  attachCustomerSubjectRequestSchema,
  type CreateCustomerRequest,
  createCustomerRequestSchema,
  customerDetailResponseSchema,
  customerListResponseSchema,
  customerMutationResponseSchema,
  customerSubjectMutationResponseSchema,
} from "@meterpilot/contracts/customers";

import { apiClient } from "../../lib/api/client";

export const customerKeys = {
  all: (organizationId: string) => ["organizations", organizationId, "customers"] as const,
  detail: (organizationId: string, customerKey: string) =>
    [...customerKeys.all(organizationId), "detail", customerKey] as const,
  list: (organizationId: string, cursor?: string) =>
    [...customerKeys.all(organizationId), "list", cursor ?? null] as const,
};

export function listCustomers(organizationId: string, cursor?: string) {
  const search = new URLSearchParams({ limit: "50" });
  if (cursor) search.set("cursor", cursor);
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/customers?${search}`,
    customerListResponseSchema,
  );
}

export function getCustomer(organizationId: string, customerKey: string) {
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/customers/${encodeURIComponent(customerKey)}`,
    customerDetailResponseSchema,
  );
}

export function createCustomer(organizationId: string, input: CreateCustomerRequest) {
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/customers`,
    customerMutationResponseSchema,
    { json: createCustomerRequestSchema.parse(input), method: "POST" },
  );
}

export function attachCustomerSubject(
  organizationId: string,
  customerKey: string,
  externalKey: string,
) {
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/customers/${encodeURIComponent(customerKey)}/subjects`,
    customerSubjectMutationResponseSchema,
    {
      json: attachCustomerSubjectRequestSchema.parse({ externalKey }),
      method: "POST",
    },
  );
}
