import Decimal from "decimal.js";

import { PricingInvariantError } from "./errors";
import type { DecimalString, MinorUnitString, RoundingPolicy } from "./types";

const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const MAX_DECIMAL_LENGTH = 128;

export const ExactDecimal = Decimal.clone({
  precision: 256,
  rounding: Decimal.ROUND_HALF_UP,
});

export function parseDecimal(
  value: DecimalString,
  field: string,
  options: Readonly<{ allowNegative?: boolean }> = {},
): Decimal {
  if (value.length === 0 || value.length > MAX_DECIMAL_LENGTH || !DECIMAL_PATTERN.test(value)) {
    throw new PricingInvariantError("invalid_decimal", `${field} must be a plain decimal string.`);
  }

  const decimal = new ExactDecimal(value);

  if (!options.allowNegative && decimal.isNegative()) {
    throw new PricingInvariantError("invalid_decimal", `${field} must not be negative.`);
  }

  return decimal;
}

export function decimalString(value: Decimal): DecimalString {
  return value.toFixed();
}

export function roundDecimalAmount(
  value: DecimalString,
  policy: RoundingPolicy,
): Readonly<{ amountMinor: MinorUnitString; roundedAmount: DecimalString }> {
  if (
    policy.mode !== "half_away_from_zero" ||
    !Number.isInteger(policy.minorUnitScale) ||
    policy.minorUnitScale < 0 ||
    policy.minorUnitScale > 6
  ) {
    throw new PricingInvariantError(
      "invalid_rounding",
      "Rounding requires half-away-from-zero and a minor-unit scale from 0 to 6.",
    );
  }

  const amount = parseDecimal(value, "amount", { allowNegative: true });
  const rounded = amount.toDecimalPlaces(policy.minorUnitScale, Decimal.ROUND_HALF_UP);
  const minorUnitFactor = new ExactDecimal(10).pow(policy.minorUnitScale);

  return Object.freeze({
    amountMinor: rounded.times(minorUnitFactor).toFixed(0),
    roundedAmount: rounded.toFixed(policy.minorUnitScale),
  });
}
