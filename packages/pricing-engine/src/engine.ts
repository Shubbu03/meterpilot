import { createHash } from "node:crypto";

import type { HalfOpenInterval } from "@meterpilot/domain";
import Decimal from "decimal.js";

import { decimalString, ExactDecimal, parseDecimal, roundDecimalAmount } from "./decimal";
import { PricingInvariantError } from "./errors";
import type {
  GraduatedPrice,
  GraduatedPricingTrace,
  IncludedOveragePricingTrace,
  PriceModel,
  PricingComponent,
  PricingLine,
  PricingRequest,
  PricingResult,
  PricingTrace,
} from "./types";

export const PRICING_ENGINE_VERSION = "1";

type CalculatedModel = Readonly<{
  preRoundAmount: Decimal;
  trace: PricingTrace;
}>;

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validatePeriod(period: HalfOpenInterval): void {
  const start = Date.parse(period.start);
  const end = Date.parse(period.end);

  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new PricingInvariantError("invalid_period", "Pricing requires a valid half-open period.");
  }
}

function validateRequest(request: PricingRequest): void {
  validatePeriod(request.period);

  if (!/^[A-Z]{3}$/.test(request.currency)) {
    throw new PricingInvariantError(
      "invalid_currency",
      "Currency must be a three-letter uppercase code.",
    );
  }

  if (request.components.length === 0) {
    throw new PricingInvariantError("invalid_price", "Pricing requires at least one component.");
  }

  const componentKeys = new Set<string>();

  for (const component of request.components) {
    if (component.componentKey.trim().length === 0 || component.componentKey.length > 128) {
      throw new PricingInvariantError(
        "invalid_price",
        "Component keys must be between 1 and 128 characters.",
      );
    }

    if (componentKeys.has(component.componentKey)) {
      throw new PricingInvariantError(
        "duplicate_component",
        `Pricing component ${component.componentKey} appears more than once.`,
      );
    }

    componentKeys.add(component.componentKey);
  }
}

function calculateFlat(price: Extract<PriceModel, { model: "flat" }>): CalculatedModel {
  const amount = parseDecimal(price.amount, "flat amount");

  return {
    preRoundAmount: amount,
    trace: Object.freeze({ amount: decimalString(amount), model: "flat" }),
  };
}

function calculatePerUnit(
  price: Extract<PriceModel, { model: "per_unit" }>,
  quantity: Decimal,
): CalculatedModel {
  const unitRate = parseDecimal(price.unitRate, "unit rate");
  const amount = quantity.times(unitRate);

  return {
    preRoundAmount: amount,
    trace: Object.freeze({
      amount: decimalString(amount),
      model: "per_unit",
      quantity: decimalString(quantity),
      unitRate: decimalString(unitRate),
    }),
  };
}

function calculateIncludedOverage(
  price: Extract<PriceModel, { model: "included_overage" }>,
  quantity: Decimal,
): CalculatedModel {
  const includedQuantity = parseDecimal(price.includedQuantity, "included quantity");
  const overageRate = parseDecimal(price.overageRate, "overage rate");
  const overageQuantity = Decimal.max(quantity.minus(includedQuantity), 0);
  const amount = overageQuantity.times(overageRate);
  const trace: IncludedOveragePricingTrace = Object.freeze({
    amount: decimalString(amount),
    includedQuantity: decimalString(includedQuantity),
    model: "included_overage",
    overageQuantity: decimalString(overageQuantity),
    overageRate: decimalString(overageRate),
  });

  return { preRoundAmount: amount, trace };
}

function validateGraduatedTiers(price: GraduatedPrice): void {
  if (price.tiers.length === 0 || price.tiers.at(-1)?.upTo !== null) {
    throw new PricingInvariantError(
      "invalid_price",
      "Graduated pricing requires at least one tier and an unbounded final tier.",
    );
  }

  let previousUpperBound = new ExactDecimal(0);

  price.tiers.forEach((tier, index) => {
    parseDecimal(tier.unitRate, `tier ${index + 1} unit rate`);

    if (tier.upTo === null) {
      if (index !== price.tiers.length - 1) {
        throw new PricingInvariantError("invalid_price", "Only the final tier may be unbounded.");
      }
      return;
    }

    const upperBound = parseDecimal(tier.upTo, `tier ${index + 1} upper bound`);
    if (upperBound.lessThanOrEqualTo(previousUpperBound)) {
      throw new PricingInvariantError(
        "invalid_price",
        "Graduated tier upper bounds must increase strictly.",
      );
    }
    previousUpperBound = upperBound;
  });
}

function calculateGraduated(price: GraduatedPrice, quantity: Decimal): CalculatedModel {
  validateGraduatedTiers(price);

  let previousUpperBound = new ExactDecimal(0);
  let remaining = new ExactDecimal(quantity);
  let amount = new ExactDecimal(0);
  const tiers: GraduatedPricingTrace["tiers"][number][] = [];

  for (const [index, tier] of price.tiers.entries()) {
    const unitRate = parseDecimal(tier.unitRate, `tier ${index + 1} unit rate`);
    const upperBound =
      tier.upTo === null ? null : parseDecimal(tier.upTo, `tier ${index + 1} upper bound`);
    const capacity = upperBound === null ? remaining : upperBound.minus(previousUpperBound);
    const tierQuantity = Decimal.min(remaining, capacity);
    const tierAmount = tierQuantity.times(unitRate);

    tiers.push(
      Object.freeze({
        amount: decimalString(tierAmount),
        quantity: decimalString(tierQuantity),
        unitRate: decimalString(unitRate),
        upTo: upperBound === null ? null : decimalString(upperBound),
      }),
    );
    amount = amount.plus(tierAmount);
    remaining = remaining.minus(tierQuantity);

    if (upperBound !== null) {
      previousUpperBound = upperBound;
    }
  }

  return {
    preRoundAmount: amount,
    trace: Object.freeze({ model: "graduated", tiers: Object.freeze(tiers) }),
  };
}

function calculateModel(price: PriceModel, quantity: Decimal): CalculatedModel {
  switch (price.model) {
    case "flat":
      return calculateFlat(price);
    case "per_unit":
      return calculatePerUnit(price, quantity);
    case "included_overage":
      return calculateIncludedOverage(price, quantity);
    case "graduated":
      return calculateGraduated(price, quantity);
    default: {
      const exhaustive: never = price;
      throw new PricingInvariantError("invalid_price", `Unsupported price model: ${exhaustive}`);
    }
  }
}

function calculateLine(request: PricingRequest, component: PricingComponent): PricingLine {
  const quantity = parseDecimal(component.quantity, `${component.componentKey} quantity`);
  const calculation = calculateModel(component.price, quantity);
  const preRoundAmount = decimalString(calculation.preRoundAmount);
  const rounded = roundDecimalAmount(preRoundAmount, request.rounding);
  const lineWithoutHash = {
    amountMinor: rounded.amountMinor,
    componentKey: component.componentKey,
    currency: request.currency,
    ...(component.meterVersionId ? { meterVersionId: component.meterVersionId } : {}),
    period: {
      end: request.period.end,
      start: request.period.start,
    },
    planVersionId: request.planVersionId,
    preRoundAmount,
    quantity: decimalString(quantity),
    roundedAmount: rounded.roundedAmount,
    rounding: {
      minorUnitScale: request.rounding.minorUnitScale,
      mode: request.rounding.mode,
    },
    trace: calculation.trace,
  };

  return Object.freeze({
    ...lineWithoutHash,
    calculationHash: sha256(lineWithoutHash),
  });
}

export function price(request: PricingRequest): PricingResult {
  validateRequest(request);
  const lines = Object.freeze(
    request.components.map((component) => calculateLine(request, component)),
  );
  const subtotalMinor = lines
    .reduce((total, line) => total.plus(line.amountMinor), new ExactDecimal(0))
    .toFixed(0);
  const resultWithoutHash = {
    currency: request.currency,
    engineVersion: PRICING_ENGINE_VERSION,
    lines,
    subtotalMinor,
  };

  return Object.freeze({
    ...resultWithoutHash,
    calculationHash: sha256(resultWithoutHash),
  });
}
