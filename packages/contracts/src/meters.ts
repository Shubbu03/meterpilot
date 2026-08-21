import { z } from "zod";

import { createCursorPageSchema, requestIdSchema } from "./common";
import { eventTypeSchema } from "./events";
import { organizationIdSchema } from "./organizations";

const METER_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const PROPERTY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export const meterKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(METER_KEY_PATTERN, "must be a lowercase dotted meter key");

export const meterPropertyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(PROPERTY_KEY_PATTERN, "must contain only safe property-key characters");

export const meterFilterValueSchema = z.union([
  z.string().max(1024),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const meterFilterSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.enum(["equals", "not_equals"]),
    property: meterPropertyKeySchema,
    value: meterFilterValueSchema,
  }),
  z.strictObject({
    operation: z.literal("exists"),
    property: meterPropertyKeySchema,
    value: z.boolean(),
  }),
  z.strictObject({
    operation: z.literal("in"),
    property: meterPropertyKeySchema,
    values: z.array(meterFilterValueSchema).min(1).max(100),
  }),
]);

export const meterFiltersSchema = z.array(meterFilterSchema).max(20).default([]);
export const meterGroupByKeysSchema = z
  .array(meterPropertyKeySchema)
  .max(3)
  .default([])
  .refine((keys) => new Set(keys).size === keys.length, "must contain unique property keys");

export const createMeterRequestSchema = z.strictObject({
  key: meterKeySchema,
  name: z.string().trim().min(1).max(200),
});

export const createMeterVersionRequestSchema = z
  .strictObject({
    aggregation: z.enum(["count", "sum"]),
    effectiveFrom: z.iso.datetime({ offset: true }),
    effectiveTo: z.iso.datetime({ offset: true }).nullable().default(null),
    eventType: eventTypeSchema,
    filters: meterFiltersSchema,
    groupByKeys: meterGroupByKeysSchema,
    valueProperty: meterPropertyKeySchema.nullable().default(null),
  })
  .superRefine((value, context) => {
    if (value.aggregation === "count" && value.valueProperty !== null) {
      context.addIssue({
        code: "custom",
        message: "must be null for count aggregation",
        path: ["valueProperty"],
      });
    }
    if (value.aggregation === "sum" && value.valueProperty === null) {
      context.addIssue({
        code: "custom",
        message: "is required for sum aggregation",
        path: ["valueProperty"],
      });
    }
    if (
      value.effectiveTo !== null &&
      Date.parse(value.effectiveTo) <= Date.parse(value.effectiveFrom)
    ) {
      context.addIssue({
        code: "custom",
        message: "must be later than effectiveFrom",
        path: ["effectiveTo"],
      });
    }
  });

export const meterVersionSchema = z.strictObject({
  aggregation: z.enum(["count", "sum"]),
  createdAt: z.iso.datetime({ offset: true }),
  effectiveFrom: z.iso.datetime({ offset: true }),
  effectiveTo: z.iso.datetime({ offset: true }).nullable(),
  eventType: eventTypeSchema,
  filters: z.array(meterFilterSchema),
  groupByKeys: z.array(meterPropertyKeySchema).max(3),
  id: z.uuid(),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  valueProperty: meterPropertyKeySchema.nullable(),
  version: z.number().int().min(1),
});

export const meterSchema = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  key: meterKeySchema,
  name: z.string().min(1).max(200),
  status: z.enum(["draft", "active", "archived"]),
  updatedAt: z.iso.datetime({ offset: true }),
  versions: z.array(meterVersionSchema),
});

export const meterParamSchema = z.strictObject({
  meterKey: meterKeySchema,
  organizationId: organizationIdSchema,
});

export const meterVersionParamSchema = z.strictObject({
  meterKey: meterKeySchema,
  organizationId: organizationIdSchema,
  version: z.coerce.number().int().min(1),
});

export const meterListResponseSchema = createCursorPageSchema(meterSchema);

export const meterMutationResponseSchema = z.strictObject({
  meter: meterSchema,
  requestId: requestIdSchema,
});

export const meterVersionMutationResponseSchema = z.strictObject({
  meterVersion: meterVersionSchema,
  requestId: requestIdSchema,
});

export const meterPublishResponseSchema = z.strictObject({
  meterVersion: meterVersionSchema,
  rebuildJobId: z.uuid(),
  requestId: requestIdSchema,
});

export type CreateMeterRequest = z.output<typeof createMeterRequestSchema>;
export type CreateMeterVersionRequest = z.output<typeof createMeterVersionRequestSchema>;
export type Meter = z.infer<typeof meterSchema>;
export type MeterFilter = z.infer<typeof meterFilterSchema>;
export type MeterVersion = z.infer<typeof meterVersionSchema>;
