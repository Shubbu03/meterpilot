import type { HalfOpenInterval, MeterVersionId, PlanVersionId } from "@meterpilot/domain";

export type DecimalString = string;
export type MinorUnitString = string;
export type RoundingMode = "half_away_from_zero";

export type RoundingPolicy = Readonly<{
  minorUnitScale: number;
  mode: RoundingMode;
}>;

export type FlatPrice = Readonly<{
  amount: DecimalString;
  model: "flat";
}>;

export type PerUnitPrice = Readonly<{
  model: "per_unit";
  unitRate: DecimalString;
}>;

export type IncludedOveragePrice = Readonly<{
  includedQuantity: DecimalString;
  model: "included_overage";
  overageRate: DecimalString;
}>;

export type GraduatedTier = Readonly<{
  unitRate: DecimalString;
  upTo: DecimalString | null;
}>;

export type GraduatedPrice = Readonly<{
  model: "graduated";
  tiers: readonly GraduatedTier[];
}>;

export type PriceModel = FlatPrice | PerUnitPrice | IncludedOveragePrice | GraduatedPrice;

export type PricingComponent = Readonly<{
  componentKey: string;
  meterVersionId?: MeterVersionId;
  price: PriceModel;
  quantity: DecimalString;
}>;

export type PricingRequest = Readonly<{
  components: readonly PricingComponent[];
  currency: string;
  period: HalfOpenInterval;
  planVersionId: PlanVersionId;
  rounding: RoundingPolicy;
}>;

export type FlatPricingTrace = Readonly<{
  amount: DecimalString;
  model: "flat";
}>;

export type PerUnitPricingTrace = Readonly<{
  amount: DecimalString;
  model: "per_unit";
  quantity: DecimalString;
  unitRate: DecimalString;
}>;

export type IncludedOveragePricingTrace = Readonly<{
  amount: DecimalString;
  includedQuantity: DecimalString;
  model: "included_overage";
  overageQuantity: DecimalString;
  overageRate: DecimalString;
}>;

export type GraduatedTierTrace = Readonly<{
  amount: DecimalString;
  quantity: DecimalString;
  unitRate: DecimalString;
  upTo: DecimalString | null;
}>;

export type GraduatedPricingTrace = Readonly<{
  model: "graduated";
  tiers: readonly GraduatedTierTrace[];
}>;

export type PricingTrace =
  | FlatPricingTrace
  | PerUnitPricingTrace
  | IncludedOveragePricingTrace
  | GraduatedPricingTrace;

export type PricingLine = Readonly<{
  amountMinor: MinorUnitString;
  calculationHash: string;
  componentKey: string;
  currency: string;
  meterVersionId?: MeterVersionId;
  period: HalfOpenInterval;
  planVersionId: PlanVersionId;
  preRoundAmount: DecimalString;
  quantity: DecimalString;
  roundedAmount: DecimalString;
  rounding: RoundingPolicy;
  trace: PricingTrace;
}>;

export type PricingResult = Readonly<{
  calculationHash: string;
  currency: string;
  engineVersion: string;
  lines: readonly PricingLine[];
  subtotalMinor: MinorUnitString;
}>;
