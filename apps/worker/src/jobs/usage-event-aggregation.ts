import { createHash } from "node:crypto";

import type { MeterDimensions, MeterFilter, MeterFilterValue } from "@meterpilot/db/schema";
import Decimal from "decimal.js";
import { z } from "zod";

import { permanentJobError } from "./errors";

const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const MAX_DECIMAL_LENGTH = 128;
const ExactDecimal = Decimal.clone({ precision: 256, rounding: Decimal.ROUND_HALF_UP });
const propertyNameSchema = z.string().trim().min(1).max(128);
const filterValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const meterFilterSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.enum(["equals", "not_equals"]),
    property: propertyNameSchema,
    value: filterValueSchema,
  }),
  z.strictObject({
    operation: z.literal("exists"),
    property: propertyNameSchema,
    value: z.boolean(),
  }),
  z.strictObject({
    operation: z.literal("in"),
    property: propertyNameSchema,
    values: z.array(filterValueSchema).min(1).max(100),
  }),
]);

export const meterFilterDefinitionSchema = z.array(meterFilterSchema).max(20);
export const meterGroupByKeysSchema = z
  .array(propertyNameSchema)
  .max(3)
  .refine((keys) => new Set(keys).size === keys.length, "group-by keys must be unique");

export type PublishedMeterVersion = Readonly<{
  aggregation: "count" | "sum";
  effectiveFrom: Date;
  effectiveTo: Date | null;
  filterDefinition: unknown;
  groupByKeys: unknown;
  id: string;
  valueProperty: string | null;
}>;

export type AggregationEvent = Readonly<{
  properties: Record<string, unknown>;
  receivedAt: Date;
}>;

export type AggregatedBucket = Readonly<{
  dimensions: MeterDimensions;
  dimensionsHash: string;
  eventCount: number;
  maxReceivedAt: Date;
  quantity: string;
}>;

function isFilterValue(value: unknown): value is MeterFilterValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function sameFilterValue(left: unknown, right: MeterFilterValue): boolean {
  return isFilterValue(left) && Object.is(left, right);
}

export function matchesMeterFilters(
  properties: Record<string, unknown>,
  filters: readonly MeterFilter[],
): boolean {
  return filters.every((filter) => {
    const property = properties[filter.property];

    switch (filter.operation) {
      case "equals":
        return sameFilterValue(property, filter.value);
      case "exists":
        return filter.value ? property !== undefined : property === undefined;
      case "in":
        return filter.values.some((value) => sameFilterValue(property, value));
      case "not_equals":
        return !sameFilterValue(property, filter.value);
      default: {
        const exhaustive: never = filter;
        throw new TypeError(`Unsupported meter filter: ${String(exhaustive)}`);
      }
    }
  });
}

export function meterDimensions(
  properties: Record<string, unknown>,
  groupByKeys: readonly string[],
): MeterDimensions {
  const dimensions: Record<string, MeterFilterValue> = {};

  for (const key of groupByKeys) {
    const value = properties[key];
    if (value === undefined || value === null) {
      dimensions[key] = null;
      continue;
    }
    if (!isFilterValue(value)) {
      throw permanentJobError(
        "invalid_dimension_value",
        "A grouped event property must be a string, finite number, boolean, or null.",
      );
    }
    dimensions[key] = value;
  }

  return Object.freeze(dimensions);
}

export function dimensionsHash(dimensions: MeterDimensions): string {
  const canonical = JSON.stringify(
    Object.fromEntries(
      Object.entries(dimensions).sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

function sameDimensions(left: MeterDimensions, right: MeterDimensions): boolean {
  return dimensionsHash(left) === dimensionsHash(right);
}

function summedValue(value: unknown): Decimal {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_DECIMAL_LENGTH ||
    !DECIMAL_PATTERN.test(value)
  ) {
    throw permanentJobError(
      "invalid_meter_value",
      "A summed event property must be a bounded plain decimal string.",
    );
  }
  return new ExactDecimal(value);
}

export function aggregateBucket(
  meter: PublishedMeterVersion,
  events: readonly AggregationEvent[],
  targetDimensions: MeterDimensions,
): AggregatedBucket | null {
  const filterResult = meterFilterDefinitionSchema.safeParse(meter.filterDefinition);
  const groupByResult = meterGroupByKeysSchema.safeParse(meter.groupByKeys);
  if (!filterResult.success || !groupByResult.success) {
    throw permanentJobError(
      "invalid_meter_definition",
      "The published meter definition is invalid.",
    );
  }
  if (meter.aggregation === "sum" && !meter.valueProperty) {
    throw permanentJobError(
      "invalid_meter_definition",
      "A published sum meter must define its value property.",
    );
  }

  let quantity = new ExactDecimal(0);
  let eventCount = 0;
  let maxReceivedAt: Date | null = null;

  for (const event of events) {
    if (!matchesMeterFilters(event.properties, filterResult.data)) {
      continue;
    }
    const dimensions = meterDimensions(event.properties, groupByResult.data);
    if (!sameDimensions(dimensions, targetDimensions)) {
      continue;
    }

    quantity = quantity.plus(
      meter.aggregation === "count" ? 1 : summedValue(event.properties[meter.valueProperty ?? ""]),
    );
    eventCount++;
    if (!maxReceivedAt || event.receivedAt.getTime() > maxReceivedAt.getTime()) {
      maxReceivedAt = event.receivedAt;
    }
  }

  if (eventCount === 0 || !maxReceivedAt) {
    return null;
  }

  return Object.freeze({
    dimensions: targetDimensions,
    dimensionsHash: dimensionsHash(targetDimensions),
    eventCount,
    maxReceivedAt,
    quantity: quantity.toFixed(),
  });
}

export function startOfUtcHour(value: Date): Date {
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError("Bucket timestamp must be a valid date.");
  }
  const bucket = new Date(value);
  bucket.setUTCMinutes(0, 0, 0);
  return bucket;
}
