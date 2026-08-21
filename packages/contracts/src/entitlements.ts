import { z } from "zod";

import { createCursorPageSchema, cursorPaginationQuerySchema, requestIdSchema } from "./common";
import { customerKeySchema } from "./customers";
import { decimalStringSchema, eventIdSchema, eventPropertiesSchema } from "./events";
import { meterKeySchema } from "./meters";
import { organizationIdSchema } from "./organizations";

export const featureKeySchema = meterKeySchema;
export const entitlementModeSchema = z.enum(["boolean", "advisory", "hard"]);
export const quotaReservationStatusSchema = z.enum(["pending", "committed", "released", "expired"]);

export const nonNegativeDecimalStringSchema = decimalStringSchema.refine(
  (value) => !value.startsWith("-"),
  "must be non-negative",
);
export const positiveDecimalStringSchema = nonNegativeDecimalStringSchema.refine(
  (value) => /[1-9]/.test(value),
  "must be greater than zero",
);

export const createFeatureRequestSchema = z.strictObject({
  key: featureKeySchema,
  meterKey: meterKeySchema.nullable().default(null),
  name: z.string().trim().min(1).max(200),
});

export const featureSchema = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  key: featureKeySchema,
  meterKey: meterKeySchema.nullable(),
  name: z.string().min(1).max(200),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const configureEntitlementRequestSchema = z
  .strictObject({
    enabled: z.boolean().default(true),
    mode: entitlementModeSchema,
    periodEnd: z.iso.datetime({ offset: true }),
    periodStart: z.iso.datetime({ offset: true }),
  })
  .refine((value) => Date.parse(value.periodEnd) > Date.parse(value.periodStart), {
    message: "must be later than periodStart",
    path: ["periodEnd"],
  });

export const createQuotaGrantRequestSchema = z
  .strictObject({
    effectiveAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
    quantity: positiveDecimalStringSchema,
    reason: z.string().trim().min(1).max(200),
  })
  .refine(
    (value) =>
      value.expiresAt === null || Date.parse(value.expiresAt) > Date.parse(value.effectiveAt),
    { message: "must be later than effectiveAt", path: ["expiresAt"] },
  );

export const createQuotaReservationRequestSchema = z.strictObject({
  expiresAt: z.iso.datetime({ offset: true }),
  featureKey: featureKeySchema,
  idempotencyKey: eventIdSchema,
  quantity: positiveDecimalStringSchema,
});

export const commitQuotaReservationRequestSchema = z.strictObject({
  occurredAt: z.iso.datetime({ offset: true }),
  properties: eventPropertiesSchema.default({}),
  quantity: positiveDecimalStringSchema,
});

export const releaseQuotaReservationRequestSchema = z.strictObject({});

export const entitlementBalanceSchema = z.strictObject({
  allowed: z.boolean(),
  availableQuantity: nonNegativeDecimalStringSchema,
  committedQuantity: nonNegativeDecimalStringSchema,
  customerKey: customerKeySchema,
  enabled: z.boolean(),
  featureKey: featureKeySchema,
  grantedQuantity: nonNegativeDecimalStringSchema,
  mode: entitlementModeSchema,
  overageQuantity: nonNegativeDecimalStringSchema,
  periodEnd: z.iso.datetime({ offset: true }),
  periodStart: z.iso.datetime({ offset: true }),
  reservedQuantity: nonNegativeDecimalStringSchema,
  updatedAt: z.iso.datetime({ offset: true }),
  version: z.number().int().min(1),
});

export const entitlementParamSchema = z.strictObject({
  customerKey: customerKeySchema,
  featureKey: featureKeySchema,
  organizationId: organizationIdSchema,
});

export const customerReservationParamSchema = z.strictObject({
  customerKey: customerKeySchema,
  organizationId: organizationIdSchema,
});

export const apiCustomerReservationParamSchema = z.strictObject({
  customerKey: customerKeySchema,
});

export const reservationParamSchema = z.strictObject({
  organizationId: organizationIdSchema,
  reservationId: z.uuid(),
});

export const apiReservationParamSchema = z.strictObject({
  reservationId: z.uuid(),
});

export const featureMutationResponseSchema = z.strictObject({
  feature: featureSchema,
  requestId: requestIdSchema,
});

export const featureListQuerySchema = cursorPaginationQuerySchema;
export const featureListResponseSchema = createCursorPageSchema(featureSchema);

export const entitlementResponseSchema = z.strictObject({
  entitlement: entitlementBalanceSchema,
  requestId: requestIdSchema,
});

export const quotaGrantSchema = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  effectiveAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  id: z.uuid(),
  quantity: positiveDecimalStringSchema,
  reason: z.string().min(1).max(200),
});

export const quotaGrantMutationResponseSchema = z.strictObject({
  entitlement: entitlementBalanceSchema,
  grant: quotaGrantSchema,
  requestId: requestIdSchema,
});

export const quotaReservationSchema = z.strictObject({
  committedQuantity: nonNegativeDecimalStringSchema.nullable(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  customerKey: customerKeySchema,
  entitlementId: z.uuid(),
  expiresAt: z.iso.datetime({ offset: true }),
  featureKey: featureKeySchema,
  id: z.uuid(),
  idempotencyKey: eventIdSchema,
  requestedQuantity: positiveDecimalStringSchema,
  status: quotaReservationStatusSchema,
  usageEventKey: eventIdSchema.nullable(),
});

export const quotaReservationMutationResponseSchema = z.strictObject({
  entitlement: entitlementBalanceSchema,
  requestId: requestIdSchema,
  reservation: quotaReservationSchema,
});

export type ConfigureEntitlementRequest = z.output<typeof configureEntitlementRequestSchema>;
export type CommitQuotaReservationRequest = z.output<typeof commitQuotaReservationRequestSchema>;
export type CreateFeatureRequest = z.output<typeof createFeatureRequestSchema>;
export type CreateQuotaGrantRequest = z.output<typeof createQuotaGrantRequestSchema>;
export type CreateQuotaReservationRequest = z.output<typeof createQuotaReservationRequestSchema>;
export type EntitlementBalance = z.infer<typeof entitlementBalanceSchema>;
export type EntitlementMode = z.infer<typeof entitlementModeSchema>;
export type Feature = z.infer<typeof featureSchema>;
export type QuotaGrant = z.infer<typeof quotaGrantSchema>;
export type QuotaReservation = z.infer<typeof quotaReservationSchema>;
export type ReleaseQuotaReservationRequest = z.output<typeof releaseQuotaReservationRequestSchema>;
