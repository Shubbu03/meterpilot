import { usageEventListQuerySchema } from "@meterpilot/contracts/events";
import { Button, EmptyState, Notice, StatusBadge, TextField } from "@meterpilot/ui";
import { ArrowRightIcon, FunnelIcon, PulseIcon } from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { useActiveOrganization } from "../organizations/organization-context";
import { eventKeys, listEvents } from "./api";
import { formatEventTime, processingTone } from "./event-format";

function filtersFromSearch(searchParams: URLSearchParams) {
  const candidate = {
    customerKey: searchParams.get("customerKey") || undefined,
    limit: 25,
    processingState: searchParams.get("processingState") || undefined,
    subject: searchParams.get("subject") || undefined,
    type: searchParams.get("type") || undefined,
  };
  const parsed = usageEventListQuerySchema.safeParse(candidate);

  return parsed.success ? parsed.data : usageEventListQuerySchema.parse({ limit: 25 });
}

export function EventsPage() {
  const organization = useActiveOrganization();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const cursor = cursorHistory.at(-1);
  const filters = filtersFromSearch(searchParams);
  const query = { ...filters, ...(cursor ? { cursor } : {}) };
  const eventsQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => listEvents(organization.active.organization.id, query),
    queryKey: eventKeys.list(organization.active.organization.id, query),
  });

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextSearch = new URLSearchParams();

    for (const key of ["type", "customerKey", "subject", "processingState"] as const) {
      const value = formData.get(key);
      if (typeof value === "string" && value.trim()) {
        nextSearch.set(key, value.trim());
      }
    }

    setCursorHistory([]);
    setSearchParams(nextSearch, { replace: true });
  }

  function clearFilters() {
    setCursorHistory([]);
    setSearchParams({}, { replace: true });
  }

  return (
    <div className="page-frame">
      <header className="border-mp-border border-b pb-6 sm:pb-8">
        <p className="section-kicker">Operations / Immutable ledger</p>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-mp-display text-[clamp(2.75rem,7vw,5.5rem)] leading-[0.9] font-semibold tracking-[-0.045em]">
              Event explorer
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-mp-ink-muted">
              Trace accepted usage facts from occurrence through asynchronous processing and any
              correction chain.
            </p>
          </div>
          <PulseIcon aria-hidden="true" className="text-mp-signal-strong" size={36} />
        </div>
      </header>

      <section
        aria-labelledby="event-filters-heading"
        className="mt-6 border border-mp-border bg-mp-panel p-4 sm:p-5"
      >
        <div className="flex items-center gap-2">
          <FunnelIcon aria-hidden="true" size={18} />
          <h2 className="font-mp-display text-xl font-semibold" id="event-filters-heading">
            Narrow the ledger
          </h2>
        </div>
        <form className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5" onSubmit={applyFilters}>
          <TextField
            defaultValue={filters.type ?? ""}
            label="Event type"
            name="type"
            placeholder="llm.tokens"
          />
          <TextField
            defaultValue={filters.customerKey ?? ""}
            label="Customer key"
            name="customerKey"
            placeholder="customer_acme"
          />
          <TextField
            defaultValue={filters.subject ?? ""}
            label="Subject key"
            name="subject"
            placeholder="workspace_acme"
          />
          <label
            className="grid content-start gap-1.5 text-sm font-semibold"
            htmlFor="event-processing-state"
          >
            Processing state
            <select
              className="min-h-11 border border-mp-border bg-mp-panel px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mp-warning"
              defaultValue={filters.processingState ?? ""}
              id="event-processing-state"
              name="processingState"
            >
              <option value="">All states</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="processed">Processed</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <Button className="flex-1" size="compact" type="submit">
              Apply
            </Button>
            <Button onClick={clearFilters} size="compact" type="button" variant="ghost">
              Clear
            </Button>
          </div>
        </form>
      </section>

      {eventsQuery.isPending ? (
        <p className="mt-8 font-mp-display text-2xl font-semibold">Loading event ledger…</p>
      ) : null}

      {eventsQuery.error ? (
        <Notice className="mt-6" title="Events unavailable" tone="danger">
          <p>The event ledger could not be loaded. Retry without changing the current filters.</p>
          <Button
            className="mt-4"
            onClick={() => void eventsQuery.refetch()}
            size="compact"
            variant="secondary"
          >
            Try again
          </Button>
        </Notice>
      ) : null}

      {eventsQuery.data?.items.length === 0 ? (
        <EmptyState
          className="mt-6 border border-mp-border bg-mp-panel"
          description={
            <p>
              No accepted events match this organization and filter set. Ingest an event with an
              organization API key, or clear the filters.
            </p>
          }
          eyebrow="Ledger empty"
          title="No usage facts found"
        />
      ) : null}

      {eventsQuery.data && eventsQuery.data.items.length > 0 ? (
        <section
          aria-label="Event results"
          className="mt-6 overflow-hidden border border-mp-border bg-mp-panel"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[68rem] border-collapse text-left text-sm">
              <thead className="bg-mp-ink font-mp-mono text-[0.625rem] tracking-[0.14em] text-mp-border uppercase">
                <tr>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    Event
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    Type
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    Customer / subject
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    Occurred
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    State
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mp-border">
                {eventsQuery.data.items.map((item) => (
                  <tr className="align-top hover:bg-mp-paper/60" key={item.id}>
                    <td className="px-4 py-4 font-mp-mono text-xs font-semibold">{item.id}</td>
                    <td className="px-4 py-4 font-semibold">{item.type}</td>
                    <td className="px-4 py-4">
                      <span className="block font-semibold">{item.customerKey}</span>
                      <span className="mt-1 block font-mp-mono text-xs text-mp-ink-muted">
                        {item.subject}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <time dateTime={item.occurredAt}>{formatEventTime(item.occurredAt)}</time>
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge tone={processingTone(item.processingState)}>
                        {item.processingState}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <Link
                        aria-label={`Open event ${item.id}`}
                        className="inline-grid size-11 place-items-center border border-mp-border hover:bg-mp-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mp-warning"
                        to={`/events/${encodeURIComponent(item.id)}`}
                      >
                        <ArrowRightIcon aria-hidden="true" size={17} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-4 border-mp-border border-t p-4">
            <Button
              disabled={cursorHistory.length === 0}
              onClick={() => setCursorHistory((history) => history.slice(0, -1))}
              size="compact"
              variant="secondary"
            >
              Previous
            </Button>
            <span className="font-mp-mono text-xs text-mp-ink-muted">
              Page {cursorHistory.length + 1}
            </span>
            <Button
              disabled={!eventsQuery.data.nextCursor}
              onClick={() => {
                if (eventsQuery.data.nextCursor)
                  setCursorHistory((history) => [
                    ...history,
                    eventsQuery.data.nextCursor as string,
                  ]);
              }}
              size="compact"
              variant="secondary"
            >
              Next
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
