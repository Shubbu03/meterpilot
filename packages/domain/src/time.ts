import { DomainInvariantError } from "./errors";

declare const instantBrand: unique symbol;

export type Instant = string & { readonly [instantBrand]: "Instant" };

export type HalfOpenInterval = Readonly<{
  end: Instant;
  start: Instant;
}>;

export function instant(value: string | Date): Instant {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new DomainInvariantError("invalid_instant", "Instant must be a valid timestamp.");
  }

  return date.toISOString() as Instant;
}

export function halfOpenInterval(start: Instant, end: Instant): HalfOpenInterval {
  if (Date.parse(start) >= Date.parse(end)) {
    throw new DomainInvariantError(
      "invalid_interval",
      "A half-open interval requires start to be before end.",
    );
  }

  return Object.freeze({ end, start });
}

export function intervalContains(interval: HalfOpenInterval, value: Instant): boolean {
  const timestamp = Date.parse(value);
  return timestamp >= Date.parse(interval.start) && timestamp < Date.parse(interval.end);
}

export function intervalsOverlap(left: HalfOpenInterval, right: HalfOpenInterval): boolean {
  return (
    Date.parse(left.start) < Date.parse(right.end) && Date.parse(right.start) < Date.parse(left.end)
  );
}
