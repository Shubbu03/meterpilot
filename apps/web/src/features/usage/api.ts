import { customerListResponseSchema } from "@meterpilot/contracts/customers";
import { meterListResponseSchema } from "@meterpilot/contracts/meters";
import {
  type UsageQuery,
  usageQuerySchema,
  usageTimeseriesResponseSchema,
  usageTotalResponseSchema,
} from "@meterpilot/contracts/usage";

import { apiClient } from "../../lib/api/client";

export const usageKeys = {
  all: (organizationId: string) => ["organizations", organizationId, "usage"] as const,
  customers: (organizationId: string) => [...usageKeys.all(organizationId), "customers"] as const,
  meters: (organizationId: string) => [...usageKeys.all(organizationId), "meters"] as const,
  timeseries: (organizationId: string, query: UsageQuery | null) =>
    [...usageKeys.all(organizationId), "timeseries", query] as const,
  total: (organizationId: string, query: UsageQuery | null) =>
    [...usageKeys.all(organizationId), "total", query] as const,
};

function usageSearch(query: UsageQuery) {
  const validatedQuery = usageQuerySchema.parse(query);
  return new URLSearchParams(validatedQuery).toString();
}

export function listUsageCustomers(organizationId: string) {
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/customers?limit=100`,
    customerListResponseSchema,
  );
}

export function listUsageMeters(organizationId: string) {
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/meters?limit=100`,
    meterListResponseSchema,
  );
}

export function getUsageTotal(organizationId: string, query: UsageQuery) {
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/usage?${usageSearch(query)}`,
    usageTotalResponseSchema,
  );
}

export function getUsageTimeseries(organizationId: string, query: UsageQuery) {
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/usage/timeseries?${usageSearch(query)}`,
    usageTimeseriesResponseSchema,
  );
}
