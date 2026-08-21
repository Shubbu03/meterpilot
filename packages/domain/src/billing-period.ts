import { Temporal } from "@js-temporal/polyfill";

export type BillingPeriod = Readonly<{
  end: Date;
  nextCycleStart: Date;
  start: Date;
}>;

export type BillingPeriodInput = Readonly<{
  at: Date;
  billingAnchor: Date;
  subscriptionEnd?: Date | null;
  subscriptionStart: Date;
  timeZone: string;
}>;

function validDate(value: Date, field: string): void {
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError(`${field} must be a valid date.`);
  }
}

function later(left: Temporal.Instant, right: Temporal.Instant): Temporal.Instant {
  return Temporal.Instant.compare(left, right) >= 0 ? left : right;
}

function earlier(left: Temporal.Instant, right: Temporal.Instant): Temporal.Instant {
  return Temporal.Instant.compare(left, right) <= 0 ? left : right;
}

/**
 * Resolves the half-open calendar-month period containing `at` in the customer's timezone.
 * The first and last subscription periods are clipped to the subscription boundaries.
 */
export function billingPeriodAt(input: BillingPeriodInput): BillingPeriod {
  validDate(input.at, "Billing period instant");
  validDate(input.billingAnchor, "Billing anchor");
  validDate(input.subscriptionStart, "Subscription start");
  if (input.subscriptionEnd) {
    validDate(input.subscriptionEnd, "Subscription end");
  }

  const at = Temporal.Instant.from(input.at.toISOString());
  const anchor = Temporal.Instant.from(input.billingAnchor.toISOString());
  const subscriptionStart = Temporal.Instant.from(input.subscriptionStart.toISOString());
  const subscriptionEnd = input.subscriptionEnd
    ? Temporal.Instant.from(input.subscriptionEnd.toISOString())
    : null;

  if (Temporal.Instant.compare(anchor, subscriptionStart) > 0) {
    throw new RangeError("Billing anchor must not be later than the subscription start.");
  }
  if (Temporal.Instant.compare(at, subscriptionStart) < 0) {
    throw new RangeError("Billing period instant must be within the subscription.");
  }
  if (subscriptionEnd && Temporal.Instant.compare(at, subscriptionEnd) >= 0) {
    throw new RangeError("Billing period instant must be before the subscription end.");
  }

  const anchorLocal = anchor.toZonedDateTimeISO(input.timeZone);
  const atLocal = at.toZonedDateTimeISO(input.timeZone);
  let monthOffset = (atLocal.year - anchorLocal.year) * 12 + (atLocal.month - anchorLocal.month);
  let cycleStart = anchorLocal.add({ months: monthOffset });

  if (Temporal.ZonedDateTime.compare(cycleStart, atLocal) > 0) {
    monthOffset--;
    cycleStart = anchorLocal.add({ months: monthOffset });
  }

  const nextCycleStart = anchorLocal.add({ months: monthOffset + 1 }).toInstant();
  const periodStart = later(cycleStart.toInstant(), subscriptionStart);
  const periodEnd = subscriptionEnd ? earlier(nextCycleStart, subscriptionEnd) : nextCycleStart;

  if (Temporal.Instant.compare(periodEnd, periodStart) <= 0) {
    throw new RangeError("Resolved billing period must have a positive duration.");
  }

  return Object.freeze({
    end: new Date(periodEnd.epochMilliseconds),
    nextCycleStart: new Date(nextCycleStart.epochMilliseconds),
    start: new Date(periodStart.epochMilliseconds),
  });
}
