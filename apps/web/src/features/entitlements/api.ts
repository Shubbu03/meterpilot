import {
  type ConfigureEntitlementRequest,
  type CreateFeatureRequest,
  type CreateQuotaGrantRequest,
  configureEntitlementRequestSchema,
  createFeatureRequestSchema,
  createQuotaGrantRequestSchema,
  entitlementResponseSchema,
  featureListResponseSchema,
  featureMutationResponseSchema,
  quotaGrantMutationResponseSchema,
} from "@meterpilot/contracts/entitlements";

import { apiClient } from "../../lib/api/client";

export const entitlementKeys = {
  all: (organizationId: string) => ["organizations", organizationId, "entitlements"] as const,
  balance: (organizationId: string, customerKey: string, featureKey: string) =>
    [...entitlementKeys.all(organizationId), "balance", customerKey, featureKey] as const,
  features: (organizationId: string) =>
    [...entitlementKeys.all(organizationId), "features"] as const,
};

export function listFeatures(organizationId: string) {
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/features?limit=100`,
    featureListResponseSchema,
  );
}

export function createFeature(organizationId: string, input: CreateFeatureRequest) {
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/features`,
    featureMutationResponseSchema,
    { json: createFeatureRequestSchema.parse(input), method: "POST" },
  );
}

export function getEntitlementBalance(
  organizationId: string,
  customerKey: string,
  featureKey: string,
) {
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/customers/${encodeURIComponent(customerKey)}/entitlements/${encodeURIComponent(featureKey)}`,
    entitlementResponseSchema,
  );
}

export function configureEntitlement(
  organizationId: string,
  customerKey: string,
  featureKey: string,
  input: ConfigureEntitlementRequest,
) {
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/customers/${encodeURIComponent(customerKey)}/entitlements/${encodeURIComponent(featureKey)}`,
    entitlementResponseSchema,
    { json: configureEntitlementRequestSchema.parse(input), method: "PUT" },
  );
}

export function addQuotaGrant(
  organizationId: string,
  customerKey: string,
  featureKey: string,
  input: CreateQuotaGrantRequest,
) {
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/customers/${encodeURIComponent(customerKey)}/entitlements/${encodeURIComponent(featureKey)}/grants`,
    quotaGrantMutationResponseSchema,
    { json: createQuotaGrantRequestSchema.parse(input), method: "POST" },
  );
}
