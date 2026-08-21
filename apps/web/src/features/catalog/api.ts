import {
  type CreatePlanRequest,
  type CreatePlanVersionRequest,
  type CreateSubscriptionRequest,
  cancelSubscriptionRequestSchema,
  createPlanRequestSchema,
  createPlanVersionRequestSchema,
  createSubscriptionRequestSchema,
  planListResponseSchema,
  planMutationResponseSchema,
  planVersionMutationResponseSchema,
  subscriptionListResponseSchema,
  subscriptionMutationResponseSchema,
} from "@meterpilot/contracts/catalog";

import { apiClient } from "../../lib/api/client";

export const catalogKeys = {
  all: (organizationId: string) => ["organizations", organizationId, "catalog"] as const,
  plans: (organizationId: string) => [...catalogKeys.all(organizationId), "plans"] as const,
  subscriptions: (organizationId: string) =>
    [...catalogKeys.all(organizationId), "subscriptions"] as const,
};

function organizationPath(organizationId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}`;
}

export function listPlans(organizationId: string) {
  return apiClient.request(
    `${organizationPath(organizationId)}/plans?limit=100`,
    planListResponseSchema,
  );
}

export function createPlan(organizationId: string, input: CreatePlanRequest) {
  return apiClient.request(
    `${organizationPath(organizationId)}/plans`,
    planMutationResponseSchema,
    { json: createPlanRequestSchema.parse(input), method: "POST" },
  );
}

export function createPlanVersion(
  organizationId: string,
  planKey: string,
  input: CreatePlanVersionRequest,
) {
  return apiClient.request(
    `${organizationPath(organizationId)}/plans/${encodeURIComponent(planKey)}/versions`,
    planVersionMutationResponseSchema,
    { json: createPlanVersionRequestSchema.parse(input), method: "POST" },
  );
}

export function publishPlanVersion(organizationId: string, planKey: string, version: number) {
  return apiClient.request(
    `${organizationPath(organizationId)}/plans/${encodeURIComponent(planKey)}/versions/${version}/publish`,
    planVersionMutationResponseSchema,
    { method: "POST" },
  );
}

export function listSubscriptions(organizationId: string) {
  return apiClient.request(
    `${organizationPath(organizationId)}/subscriptions?limit=100`,
    subscriptionListResponseSchema,
  );
}

export function createSubscription(organizationId: string, input: CreateSubscriptionRequest) {
  return apiClient.request(
    `${organizationPath(organizationId)}/subscriptions`,
    subscriptionMutationResponseSchema,
    { json: createSubscriptionRequestSchema.parse(input), method: "POST" },
  );
}

export function cancelSubscription(organizationId: string, subscriptionId: string, endsAt: string) {
  return apiClient.request(
    `${organizationPath(organizationId)}/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    subscriptionMutationResponseSchema,
    { json: cancelSubscriptionRequestSchema.parse({ endsAt }), method: "POST" },
  );
}
