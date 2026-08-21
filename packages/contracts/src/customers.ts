import { z } from "zod";

import { createCursorPageSchema, cursorPaginationQuerySchema, requestIdSchema } from "./common";
import { eventPropertiesSchema, subjectKeySchema } from "./events";
import { organizationIdSchema, timezoneSchema } from "./organizations";

export const MAX_CUSTOMER_SUBJECTS_PER_REQUEST = 100;

export const customerKeySchema = subjectKeySchema;

const customerSubjectsSchema = z
  .array(subjectKeySchema)
  .max(MAX_CUSTOMER_SUBJECTS_PER_REQUEST)
  .default([])
  .refine((subjects) => new Set(subjects).size === subjects.length, {
    message: "must not contain duplicate subject keys",
  });

export const createCustomerRequestSchema = z.strictObject({
  billingTimezone: timezoneSchema.default("UTC"),
  email: z
    .email()
    .transform((email) => email.toLowerCase())
    .nullable()
    .optional(),
  externalKey: customerKeySchema,
  metadata: eventPropertiesSchema.default({}),
  name: z.string().trim().min(1).max(200),
  subjects: customerSubjectsSchema,
});

export const attachCustomerSubjectRequestSchema = z.strictObject({
  externalKey: subjectKeySchema,
});

export const customerSubjectSchema = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  externalKey: subjectKeySchema,
  id: z.uuid(),
});

export const customerSchema = z.strictObject({
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
  billingTimezone: timezoneSchema,
  createdAt: z.iso.datetime({ offset: true }),
  email: z.email().nullable(),
  externalKey: customerKeySchema,
  id: z.uuid(),
  metadata: eventPropertiesSchema,
  name: z.string().min(1).max(200),
  subjects: z.array(customerSubjectSchema),
});

export const customerParamSchema = z.strictObject({
  customerKey: customerKeySchema,
  organizationId: organizationIdSchema,
});

export const customerMutationResponseSchema = z.strictObject({
  customer: customerSchema,
  requestId: requestIdSchema,
});

export const customerDetailResponseSchema = z.strictObject({
  customer: customerSchema,
});

export const customerListQuerySchema = cursorPaginationQuerySchema;
export const customerListResponseSchema = createCursorPageSchema(customerSchema);

export const customerSubjectMutationResponseSchema = z.strictObject({
  requestId: requestIdSchema,
  subject: customerSubjectSchema,
});

export type AttachCustomerSubjectRequest = z.output<typeof attachCustomerSubjectRequestSchema>;
export type CreateCustomerRequest = z.output<typeof createCustomerRequestSchema>;
export type Customer = z.infer<typeof customerSchema>;
export type CustomerSubject = z.infer<typeof customerSubjectSchema>;
