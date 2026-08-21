import { z } from "zod";

import { createCursorPageSchema, cursorPaginationQuerySchema, requestIdSchema } from "./common";
import { currencySchema } from "./catalog";
import { customerKeySchema } from "./customers";
import { organizationIdSchema } from "./organizations";

export const createInvoicePreviewRequestSchema = z
  .strictObject({
    periodEnd: z.iso.datetime({ offset: true }),
    periodStart: z.iso.datetime({ offset: true }),
    subscriptionId: z.uuid(),
  })
  .refine((value) => Date.parse(value.periodEnd) > Date.parse(value.periodStart), {
    message: "periodEnd must be later than periodStart",
    path: ["periodEnd"],
  });

export const invoicePreviewLineSchema = z.strictObject({
  amountMinor: z.string().regex(/^-?\d+$/),
  calculationHash: z.string().regex(/^[a-f0-9]{64}$/),
  componentKey: z.string().min(1).max(128),
  id: z.uuid(),
  meterVersionIds: z.array(z.uuid()),
  preRoundAmount: z.string(),
  pricingTrace: z.record(z.string(), z.unknown()),
  quantity: z.string(),
  roundedAmount: z.string(),
  sourceBuckets: z.array(z.record(z.string(), z.unknown())),
});

export const invoicePreviewSchema = z.strictObject({
  adjustmentOfPreviewId: z.uuid().nullable().default(null),
  calculationHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  currency: currencySchema,
  failureCode: z.string().min(1).max(64).nullable(),
  id: z.uuid(),
  inputSnapshot: z.record(z.string(), z.unknown()),
  lines: z.array(invoicePreviewLineSchema),
  periodEnd: z.iso.datetime({ offset: true }),
  periodStart: z.iso.datetime({ offset: true }),
  planVersionId: z.uuid(),
  revision: z.number().int().min(1),
  seriesId: z.uuid(),
  status: z.enum(["pending", "completed", "failed"]),
  subscriptionId: z.uuid(),
  subtotalMinor: z
    .string()
    .regex(/^-?\d+$/)
    .nullable(),
});

export const invoicePreviewParamSchema = z.strictObject({
  organizationId: organizationIdSchema,
  previewId: z.uuid(),
});
export const invoicePreviewRevisionParamSchema = invoicePreviewParamSchema.extend({
  revision: z.coerce.number().int().min(1),
});

export const invoicePreviewSummarySchema = invoicePreviewSchema
  .omit({ inputSnapshot: true, lines: true })
  .extend({ customerKey: customerKeySchema });

export const invoicePreviewListQuerySchema = cursorPaginationQuerySchema.extend({
  customerKey: customerKeySchema.optional(),
  status: z.enum(["pending", "completed", "failed"]).optional(),
  subscriptionId: z.uuid().optional(),
});
export const invoicePreviewListResponseSchema = createCursorPageSchema(invoicePreviewSummarySchema);
export const invoicePreviewRevisionListResponseSchema = createCursorPageSchema(
  invoicePreviewSummarySchema,
);
export const invoicePreviewMutationResponseSchema = z.strictObject({
  jobId: z.uuid(),
  preview: invoicePreviewSchema,
  requestId: requestIdSchema,
});
export const invoicePreviewResponseSchema = z.strictObject({ preview: invoicePreviewSchema });

export type CreateInvoicePreviewRequest = z.output<typeof createInvoicePreviewRequestSchema>;
export type InvoicePreview = z.infer<typeof invoicePreviewSchema>;
export type InvoicePreviewListQuery = z.output<typeof invoicePreviewListQuerySchema>;
export type InvoicePreviewLine = z.infer<typeof invoicePreviewLineSchema>;
export type InvoicePreviewSummary = z.infer<typeof invoicePreviewSummarySchema>;
