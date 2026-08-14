export type PricingErrorCode =
  | "duplicate_component"
  | "invalid_currency"
  | "invalid_decimal"
  | "invalid_period"
  | "invalid_price"
  | "invalid_rounding";

export class PricingInvariantError extends Error {
  override readonly name = "PricingInvariantError";

  constructor(
    readonly code: PricingErrorCode,
    message: string,
  ) {
    super(message);
  }
}
