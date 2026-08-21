import { z } from "zod";

import { createCursorPageSchema, requestIdSchema } from "./common";
import { customerKeySchema } from "./customers";
import {
  entitlementModeSchema,
  featureKeySchema,
  nonNegativeDecimalStringSchema,
} from "./entitlements";
import { organizationIdSchema } from "./organizations";

const CATALOG_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export const catalogKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(CATALOG_KEY_PATTERN, "must be a lowercase dotted catalog key");
export const currencySchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, "must be a three-letter uppercase currency code");
export const billingIntervalSchema = z.literal("month");
export const roundingDefinitionSchema = z.strictObject({
  minorUnitScale: z.number().int().min(0).max(6).default(2),
  mode: z.literal("half_away_from_zero").default("half_away_from_zero"),
});

export const flatPriceSchema = z.strictObject({
  amount: nonNegativeDecimalStringSchema,
  model: z.literal("flat"),
});
export const perUnitPriceSchema = z.strictObject({
  model: z.literal("per_unit"),
  unitRate: nonNegativeDecimalStringSchema,
});
export const includedOveragePriceSchema = z.strictObject({
  includedQuantity: nonNegativeDecimalStringSchema,
  model: z.literal("included_overage"),
  overageRate: nonNegativeDecimalStringSchema,
});
export const graduatedPriceSchema = z
  .strictObject({
    model: z.literal("graduated"),
    tiers: z
      .array(
        z.strictObject({
          unitRate: nonNegativeDecimalStringSchema,
          upTo: nonNegativeDecimalStringSchema.nullable(),
        }),
      )
      .min(1)
      .max(50),
  })
  .superRefine((price, context) => {
    if (price.tiers.at(-1)?.upTo !== null) {
      context.addIssue({
        code: "custom",
        message: "the final graduated tier must be unbounded",
        path: ["tiers"],
      });
    }
    price.tiers.slice(0, -1).forEach((tier, index) => {
      if (tier.upTo === null) {
        context.addIssue({
          code: "custom",
          message: "only the final graduated tier may be unbounded",
          path: ["tiers", index, "upTo"],
        });
      }
    });
  });
export const priceModelSchema = z.discriminatedUnion("model", [
  flatPriceSchema,
  perUnitPriceSchema,
  includedOveragePriceSchema,
  graduatedPriceSchema,
]);

export const entitlementDefinitionSchema = z.strictObject({
  enabled: z.boolean().default(true),
  mode: entitlementModeSchema,
  quantity: nonNegativeDecimalStringSchema.default("0"),
});

export const createPlanComponentSchema = z
  .strictObject({
    billingInterval: billingIntervalSchema.default("month"),
    componentKey: catalogKeySchema,
    entitlement: entitlementDefinitionSchema.nullable().default(null),
    featureKey: featureKeySchema.nullable().default(null),
    price: priceModelSchema,
    rounding: roundingDefinitionSchema.default({
      minorUnitScale: 2,
      mode: "half_away_from_zero",
    }),
  })
  .superRefine((component, context) => {
    if (component.price.model !== "flat" && component.featureKey === null) {
      context.addIssue({
        code: "custom",
        message: "is required for usage-based pricing",
        path: ["featureKey"],
      });
    }
    if (component.entitlement !== null && component.featureKey === null) {
      context.addIssue({
        code: "custom",
        message: "is required when an entitlement is defined",
        path: ["featureKey"],
      });
    }
    if (component.entitlement?.mode === "boolean" && component.entitlement.quantity !== "0") {
      context.addIssue({
        code: "custom",
        message: "must be zero for boolean entitlements",
        path: ["entitlement", "quantity"],
      });
    }
  });

export const createPlanRequestSchema = z.strictObject({
  key: catalogKeySchema,
  name: z.string().trim().min(1).max(200),
});
export const createPlanVersionRequestSchema = z
  .strictObject({
    components: z.array(createPlanComponentSchema).min(1).max(100),
    currency: currencySchema,
    effectiveFrom: z.iso.datetime({ offset: true }),
  })
  .refine(
    (value) =>
      new Set(value.components.map((component) => component.componentKey)).size ===
      value.components.length,
    { message: "component keys must be unique", path: ["components"] },
  )
  .refine(
    (value) => {
      const entitlementFeatureKeys = value.components.flatMap((component) =>
        component.entitlement && component.featureKey ? [component.featureKey] : [],
      );
      return new Set(entitlementFeatureKeys).size === entitlementFeatureKeys.length;
    },
    {
      message: "a plan version may define at most one entitlement for each feature",
      path: ["components"],
    },
  );

export const duplicatePlanVersionRequestSchema = z.strictObject({
  effectiveFrom: z.iso.datetime({ offset: true }),
  priceOverrides: z.record(catalogKeySchema, priceModelSchema).default({}),
});

export const planComponentSchema = z.strictObject({
  billingInterval: billingIntervalSchema,
  componentKey: catalogKeySchema,
  createdAt: z.iso.datetime({ offset: true }),
  entitlement: entitlementDefinitionSchema.nullable(),
  featureKey: featureKeySchema.nullable(),
  id: z.uuid(),
  price: priceModelSchema,
  rounding: roundingDefinitionSchema,
});
export const planVersionSchema = z.strictObject({
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
  components: z.array(planComponentSchema),
  createdAt: z.iso.datetime({ offset: true }),
  currency: currencySchema,
  effectiveFrom: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  status: z.enum(["draft", "published", "archived"]),
  version: z.number().int().min(1),
});
export const planSchema = z.strictObject({
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  key: catalogKeySchema,
  name: z.string().min(1).max(200),
  updatedAt: z.iso.datetime({ offset: true }),
  versions: z.array(planVersionSchema),
});

export const planParamSchema = z.strictObject({
  organizationId: organizationIdSchema,
  planKey: catalogKeySchema,
});
export const planVersionParamSchema = z.strictObject({
  organizationId: organizationIdSchema,
  planKey: catalogKeySchema,
  version: z.coerce.number().int().min(1),
});
export const planListResponseSchema = createCursorPageSchema(planSchema);
export const planMutationResponseSchema = z.strictObject({
  plan: planSchema,
  requestId: requestIdSchema,
});
export const planVersionMutationResponseSchema = z.strictObject({
  planVersion: planVersionSchema,
  requestId: requestIdSchema,
});

export const commercialSlotSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(CATALOG_KEY_PATTERN, "must be a lowercase dotted commercial slot");
export const createSubscriptionRequestSchema = z
  .strictObject({
    billingAnchor: z.iso.datetime({ offset: true }),
    commercialSlot: commercialSlotSchema.default("default"),
    customerKey: customerKeySchema,
    endsAt: z.iso.datetime({ offset: true }).nullable().default(null),
    planKey: catalogKeySchema,
    planVersion: z.number().int().min(1),
    startsAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((subscription, context) => {
    if (
      subscription.endsAt !== null &&
      Date.parse(subscription.endsAt) <= Date.parse(subscription.startsAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "must be later than startsAt",
        path: ["endsAt"],
      });
    }
    if (Date.parse(subscription.billingAnchor) > Date.parse(subscription.startsAt)) {
      context.addIssue({
        code: "custom",
        message: "must not be later than startsAt",
        path: ["billingAnchor"],
      });
    }
  });
export const cancelSubscriptionRequestSchema = z.strictObject({
  endsAt: z.iso.datetime({ offset: true }),
});
export const subscriptionSchema = z.strictObject({
  billingAnchor: z.iso.datetime({ offset: true }),
  canceledAt: z.iso.datetime({ offset: true }).nullable(),
  commercialSlot: commercialSlotSchema,
  createdAt: z.iso.datetime({ offset: true }),
  customerKey: customerKeySchema,
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  id: z.uuid(),
  planKey: catalogKeySchema,
  planVersion: z.number().int().min(1),
  planVersionId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  status: z.enum(["active", "canceled"]),
  updatedAt: z.iso.datetime({ offset: true }),
});
export const subscriptionParamSchema = z.strictObject({
  organizationId: organizationIdSchema,
  subscriptionId: z.uuid(),
});
export const subscriptionMutationResponseSchema = z.strictObject({
  requestId: requestIdSchema,
  subscription: subscriptionSchema,
});
export const subscriptionListResponseSchema = createCursorPageSchema(subscriptionSchema);

export type CancelSubscriptionRequest = z.output<typeof cancelSubscriptionRequestSchema>;
export type CreatePlanComponent = z.output<typeof createPlanComponentSchema>;
export type CreatePlanRequest = z.output<typeof createPlanRequestSchema>;
export type CreatePlanVersionRequest = z.output<typeof createPlanVersionRequestSchema>;
export type CreateSubscriptionRequest = z.output<typeof createSubscriptionRequestSchema>;
export type DuplicatePlanVersionRequest = z.output<typeof duplicatePlanVersionRequestSchema>;
export type Plan = z.infer<typeof planSchema>;
export type PlanComponent = z.infer<typeof planComponentSchema>;
export type PlanVersion = z.infer<typeof planVersionSchema>;
export type PriceModel = z.infer<typeof priceModelSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;
