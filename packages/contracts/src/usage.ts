import { z } from "zod";

import { requestIdSchema } from "./common";
import { customerKeySchema } from "./customers";
import { decimalStringSchema } from "./events";
import { meterKeySchema } from "./meters";

export const MAX_USAGE_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

const nonNegativeIntegerStringSchema = z.string().regex(/^\d+$/, "must be a non-negative integer");

function isUtcHourBoundary(value: string): boolean {
  const parsed = new Date(value);
  return (
    parsed.getUTCMinutes() === 0 &&
    parsed.getUTCSeconds() === 0 &&
    parsed.getUTCMilliseconds() === 0
  );
}

export const usageQuerySchema = z
  .strictObject({
    customerKey: customerKeySchema,
    from: z.iso.datetime({ offset: true }),
    meterKey: meterKeySchema,
    to: z.iso.datetime({ offset: true }),
  })
  .superRefine((value, context) => {
    const from = Date.parse(value.from);
    const to = Date.parse(value.to);

    if (to <= from) {
      context.addIssue({ code: "custom", message: "must be later than from", path: ["to"] });
    } else if (to - from > MAX_USAGE_RANGE_MS) {
      context.addIssue({
        code: "custom",
        message: "range must not exceed 366 days",
        path: ["to"],
      });
    }
    if (!isUtcHourBoundary(value.from)) {
      context.addIssue({
        code: "custom",
        message: "must be aligned to a UTC hour boundary",
        path: ["from"],
      });
    }
    if (!isUtcHourBoundary(value.to)) {
      context.addIssue({
        code: "custom",
        message: "must be aligned to a UTC hour boundary",
        path: ["to"],
      });
    }
  });

export const usageFreshnessSchema = z.strictObject({
  lagSeconds: z.number().int().nonnegative(),
  maxReceivedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const usageTotalSchema = z.strictObject({
  customerKey: customerKeySchema,
  eventCount: nonNegativeIntegerStringSchema,
  freshness: usageFreshnessSchema.nullable(),
  from: z.iso.datetime({ offset: true }),
  meterKey: meterKeySchema,
  quantity: decimalStringSchema,
  to: z.iso.datetime({ offset: true }),
});

export const usageTimeseriesPointSchema = z.strictObject({
  bucketStart: z.iso.datetime({ offset: true }),
  eventCount: nonNegativeIntegerStringSchema,
  quantity: decimalStringSchema,
});

export const usageTotalResponseSchema = z.strictObject({
  requestId: requestIdSchema,
  usage: usageTotalSchema,
});

export const usageTimeseriesResponseSchema = z.strictObject({
  customerKey: customerKeySchema,
  freshness: usageFreshnessSchema.nullable(),
  from: z.iso.datetime({ offset: true }),
  meterKey: meterKeySchema,
  points: z.array(usageTimeseriesPointSchema),
  requestId: requestIdSchema,
  to: z.iso.datetime({ offset: true }),
});

export type UsageFreshness = z.infer<typeof usageFreshnessSchema>;
export type UsageQuery = z.output<typeof usageQuerySchema>;
export type UsageTimeseriesPoint = z.infer<typeof usageTimeseriesPointSchema>;
export type UsageTotal = z.infer<typeof usageTotalSchema>;
