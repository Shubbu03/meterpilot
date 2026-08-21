import { z } from "zod";

import { createCursorPageSchema, cursorPaginationQuerySchema, requestIdSchema } from "./common";
import { eventPropertiesSchema } from "./events";

export const MAX_MANUAL_JOB_RETRIES = 10;

export const jobFailureCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);

export const failedJobSchema = z.strictObject({
  attemptCount: z.number().int().positive(),
  createdAt: z.iso.datetime({ offset: true }),
  failedAt: z.iso.datetime({ offset: true }),
  failure: z.strictObject({
    code: jobFailureCodeSchema,
    message: z.string().min(1).max(512),
  }),
  id: z.uuid(),
  manualRetryCount: z.number().int().min(0).max(MAX_MANUAL_JOB_RETRIES),
  payloadMetadata: eventPropertiesSchema,
  resourceId: z.string().min(1).max(128),
  resourceType: z.string().min(1).max(64),
  retryable: z.boolean(),
  type: z.string().min(1).max(128),
});

export const failedJobListQuerySchema = cursorPaginationQuerySchema.extend({
  type: z.string().trim().min(1).max(128).optional(),
});
export const failedJobListResponseSchema = createCursorPageSchema(failedJobSchema);

export const failedJobParamSchema = z.strictObject({
  jobId: z.uuid(),
  organizationId: z.uuid(),
});

export const failedJobResponseSchema = z.strictObject({ job: failedJobSchema });

export const retryFailedJobRequestSchema = z.strictObject({
  acknowledgedAttemptCount: z.number().int().positive(),
  acknowledgedFailureCode: jobFailureCodeSchema,
  acknowledgedManualRetryCount: z
    .number()
    .int()
    .min(0)
    .max(MAX_MANUAL_JOB_RETRIES - 1),
});

export const retryFailedJobResponseSchema = z.strictObject({
  jobId: z.uuid(),
  manualRetryCount: z.number().int().min(1).max(MAX_MANUAL_JOB_RETRIES),
  nextAttemptAt: z.iso.datetime({ offset: true }),
  requestId: requestIdSchema,
  status: z.literal("pending"),
});

export type FailedJob = z.infer<typeof failedJobSchema>;
export type FailedJobListQuery = z.output<typeof failedJobListQuerySchema>;
export type RetryFailedJobRequest = z.infer<typeof retryFailedJobRequestSchema>;
