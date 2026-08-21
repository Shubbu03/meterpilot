import {
  type UsageEventListQuery,
  usageEventListQuerySchema,
  usageEventListResponseSchema,
  usageEventResponseSchema,
} from "@meterpilot/contracts/events";

import { apiClient } from "../../lib/api/client";

export const eventKeys = {
  all: (organizationId: string) => ["organizations", organizationId, "events"] as const,
  detail: (organizationId: string, eventKey: string) =>
    [...eventKeys.all(organizationId), "detail", eventKey] as const,
  list: (organizationId: string, query: UsageEventListQuery) =>
    [...eventKeys.all(organizationId), "list", query] as const,
};

function eventListSearch(query: UsageEventListQuery) {
  const validatedQuery = usageEventListQuerySchema.parse(query);
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(validatedQuery)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }

  return search.toString();
}

export function listEvents(organizationId: string, query: UsageEventListQuery) {
  const search = eventListSearch(query);
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/events?${search}`,
    usageEventListResponseSchema,
  );
}

export function getEvent(organizationId: string, eventKey: string) {
  return apiClient.request(
    `/v1/organizations/${encodeURIComponent(organizationId)}/events/${encodeURIComponent(eventKey)}`,
    usageEventResponseSchema,
  );
}
