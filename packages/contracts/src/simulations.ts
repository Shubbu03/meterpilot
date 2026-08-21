import { z } from "zod";

import { createCursorPageSchema, cursorPaginationQuerySchema, requestIdSchema } from "./common";
import { customerKeySchema } from "./customers";
import { nonNegativeDecimalStringSchema } from "./entitlements";
import { organizationIdSchema } from "./organizations";

export const MAX_SIMULATION_CUSTOMERS = 500;
export const MAX_SIMULATION_PERIOD_DAYS = 366;
const MAX_SIMULATION_PERIOD_MS = MAX_SIMULATION_PERIOD_DAYS * 24 * 60 * 60 * 1000;

export const createSimulationRequestSchema = z
  .strictObject({
    baselinePlanVersionId: z.uuid(),
    candidatePlanVersionId: z.uuid(),
    customerKeys: z.array(customerKeySchema).min(1).max(MAX_SIMULATION_CUSTOMERS).optional(),
    increaseThresholdPercent: nonNegativeDecimalStringSchema.default("20"),
    periodEnd: z.iso.datetime({ offset: true }),
    periodStart: z.iso.datetime({ offset: true }),
  })
  .superRefine((value, context) => {
    if (Date.parse(value.periodEnd) <= Date.parse(value.periodStart)) {
      context.addIssue({
        code: "custom",
        message: "must be later than periodStart",
        path: ["periodEnd"],
      });
    }
    if (Date.parse(value.periodEnd) - Date.parse(value.periodStart) > MAX_SIMULATION_PERIOD_MS) {
      context.addIssue({
        code: "custom",
        message: `must span no more than ${MAX_SIMULATION_PERIOD_DAYS} days`,
        path: ["periodEnd"],
      });
    }
    if (value.customerKeys && new Set(value.customerKeys).size !== value.customerKeys.length) {
      context.addIssue({ code: "custom", message: "must be unique", path: ["customerKeys"] });
    }
  });

const integerMinorAmountSchema = z.string().regex(/^-?\d+$/);
const completeSimulationSummarySchema = z.strictObject({
  baselineTotalMinor: integerMinorAmountSchema,
  candidateTotalMinor: integerMinorAmountSchema,
  customerCount: z.number().int().min(0),
  decreasedCount: z.number().int().min(0),
  deltaMinor: integerMinorAmountSchema,
  excludedCount: z.number().int().min(0),
  increaseThresholdCount: z.number().int().min(0),
  increasedCount: z.number().int().min(0),
  medianDeltaMinor: integerMinorAmountSchema,
  p95DeltaMinor: integerMinorAmountSchema,
  unchangedCount: z.number().int().min(0),
});
export const simulationSummarySchema = z.union([
  z.strictObject({}),
  completeSimulationSummarySchema,
]);

const simulationBaseSchema = z.strictObject({
  baselinePlanVersionId: z.uuid(),
  candidatePlanVersionId: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
  customerCount: z.number().int().min(1),
  id: z.uuid(),
  increaseThresholdPercent: nonNegativeDecimalStringSchema,
  inputWatermark: z.iso.datetime({ offset: true }),
  periodEnd: z.iso.datetime({ offset: true }),
  periodStart: z.iso.datetime({ offset: true }),
});
export const simulationSchema = z.discriminatedUnion("status", [
  simulationBaseSchema.extend({
    calculationHash: z.null(),
    completedAt: z.null(),
    failureCode: z.null(),
    status: z.literal("pending"),
    summary: z.strictObject({}),
  }),
  simulationBaseSchema.extend({
    calculationHash: z.string().regex(/^[a-f0-9]{64}$/),
    completedAt: z.iso.datetime({ offset: true }),
    failureCode: z.null(),
    status: z.literal("completed"),
    summary: completeSimulationSummarySchema,
  }),
  simulationBaseSchema.extend({
    calculationHash: z.null(),
    completedAt: z.iso.datetime({ offset: true }),
    failureCode: z.string().min(1).max(64),
    status: z.literal("failed"),
    summary: z.strictObject({}),
  }),
]);

export const simulationWarningFlagSchema = z.enum([
  "baseline_zero_candidate_positive",
  "candidate_zero",
  "increase_threshold",
]);
export const simulationExplanationSchema = z.strictObject({
  baseline: z.array(z.record(z.string(), z.unknown())),
  candidate: z.array(z.record(z.string(), z.unknown())),
});
const simulationResultBaseSchema = z.strictObject({
  customerKey: customerKeySchema,
  id: z.uuid(),
});
export const simulationResultSchema = z.discriminatedUnion("status", [
  simulationResultBaseSchema.extend({
    baselineAmountMinor: z.string().regex(/^-?\d+$/),
    candidateAmountMinor: z.string().regex(/^-?\d+$/),
    deltaMinor: z.string().regex(/^-?\d+$/),
    deltaPercent: z.string().nullable(),
    explanation: simulationExplanationSchema,
    failureCode: z.null(),
    status: z.literal("included"),
    warningFlags: z.array(simulationWarningFlagSchema),
  }),
  simulationResultBaseSchema.extend({
    baselineAmountMinor: z.null(),
    candidateAmountMinor: z.null(),
    deltaMinor: z.null(),
    deltaPercent: z.null(),
    explanation: z.null(),
    failureCode: z.literal("invalid_usage_value"),
    status: z.literal("excluded"),
    warningFlags: z.array(z.never()).max(0),
  }),
]);

export const simulationParamSchema = z.strictObject({
  organizationId: organizationIdSchema,
  simulationId: z.uuid(),
});
export const simulationMutationResponseSchema = z.strictObject({
  jobId: z.uuid(),
  requestId: requestIdSchema,
  simulation: simulationSchema,
});
export const simulationResponseSchema = z.strictObject({ simulation: simulationSchema });
export const simulationListQuerySchema = cursorPaginationQuerySchema.extend({
  baselinePlanVersionId: z.uuid().optional(),
  candidatePlanVersionId: z.uuid().optional(),
  status: z.enum(["pending", "completed", "failed"]).optional(),
});
export const simulationListResponseSchema = createCursorPageSchema(simulationSchema);
export const simulationResultListResponseSchema = createCursorPageSchema(simulationResultSchema);
export const simulationResultListQuerySchema = cursorPaginationQuerySchema.extend({
  outcome: z.enum(["decreased", "increased", "unchanged"]).optional(),
  warningFlag: simulationWarningFlagSchema.optional(),
});
export const simulationReportQuerySchema = z.strictObject({ format: z.enum(["csv", "json"]) });

export type CreateSimulationRequest = z.output<typeof createSimulationRequestSchema>;
export type Simulation = z.infer<typeof simulationSchema>;
export type SimulationListQuery = z.output<typeof simulationListQuerySchema>;
export type SimulationResult = z.infer<typeof simulationResultSchema>;
export type SimulationResultListQuery = z.output<typeof simulationResultListQuerySchema>;
