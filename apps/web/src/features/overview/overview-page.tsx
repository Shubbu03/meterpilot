import {
  EmptyState,
  Notice,
  Panel,
  PanelContent,
  PanelHeader,
  PanelTitle,
  StatusBadge,
} from "@meterpilot/ui";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  PulseIcon,
  ReceiptIcon,
  UsersThreeIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { eventKeys, listEvents } from "../events/api";
import { formatEventTime, processingTone } from "../events/event-format";
import { useActiveOrganization } from "../organizations/organization-context";
import { listUsageCustomers, usageKeys } from "../usage/api";
import { getLatestPreview, overviewKeys } from "./api";

function countLabel(count: number, hasMore: boolean) {
  return `${count}${hasMore ? "+" : ""}`;
}

export function OverviewPage() {
  const organization = useActiveOrganization();
  const organizationId = organization.active.organization.id;
  const eventQueryInput = { limit: 100 } as const;
  const eventsQuery = useQuery({
    queryFn: () => listEvents(organizationId, eventQueryInput),
    queryKey: eventKeys.list(organizationId, eventQueryInput),
  });
  const customersQuery = useQuery({
    queryFn: () => listUsageCustomers(organizationId),
    queryKey: usageKeys.customers(organizationId),
  });
  const previewQuery = useQuery({
    queryFn: () => getLatestPreview(organizationId),
    queryKey: overviewKeys.preview(organizationId),
  });
  const recentEvents = eventsQuery.data?.items ?? [];
  const unresolvedEvents = recentEvents.filter((event) => event.processingState !== "processed");
  const activeCustomers =
    customersQuery.data?.items.filter((customer) => !customer.archivedAt) ?? [];
  const latestPreview = previewQuery.data?.items[0];
  const isPending = eventsQuery.isPending || customersQuery.isPending || previewQuery.isPending;
  const hasError = eventsQuery.error || customersQuery.error || previewQuery.error;

  return (
    <div className="page-frame">
      <header className="border-mp-border border-b pb-6 sm:pb-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="section-kicker">Overview / Live organization</p>
            <h1 className="mt-3 max-w-4xl font-mp-display text-[clamp(2.75rem,7vw,5.75rem)] leading-[0.9] font-semibold tracking-[-0.045em]">
              Know what was used.
              <br />
              Know what will be charged.
            </h1>
          </div>
          <StatusBadge tone="success">Connected</StatusBadge>
        </div>
        <p className="mt-6 max-w-2xl text-sm leading-7 text-mp-ink-muted">
          Live operational evidence for {organization.active.organization.name}. Counts are
          explicitly bounded when the collection has more than 100 records.
        </p>
      </header>

      {isPending ? (
        <p className="mt-8 font-mp-display text-2xl font-semibold">Reading organization state…</p>
      ) : null}
      {hasError ? (
        <Notice className="mt-6" title="Overview partially unavailable" tone="warning">
          <p>
            One or more live summaries could not be loaded. Open the relevant workspace for a scoped
            retry.
          </p>
        </Notice>
      ) : null}

      <section
        aria-label="Organization summary"
        className="mt-6 grid border-mp-border border-t border-l sm:grid-cols-2 xl:grid-cols-4"
      >
        <article className="border-mp-border border-r border-b bg-mp-panel p-5">
          <PulseIcon aria-hidden="true" className="text-mp-signal-strong" size={24} />
          <p className="mt-8 font-mp-display text-5xl font-semibold">
            {eventsQuery.data
              ? countLabel(recentEvents.length, Boolean(eventsQuery.data.nextCursor))
              : "—"}
          </p>
          <p className="mt-2 text-sm font-semibold">Recent accepted facts</p>
          <p className="mt-1 text-xs text-mp-ink-muted">Newest ledger window, up to 100</p>
        </article>
        <article className="border-mp-border border-r border-b bg-mp-panel p-5">
          <WarningOctagonIcon
            aria-hidden="true"
            className={unresolvedEvents.length > 0 ? "text-mp-warning" : "text-mp-success"}
            size={24}
          />
          <p className="mt-8 font-mp-display text-5xl font-semibold">
            {eventsQuery.data ? unresolvedEvents.length : "—"}
          </p>
          <p className="mt-2 text-sm font-semibold">Unresolved in window</p>
          <p className="mt-1 text-xs text-mp-ink-muted">Pending, processing, or failed</p>
        </article>
        <article className="border-mp-border border-r border-b bg-mp-panel p-5">
          <UsersThreeIcon aria-hidden="true" className="text-mp-signal-strong" size={24} />
          <p className="mt-8 font-mp-display text-5xl font-semibold">
            {customersQuery.data
              ? countLabel(activeCustomers.length, Boolean(customersQuery.data.nextCursor))
              : "—"}
          </p>
          <p className="mt-2 text-sm font-semibold">Active customers</p>
          <p className="mt-1 text-xs text-mp-ink-muted">Current loaded collection</p>
        </article>
        <article className="border-mp-border border-r border-b bg-mp-ink p-5 text-mp-paper">
          <ReceiptIcon aria-hidden="true" className="text-mp-signal" size={24} />
          <p className="mt-8 break-all font-mp-display text-3xl font-semibold">
            {latestPreview?.status === "completed" && latestPreview.subtotalMinor !== null
              ? `${latestPreview.currency} ${latestPreview.subtotalMinor}`
              : "—"}
          </p>
          <p className="mt-2 text-sm font-semibold">Latest preview subtotal</p>
          <p className="mt-1 text-xs text-mp-border">Exact minor units · no currency assumption</p>
        </article>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(19rem,0.8fr)]">
        <Panel>
          <PanelHeader>
            <div className="flex items-center justify-between gap-4">
              <PanelTitle as="h2">Recent event evidence</PanelTitle>
              <Link
                className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline decoration-mp-signal-strong decoration-2 underline-offset-4"
                to="/events"
              >
                All events
                <ArrowRightIcon aria-hidden="true" size={16} />
              </Link>
            </div>
          </PanelHeader>
          <PanelContent>
            {recentEvents.length === 0 && eventsQuery.data ? (
              <EmptyState
                description={
                  <p>
                    Ingest the first usage event with an API key carrying <code>events:write</code>.
                  </p>
                }
                title="No accepted events yet"
              />
            ) : null}
            <ol className="divide-y divide-mp-border">
              {recentEvents.slice(0, 6).map((event) => (
                <li
                  className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  key={event.id}
                >
                  <div className="min-w-0">
                    <Link
                      className="block truncate font-mp-mono text-xs font-semibold underline decoration-mp-signal-strong decoration-2 underline-offset-4"
                      to={`/events/${encodeURIComponent(event.id)}`}
                    >
                      {event.id}
                    </Link>
                    <p className="mt-1 truncate text-sm text-mp-ink-muted">
                      {event.type} · {event.customerKey}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge tone={processingTone(event.processingState)}>
                      {event.processingState}
                    </StatusBadge>
                    <time
                      className="hidden font-mp-mono text-xs text-mp-ink-muted sm:block"
                      dateTime={event.occurredAt}
                    >
                      {formatEventTime(event.occurredAt)}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          </PanelContent>
        </Panel>

        <div className="space-y-6">
          <Panel>
            <PanelHeader>
              <PanelTitle as="h2">Latest pricing preview</PanelTitle>
            </PanelHeader>
            <PanelContent>
              {latestPreview ? (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusBadge
                      tone={
                        latestPreview.status === "completed"
                          ? "success"
                          : latestPreview.status === "failed"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {latestPreview.status}
                    </StatusBadge>
                    <span className="font-mp-mono text-xs text-mp-ink-muted">
                      Revision {latestPreview.revision}
                    </span>
                  </div>
                  <p className="mt-5 text-sm leading-6 text-mp-ink-muted">
                    Customer <strong className="text-mp-ink">{latestPreview.customerKey}</strong>
                    <br />
                    Period ending {formatEventTime(latestPreview.periodEnd)}
                  </p>
                  <Link
                    className="mt-5 inline-flex min-h-11 items-center gap-2 font-semibold text-sm underline decoration-mp-signal-strong decoration-2 underline-offset-4"
                    to={`/previews/${latestPreview.id}`}
                  >
                    Inspect calculation
                    <ArrowRightIcon aria-hidden="true" size={16} />
                  </Link>
                </>
              ) : previewQuery.data ? (
                <p className="text-sm leading-6 text-mp-ink-muted">
                  No invoice preview has been generated for this organization.
                </p>
              ) : null}
            </PanelContent>
          </Panel>
          <div className="flex items-start gap-3 border border-mp-border bg-mp-panel p-5">
            <CheckCircleIcon
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-mp-success"
              size={22}
              weight="fill"
            />
            <div>
              <p className="font-semibold">Evidence, not estimates</p>
              <p className="mt-1 text-sm leading-6 text-mp-ink-muted">
                Overview values come from validated organization-scoped API responses. Duplicate and
                rejected ingestion attempts are not fabricated because the current ledger does not
                persist them.
              </p>
            </div>
          </div>
          {unresolvedEvents.length > 0 ? (
            <div className="flex items-start gap-3 border border-mp-warning bg-mp-warning-soft p-5">
              <ClockIcon aria-hidden="true" className="mt-0.5 shrink-0 text-mp-warning" size={22} />
              <div>
                <p className="font-semibold">Processing needs attention</p>
                <p className="mt-1 text-sm leading-6">
                  Open the event explorer to isolate pending or failed records.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
