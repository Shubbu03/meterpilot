import { type UsageTimeseriesPoint, usageQuerySchema } from "@meterpilot/contracts/usage";
import {
  Button,
  EmptyState,
  FreshnessStamp,
  Notice,
  Panel,
  PanelContent,
  PanelHeader,
  PanelTitle,
} from "@meterpilot/ui";
import { ChartLineIcon, ClockIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { ApiError } from "../../lib/api/client";
import { useActiveOrganization } from "../organizations/organization-context";
import {
  getUsageTimeseries,
  getUsageTotal,
  listUsageCustomers,
  listUsageMeters,
  usageKeys,
} from "./api";

function utcHour(value: Date) {
  value.setUTCMinutes(0, 0, 0);
  return value.toISOString();
}

function defaultRange() {
  const to = new Date();
  to.setUTCHours(to.getUTCHours() + 1);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 7);
  return { from: utcHour(from), to: utcHour(to) };
}

function dateInputValue(value: string) {
  return value.slice(0, 10);
}

function parseUsageSearch(searchParams: URLSearchParams) {
  const candidate = {
    customerKey: searchParams.get("customerKey") ?? "",
    from: searchParams.get("from") ?? "",
    meterKey: searchParams.get("meterKey") ?? "",
    to: searchParams.get("to") ?? "",
  };
  const parsed = usageQuerySchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function pointWidth(point: UsageTimeseriesPoint, maximum: number) {
  const quantity = Number(point.quantity);
  if (!Number.isFinite(quantity) || maximum <= 0) return 0;
  return Math.max(2, (Math.abs(quantity) / maximum) * 100);
}

export function UsagePage() {
  const organization = useActiveOrganization();
  const organizationId = organization.active.organization.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const [scopeError, setScopeError] = useState<string>();
  const selectedQuery = parseUsageSearch(searchParams);
  const range = useMemo(defaultRange, []);
  const customersQuery = useQuery({
    queryFn: () => listUsageCustomers(organizationId),
    queryKey: usageKeys.customers(organizationId),
  });
  const metersQuery = useQuery({
    queryFn: () => listUsageMeters(organizationId),
    queryKey: usageKeys.meters(organizationId),
  });
  const totalQuery = useQuery({
    enabled: selectedQuery !== null,
    queryFn: () => {
      if (!selectedQuery) throw new Error("A usage query is required.");
      return getUsageTotal(organizationId, selectedQuery);
    },
    queryKey: usageKeys.total(organizationId, selectedQuery),
  });
  const timeseriesQuery = useQuery({
    enabled: selectedQuery !== null,
    queryFn: () => {
      if (!selectedQuery) throw new Error("A usage query is required.");
      return getUsageTimeseries(organizationId, selectedQuery);
    },
    queryKey: usageKeys.timeseries(organizationId, selectedQuery),
  });
  const maximum = Math.max(
    0,
    ...(timeseriesQuery.data?.points.map((point) => Math.abs(Number(point.quantity)) || 0) ?? []),
  );

  function inspectUsage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setScopeError(undefined);
    const formData = new FormData(event.currentTarget);
    const from = formData.get("from");
    const to = formData.get("to");
    const customerKey = formData.get("customerKey");
    const meterKey = formData.get("meterKey");

    if (
      typeof from !== "string" ||
      typeof to !== "string" ||
      typeof customerKey !== "string" ||
      typeof meterKey !== "string"
    )
      return;

    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T00:00:00.000Z`);

    if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) {
      setScopeError("Enter a valid start and end time.");
      return;
    }

    const parsed = usageQuerySchema.safeParse({
      customerKey,
      from: fromDate.toISOString(),
      meterKey,
      to: toDate.toISOString(),
    });

    if (parsed.success) {
      setSearchParams(parsed.data, { replace: true });
    } else {
      setScopeError("Choose a UTC-hour-aligned range where the end is after the start.");
    }
  }

  const scopeMissing =
    totalQuery.error instanceof ApiError && totalQuery.error.code === "not_found";
  const loadError = customersQuery.error ?? metersQuery.error;

  return (
    <div className="page-frame">
      <header className="border-mp-border border-b pb-6 sm:pb-8">
        <p className="section-kicker">Operations / Aggregated evidence</p>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-mp-display text-[clamp(2.75rem,7vw,5.5rem)] leading-[0.9] font-semibold tracking-[-0.045em]">
              Usage lens
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-mp-ink-muted">
              Inspect exact metered totals and hourly buckets for one customer, one meter, and one
              UTC-hour-aligned period.
            </p>
          </div>
          <ChartLineIcon aria-hidden="true" className="text-mp-signal-strong" size={36} />
        </div>
      </header>

      {loadError ? (
        <Notice className="mt-6" title="Usage controls unavailable" tone="danger">
          <p>Customers or meters could not be loaded. Retry before selecting a usage scope.</p>
        </Notice>
      ) : null}

      <section
        aria-labelledby="usage-scope-heading"
        className="mt-6 border border-mp-border bg-mp-panel p-4 sm:p-6"
      >
        <div className="flex items-center gap-2">
          <MagnifyingGlassIcon aria-hidden="true" size={19} />
          <h2 className="font-mp-display text-2xl font-semibold" id="usage-scope-heading">
            Select usage scope
          </h2>
        </div>
        <form className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5" onSubmit={inspectUsage}>
          <label
            className="grid content-start gap-1.5 text-sm font-semibold"
            htmlFor="usage-customer"
          >
            Customer
            <select
              className="min-h-11 border border-mp-border bg-mp-panel px-3 text-sm"
              defaultValue={selectedQuery?.customerKey ?? ""}
              id="usage-customer"
              name="customerKey"
              required
            >
              <option disabled value="">
                Select customer
              </option>
              {customersQuery.data?.items
                .filter((customer) => !customer.archivedAt)
                .map((customer) => (
                  <option key={customer.id} value={customer.externalKey}>
                    {customer.name} · {customer.externalKey}
                  </option>
                ))}
            </select>
          </label>
          <label className="grid content-start gap-1.5 text-sm font-semibold" htmlFor="usage-meter">
            Meter
            <select
              className="min-h-11 border border-mp-border bg-mp-panel px-3 text-sm"
              defaultValue={selectedQuery?.meterKey ?? ""}
              id="usage-meter"
              name="meterKey"
              required
            >
              <option disabled value="">
                Select meter
              </option>
              {metersQuery.data?.items
                .filter((meter) => meter.status === "active")
                .map((meter) => (
                  <option key={meter.id} value={meter.key}>
                    {meter.name} · {meter.key}
                  </option>
                ))}
            </select>
          </label>
          <label className="grid content-start gap-1.5 text-sm font-semibold" htmlFor="usage-from">
            From date
            <input
              className="min-h-11 border border-mp-border bg-mp-panel px-3 text-sm"
              defaultValue={dateInputValue(selectedQuery?.from ?? range.from)}
              id="usage-from"
              name="from"
              required
              type="date"
            />
          </label>
          <label className="grid content-start gap-1.5 text-sm font-semibold" htmlFor="usage-to">
            To date (exclusive)
            <input
              className="min-h-11 border border-mp-border bg-mp-panel px-3 text-sm"
              defaultValue={dateInputValue(selectedQuery?.to ?? range.to)}
              id="usage-to"
              name="to"
              required
              type="date"
            />
          </label>
          <div className="flex items-end">
            <Button className="w-full" type="submit">
              Inspect usage
            </Button>
          </div>
        </form>
        {scopeError ? (
          <p className="mt-3 text-sm font-semibold text-mp-danger" role="alert">
            {scopeError}
          </p>
        ) : null}
      </section>

      {!selectedQuery ? (
        <EmptyState
          className="mt-6 border border-mp-border bg-mp-panel"
          description={
            <p>
              Choose an active customer and published meter. Meter configuration lives in{" "}
              <Link
                className="font-semibold underline decoration-mp-signal-strong decoration-2 underline-offset-4"
                to="/meters"
              >
                Meters
              </Link>
              .
            </p>
          }
          eyebrow="Awaiting scope"
          title="No usage query has been run"
        />
      ) : null}

      {selectedQuery && (totalQuery.isPending || timeseriesQuery.isPending) ? (
        <p className="mt-8 font-mp-display text-2xl font-semibold">Reading aggregate buckets…</p>
      ) : null}

      {scopeMissing ? (
        <EmptyState
          className="mt-6 border border-mp-border bg-mp-panel"
          description={
            <p>
              The selected customer and meter have no matching usage scope. Confirm both resources
              exist and that processed events match the meter version.
            </p>
          }
          eyebrow="No aggregate"
          title="Usage was not found"
        />
      ) : null}

      {selectedQuery && !scopeMissing && (totalQuery.error || timeseriesQuery.error) ? (
        <Notice className="mt-6" title="Usage unavailable" tone="danger">
          <p>The aggregate query failed. Preserve this scope and retry.</p>
          <Button
            className="mt-4"
            onClick={() => {
              void totalQuery.refetch();
              void timeseriesQuery.refetch();
            }}
            size="compact"
            variant="secondary"
          >
            Try again
          </Button>
        </Notice>
      ) : null}

      {totalQuery.data && timeseriesQuery.data && !scopeMissing ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(17rem,0.7fr)_minmax(0,1.3fr)]">
          <Panel>
            <PanelHeader>
              <PanelTitle as="h2">Metered total</PanelTitle>
            </PanelHeader>
            <PanelContent>
              {totalQuery.data.usage.freshness ? (
                <>
                  <p className="break-all font-mp-display text-5xl font-semibold tracking-[-0.04em]">
                    {totalQuery.data.usage.quantity}
                  </p>
                  <p className="mt-2 font-mp-mono text-xs text-mp-ink-muted">
                    {totalQuery.data.usage.eventCount} source events
                  </p>
                  <FreshnessStamp
                    className="mt-6"
                    dateTime={totalQuery.data.usage.freshness.updatedAt}
                    label="Aggregated"
                  >
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(totalQuery.data.usage.freshness.updatedAt))}
                  </FreshnessStamp>
                  <p className="mt-2 flex items-center gap-2 text-xs text-mp-ink-muted">
                    <ClockIcon aria-hidden="true" size={15} />
                    {totalQuery.data.usage.freshness.lagSeconds}s aggregation lag
                  </p>
                </>
              ) : (
                <Notice title="Freshness unavailable" tone="warning">
                  <p>
                    The API returned no aggregate watermark, so MeterPilot is withholding the usage
                    total.
                  </p>
                </Notice>
              )}
            </PanelContent>
          </Panel>

          <Panel>
            <PanelHeader>
              <PanelTitle as="h2">Hourly buckets</PanelTitle>
            </PanelHeader>
            <PanelContent>
              {timeseriesQuery.data.points.length === 0 ? (
                <p className="text-sm text-mp-ink-muted">
                  No buckets were produced for this period.
                </p>
              ) : (
                <ol className="space-y-3">
                  {timeseriesQuery.data.points.map((point) => (
                    <li
                      className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_7rem] sm:items-center"
                      key={point.bucketStart}
                    >
                      <time
                        className="font-mp-mono text-xs text-mp-ink-muted"
                        dateTime={point.bucketStart}
                      >
                        {new Intl.DateTimeFormat(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                        }).format(new Date(point.bucketStart))}
                      </time>
                      <div
                        className="h-5 border border-mp-border bg-mp-paper"
                        title={`${point.quantity} units`}
                      >
                        <div
                          className="h-full bg-mp-signal-strong"
                          style={{ width: `${pointWidth(point, maximum)}%` }}
                        />
                      </div>
                      <span className="text-right font-mp-mono text-xs font-semibold">
                        {point.quantity}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </PanelContent>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
