import {
  type CreateMeterRequest,
  type CreateMeterVersionRequest,
  createMeterRequestSchema,
  createMeterVersionRequestSchema,
  meterListResponseSchema,
  meterMutationResponseSchema,
  meterPublishResponseSchema,
  meterVersionMutationResponseSchema,
} from "@meterpilot/contracts/meters";

import { apiClient } from "../../lib/api/client";

export const meterKeys = {
  all: (organizationId: string) => ["organizations", organizationId, "meters"] as const,
  list: (organizationId: string) => [...meterKeys.all(organizationId), "list"] as const,
};

export function listMeters(organizationId: string) {
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/meters?limit=100`,
    meterListResponseSchema,
  );
}

export function createMeter(organizationId: string, input: CreateMeterRequest) {
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/meters`,
    meterMutationResponseSchema,
    { json: createMeterRequestSchema.parse(input), method: "POST" },
  );
}

export function createMeterVersion(
  organizationId: string,
  meterKey: string,
  input: CreateMeterVersionRequest,
) {
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/meters/${encodeURIComponent(meterKey)}/versions`,
    meterVersionMutationResponseSchema,
    { json: createMeterVersionRequestSchema.parse(input), method: "POST" },
  );
}

export function publishMeterVersion(organizationId: string, meterKey: string, version: number) {
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/meters/${encodeURIComponent(meterKey)}/versions/${version}/publish`,
    meterPublishResponseSchema,
    { method: "POST" },
  );
}

export function archiveMeter(organizationId: string, meterKey: string) {
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/meters/${encodeURIComponent(meterKey)}/archive`,
    meterMutationResponseSchema,
    { method: "POST" },
  );
}
