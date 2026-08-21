import { z } from "zod";

import { requestIdSchema } from "./common";

export const MIN_EVENT_PROPERTY_RETENTION_DAYS = 30;
export const MAX_EVENT_PROPERTY_RETENTION_DAYS = 3_650;

export const retentionPolicyParamSchema = z.strictObject({
  organizationId: z.uuid(),
});

export const updateRetentionPolicyRequestSchema = z.strictObject({
  eventPropertiesRetentionDays: z
    .number()
    .int()
    .min(MIN_EVENT_PROPERTY_RETENTION_DAYS)
    .max(MAX_EVENT_PROPERTY_RETENTION_DAYS)
    .nullable(),
});

export const retentionPolicySchema = z.strictObject({
  eventPropertiesRetentionDays: z
    .number()
    .int()
    .min(MIN_EVENT_PROPERTY_RETENTION_DAYS)
    .max(MAX_EVENT_PROPERTY_RETENTION_DAYS)
    .nullable(),
  organizationId: z.uuid(),
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
  updatedBy: z.uuid().nullable(),
  version: z.number().int().nonnegative(),
});

export const retentionPolicyResponseSchema = z.strictObject({
  policy: retentionPolicySchema,
});

export const retentionPolicyMutationResponseSchema = z.strictObject({
  jobId: z.uuid().nullable(),
  policy: retentionPolicySchema,
  requestId: requestIdSchema,
});

export const retentionEnforcementJobPayloadSchema = z.strictObject({
  organizationId: z.uuid(),
  policyVersion: z.number().int().positive(),
  requestId: requestIdSchema,
});

export type RetentionEnforcementJobPayload = z.infer<typeof retentionEnforcementJobPayloadSchema>;
export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;
export type UpdateRetentionPolicyRequest = z.infer<typeof updateRetentionPolicyRequestSchema>;
