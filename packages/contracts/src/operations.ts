import { z } from "zod";

import { customerKeySchema } from "./customers";
import { decimalStringSchema, eventPropertiesSchema } from "./events";
import { meterKeySchema } from "./meters";
import { createCursorPageSchema, cursorPaginationQuerySchema, requestIdSchema } from "./common";

export const MAX_OPERATION_PERIOD_DAYS = 366;
export const MAX_STRIPE_INVOICE_ITEMS = 250;

const operationPeriodFields = {
  customerKey: customerKeySchema,
  meterKey: meterKeySchema,
  periodEnd: z.iso.datetime({ offset: true }),
  periodStart: z.iso.datetime({ offset: true }),
};

function validOperationPeriod(
  value: { periodEnd: string; periodStart: string },
  context: z.RefinementCtx,
) {
  const start = Date.parse(value.periodStart);
  const end = Date.parse(value.periodEnd);
  if (start >= end) {
    context.addIssue({ code: "custom", message: "must be after periodStart", path: ["periodEnd"] });
  }
  if (end - start > MAX_OPERATION_PERIOD_DAYS * 24 * 60 * 60 * 1000) {
    context.addIssue({
      code: "custom",
      message: `must not exceed ${MAX_OPERATION_PERIOD_DAYS} days`,
      path: ["periodEnd"],
    });
  }
  if (start % (60 * 60 * 1000) !== 0 || end % (60 * 60 * 1000) !== 0) {
    context.addIssue({
      code: "custom",
      message: "period boundaries must align to UTC hours",
      path: ["periodStart"],
    });
  }
}

export const createReconciliationRunRequestSchema = z
  .strictObject({
    ...operationPeriodFields,
    repair: z.boolean().default(false),
  })
  .superRefine(validOperationPeriod);

export const createReplayRequestSchema = z
  .strictObject(operationPeriodFields)
  .superRefine(validOperationPeriod);

export const reconciliationRunKindSchema = z.enum(["reconciliation", "replay"]);
export const reconciliationRunStatusSchema = z.enum(["pending", "completed", "failed"]);

export const reconciliationSummarySchema = z.strictObject({
  driftCount: z.number().int().nonnegative(),
  repairedCount: z.number().int().nonnegative(),
  totalMagnitude: decimalStringSchema.refine((value) => !value.startsWith("-")),
});

const reconciliationRunCommonSchema = z.strictObject({
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  customerKey: customerKeySchema,
  id: z.uuid(),
  inputWatermark: z.iso.datetime({ offset: true }),
  kind: reconciliationRunKindSchema,
  meterKey: meterKeySchema,
  periodEnd: z.iso.datetime({ offset: true }),
  periodStart: z.iso.datetime({ offset: true }),
  repairRequested: z.boolean(),
});

export const reconciliationRunSchema = z.discriminatedUnion("status", [
  reconciliationRunCommonSchema.extend({
    afterHash: z.null(),
    beforeHash: z.null(),
    failureCode: z.null(),
    status: z.literal("pending"),
    summary: z.null(),
  }),
  reconciliationRunCommonSchema.extend({
    afterHash: z.string().regex(/^[a-f0-9]{64}$/),
    beforeHash: z.string().regex(/^[a-f0-9]{64}$/),
    completedAt: z.iso.datetime({ offset: true }),
    failureCode: z.null(),
    status: z.literal("completed"),
    summary: reconciliationSummarySchema,
  }),
  reconciliationRunCommonSchema.extend({
    afterHash: z.null(),
    beforeHash: z.null(),
    completedAt: z.iso.datetime({ offset: true }),
    failureCode: z.string().min(1).max(128),
    status: z.literal("failed"),
    summary: z.null(),
  }),
]);

export const reconciliationRunParamSchema = z.strictObject({
  organizationId: z.uuid(),
  runId: z.uuid(),
});

export const reconciliationRunMutationResponseSchema = z.strictObject({
  jobId: z.uuid(),
  requestId: requestIdSchema,
  run: reconciliationRunSchema,
});

export const reconciliationRunResponseSchema = z.strictObject({
  run: reconciliationRunSchema,
});
export const reconciliationRunListQuerySchema = cursorPaginationQuerySchema.extend({
  customerKey: customerKeySchema.optional(),
  kind: reconciliationRunKindSchema.optional(),
  meterKey: meterKeySchema.optional(),
  repairRequested: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  status: reconciliationRunStatusSchema.optional(),
});
export const reconciliationRunListResponseSchema = createCursorPageSchema(reconciliationRunSchema);

export const reconciliationFindingKindSchema = z.enum(["missing", "unexpected", "mismatch"]);
export const reconciliationFindingSchema = z.strictObject({
  actualEventCount: z.number().int().nonnegative().nullable(),
  actualQuantity: decimalStringSchema.nullable(),
  bucketStart: z.iso.datetime({ offset: true }),
  dimensions: eventPropertiesSchema,
  dimensionsHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedEventCount: z.number().int().nonnegative().nullable(),
  expectedQuantity: decimalStringSchema.nullable(),
  id: z.uuid(),
  kind: reconciliationFindingKindSchema,
  meterVersionId: z.uuid(),
  repaired: z.boolean(),
});
export const reconciliationFindingListResponseSchema = createCursorPageSchema(
  reconciliationFindingSchema,
);

export const auditLogQuerySchema = cursorPaginationQuerySchema.extend({
  action: z.string().trim().min(1).max(128).optional(),
  resourceId: z.string().trim().min(1).max(128).optional(),
  resourceType: z.string().trim().min(1).max(64).optional(),
});

export const auditLogEntrySchema = z.strictObject({
  action: z.string().min(1).max(128),
  actor: z.discriminatedUnion("type", [
    z.strictObject({ apiKeyId: z.null(), type: z.literal("system"), userId: z.null() }),
    z.strictObject({ apiKeyId: z.null(), type: z.literal("user"), userId: z.uuid() }),
    z.strictObject({ apiKeyId: z.uuid(), type: z.literal("api_key"), userId: z.null() }),
  ]),
  id: z.uuid(),
  metadata: eventPropertiesSchema,
  occurredAt: z.iso.datetime({ offset: true }),
  requestId: requestIdSchema.nullable(),
  resourceId: z.string().min(1).max(128).nullable(),
  resourceType: z.string().min(1).max(64),
});
export const auditLogListResponseSchema = createCursorPageSchema(auditLogEntrySchema);

export const stripeCustomerIdSchema = z
  .string()
  .trim()
  .min(5)
  .max(255)
  .regex(/^cus_[A-Za-z0-9]+$/, "must be a Stripe customer identifier");

export const createStripeInvoiceLineExportRequestSchema = z.strictObject({
  previewId: z.uuid(),
  stripeCustomerId: stripeCustomerIdSchema,
});

export const stripeInvoiceItemSchema = z.strictObject({
  amount: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[a-z]{3}$/),
  customer: stripeCustomerIdSchema,
  description: z.string().min(1).max(500),
  metadata: z.record(z.string().min(1).max(40), z.string().max(500)),
});

export const stripeInvoiceLineExportFileSchema = z.strictObject({
  items: z.array(stripeInvoiceItemSchema).min(1).max(MAX_STRIPE_INVOICE_ITEMS),
  object: z.literal("meterpilot.stripe_invoice_item_batch"),
  source: z.strictObject({
    previewHash: z.string().regex(/^[a-f0-9]{64}$/),
    previewId: z.uuid(),
    previewRevision: z.number().int().positive(),
    previewRevisionId: z.uuid(),
  }),
  version: z.literal("2026-08-20"),
});

const billingExportCommonSchema = z.strictObject({
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  sourcePreviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourcePreviewId: z.uuid(),
  sourcePreviewRevision: z.number().int().positive(),
  sourcePreviewRevisionId: z.uuid(),
  stripeCustomerId: stripeCustomerIdSchema,
});

export const billingExportSchema = z.discriminatedUnion("status", [
  billingExportCommonSchema.extend({
    contentHash: z.null(),
    failureCode: z.null(),
    status: z.literal("pending"),
  }),
  billingExportCommonSchema.extend({
    completedAt: z.iso.datetime({ offset: true }),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    failureCode: z.null(),
    status: z.literal("completed"),
  }),
  billingExportCommonSchema.extend({
    completedAt: z.iso.datetime({ offset: true }),
    contentHash: z.null(),
    failureCode: z.string().min(1).max(128),
    status: z.literal("failed"),
  }),
]);

export const billingExportParamSchema = z.strictObject({
  exportId: z.uuid(),
  organizationId: z.uuid(),
});
export const billingExportMutationResponseSchema = z.strictObject({
  export: billingExportSchema,
  jobId: z.uuid(),
  requestId: requestIdSchema,
});
export const billingExportResponseSchema = z.strictObject({ export: billingExportSchema });
export const billingExportListQuerySchema = cursorPaginationQuerySchema.extend({
  sourcePreviewId: z.uuid().optional(),
  status: reconciliationRunStatusSchema.optional(),
  stripeCustomerId: stripeCustomerIdSchema.optional(),
});
export const billingExportListResponseSchema = createCursorPageSchema(billingExportSchema);

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
export type AuditLogQuery = z.output<typeof auditLogQuerySchema>;
export type BillingExport = z.infer<typeof billingExportSchema>;
export type BillingExportListQuery = z.output<typeof billingExportListQuerySchema>;
export type CreateReconciliationRunRequest = z.output<typeof createReconciliationRunRequestSchema>;
export type CreateReplayRequest = z.output<typeof createReplayRequestSchema>;
export type CreateStripeInvoiceLineExportRequest = z.output<
  typeof createStripeInvoiceLineExportRequestSchema
>;
export type ReconciliationFinding = z.infer<typeof reconciliationFindingSchema>;
export type ReconciliationRun = z.infer<typeof reconciliationRunSchema>;
export type ReconciliationRunListQuery = z.output<typeof reconciliationRunListQuerySchema>;
export type StripeInvoiceLineExportFile = z.infer<typeof stripeInvoiceLineExportFileSchema>;
