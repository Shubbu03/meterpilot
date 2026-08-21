import { Notice, Panel, PanelContent, PanelHeader, PanelTitle, StatusBadge } from "@meterpilot/ui";
import { ArchiveBoxIcon, ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { useActiveOrganization } from "../organizations/organization-context";
import { eventKeys, getEvent } from "./api";
import { formatEventTime, processingTone } from "./event-format";

export function EventDetailPage() {
  const organization = useActiveOrganization();
  const { eventKey = "" } = useParams();
  const eventQuery = useQuery({
    enabled: eventKey.length > 0,
    queryFn: () => getEvent(organization.active.organization.id, eventKey),
    queryKey: eventKeys.detail(organization.active.organization.id, eventKey),
  });

  if (eventQuery.isPending) {
    return (
      <div className="page-frame">
        <p className="font-mp-display text-2xl font-semibold">Loading event evidence…</p>
      </div>
    );
  }

  if (eventQuery.error) {
    return (
      <div className="page-frame">
        <Notice title="Event unavailable" tone="danger">
          <p>The event could not be loaded. It may not exist in this organization.</p>
        </Notice>
        <Link
          className="mt-5 inline-flex min-h-11 items-center gap-2 font-semibold underline decoration-mp-signal-strong decoration-2 underline-offset-4"
          to="/events"
        >
          <ArrowLeftIcon aria-hidden="true" size={17} />
          Back to events
        </Link>
      </div>
    );
  }

  const event = eventQuery.data.event;

  return (
    <div className="page-frame">
      <Link
        className="inline-flex min-h-11 items-center gap-2 font-semibold text-sm underline decoration-mp-signal-strong decoration-2 underline-offset-4"
        to="/events"
      >
        <ArrowLeftIcon aria-hidden="true" size={17} />
        Event explorer
      </Link>
      <header className="mt-5 border-mp-border border-b pb-7">
        <div className="flex flex-wrap items-center gap-3">
          <p className="section-kicker">Event evidence</p>
          <StatusBadge tone={processingTone(event.processingState)}>
            {event.processingState}
          </StatusBadge>
        </div>
        <h1 className="mt-4 break-all font-mp-display text-[clamp(2.5rem,7vw,5rem)] leading-none font-semibold tracking-[-0.04em]">
          {event.id}
        </h1>
        <p className="mt-4 font-mp-mono text-sm text-mp-ink-muted">
          Request ID · {eventQuery.data.requestId}
        </p>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <Panel>
          <PanelHeader>
            <PanelTitle as="h2">Canonical usage fact</PanelTitle>
          </PanelHeader>
          <PanelContent>
            <dl className="grid gap-px overflow-hidden border border-mp-border bg-mp-border sm:grid-cols-2">
              {[
                ["Type", event.type],
                ["Subject", event.subject],
                ["Occurred", formatEventTime(event.occurredAt)],
                ["Received", formatEventTime(event.receivedAt)],
              ].map(([label, value]) => (
                <div className="bg-mp-panel p-4" key={label}>
                  <dt className="section-kicker">{label}</dt>
                  <dd className="mt-2 break-all text-sm font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            <h3 className="mt-6 font-mp-display text-xl font-semibold">Properties</h3>
            <pre className="mt-3 max-h-[32rem] overflow-auto border border-mp-border bg-mp-ink p-4 font-mp-mono text-xs leading-6 text-mp-paper">
              <code>{JSON.stringify(event.properties, null, 2)}</code>
            </pre>
          </PanelContent>
        </Panel>

        <div className="space-y-6">
          <Panel>
            <PanelHeader>
              <PanelTitle as="h2">Correction chain</PanelTitle>
            </PanelHeader>
            <PanelContent>
              {!event.correctionOf && !event.correctedBy ? (
                <p className="text-sm leading-6 text-mp-ink-muted">
                  This event is the current immutable fact and has no correction links.
                </p>
              ) : null}
              {event.correctionOf ? (
                <Link
                  className="flex min-h-11 items-center justify-between gap-3 border border-mp-border p-3 text-sm font-semibold hover:bg-mp-paper"
                  to={`/events/${encodeURIComponent(event.correctionOf.eventId)}`}
                >
                  <span>
                    Corrects · {event.correctionOf.kind}
                    <br />
                    <span className="font-mp-mono text-xs font-normal">
                      {event.correctionOf.eventId}
                    </span>
                  </span>
                  <ArrowRightIcon aria-hidden="true" size={17} />
                </Link>
              ) : null}
              {event.correctedBy ? (
                <Link
                  className="mt-3 flex min-h-11 items-center justify-between gap-3 border border-mp-border p-3 text-sm font-semibold hover:bg-mp-paper"
                  to={`/events/${encodeURIComponent(event.correctedBy.eventId)}`}
                >
                  <span>
                    Corrected by · {event.correctedBy.kind}
                    <br />
                    <span className="font-mp-mono text-xs font-normal">
                      {event.correctedBy.eventId}
                    </span>
                  </span>
                  <ArrowRightIcon aria-hidden="true" size={17} />
                </Link>
              ) : null}
            </PanelContent>
          </Panel>
          {event.propertiesRedactedAt ? (
            <Notice title="Properties redacted" tone="warning">
              <p>
                Source properties were removed on {formatEventTime(event.propertiesRedactedAt)}{" "}
                under the retention policy.
              </p>
            </Notice>
          ) : (
            <div className="flex items-center gap-3 border border-mp-border bg-mp-panel p-4 text-sm text-mp-ink-muted">
              <ArchiveBoxIcon aria-hidden="true" size={22} />
              <span>Source properties are still retained.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
