import {
  type ApiKeyScope,
  apiKeyListResponseSchema,
  createApiKeyRequestSchema,
  revealedApiKeyResponseSchema,
  revokedApiKeyResponseSchema,
} from "@meterpilot/contracts/api-keys";
import {
  type FailedJob,
  failedJobListResponseSchema,
  retryFailedJobRequestSchema,
  retryFailedJobResponseSchema,
} from "@meterpilot/contracts/jobs";
import {
  addOrganizationMemberRequestSchema,
  type OrganizationMembershipRole,
  organizationMembershipListResponseSchema,
  organizationMembershipMutationResponseSchema,
  organizationMembershipRemovalResponseSchema,
  updateOrganizationMemberRequestSchema,
} from "@meterpilot/contracts/organizations";
import {
  retentionPolicyMutationResponseSchema,
  retentionPolicyResponseSchema,
  updateRetentionPolicyRequestSchema,
} from "@meterpilot/contracts/retention";
import { apiClient } from "../../lib/api/client";

export const adminKeys = {
  all: (id: string) => ["organizations", id, "admin"] as const,
  apiKeys: (id: string) => ["organizations", id, "admin", "api-keys"] as const,
  failedJobs: (id: string) => ["organizations", id, "admin", "failed-jobs"] as const,
  members: (id: string) => ["organizations", id, "admin", "members"] as const,
  retention: (id: string) => ["organizations", id, "admin", "retention"] as const,
};
const base = (id: string) => `/v1/organizations/${encodeURIComponent(id)}`;
export function listApiKeys(id: string) {
  return apiClient.request(`${base(id)}/api-keys?limit=100`, apiKeyListResponseSchema);
}
export function createApiKey(id: string, scopes: ApiKeyScope[], expiresAt?: string) {
  return apiClient.request(`${base(id)}/api-keys`, revealedApiKeyResponseSchema, {
    json: createApiKeyRequestSchema.parse({ ...(expiresAt ? { expiresAt } : {}), scopes }),
    method: "POST",
  });
}
export function rotateApiKey(id: string, keyId: string) {
  return apiClient.request(
    `${base(id)}/api-keys/${encodeURIComponent(keyId)}/rotate`,
    revealedApiKeyResponseSchema,
    { method: "POST" },
  );
}
export function revokeApiKey(id: string, keyId: string) {
  return apiClient.request(
    `${base(id)}/api-keys/${encodeURIComponent(keyId)}/revoke`,
    revokedApiKeyResponseSchema,
    { method: "POST" },
  );
}
export function listFailedJobs(id: string) {
  return apiClient.request(`${base(id)}/failed-jobs?limit=100`, failedJobListResponseSchema);
}
export function retryFailedJob(id: string, job: FailedJob) {
  return apiClient.request(
    `${base(id)}/failed-jobs/${job.id}/retry`,
    retryFailedJobResponseSchema,
    {
      json: retryFailedJobRequestSchema.parse({
        acknowledgedAttemptCount: job.attemptCount,
        acknowledgedFailureCode: job.failure.code,
        acknowledgedManualRetryCount: job.manualRetryCount,
      }),
      method: "POST",
    },
  );
}
export function getRetention(id: string) {
  return apiClient.request(`${base(id)}/retention-policy`, retentionPolicyResponseSchema);
}
export function updateRetention(id: string, days: number | null) {
  return apiClient.request(`${base(id)}/retention-policy`, retentionPolicyMutationResponseSchema, {
    json: updateRetentionPolicyRequestSchema.parse({ eventPropertiesRetentionDays: days }),
    method: "PUT",
  });
}
export function listMembers(id: string) {
  return apiClient.request(
    `${base(id)}/members?limit=100`,
    organizationMembershipListResponseSchema,
  );
}
export function addMember(id: string, email: string, role: OrganizationMembershipRole) {
  return apiClient.request(`${base(id)}/members`, organizationMembershipMutationResponseSchema, {
    json: addOrganizationMemberRequestSchema.parse({ email, role }),
    method: "POST",
  });
}
export function updateMember(id: string, userId: string, role: OrganizationMembershipRole) {
  return apiClient.request(
    `${base(id)}/members/${userId}`,
    organizationMembershipMutationResponseSchema,
    { json: updateOrganizationMemberRequestSchema.parse({ role }), method: "PATCH" },
  );
}
export function removeMember(id: string, userId: string) {
  return apiClient.request(
    `${base(id)}/members/${userId}`,
    organizationMembershipRemovalResponseSchema,
    { method: "DELETE" },
  );
}
