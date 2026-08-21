import { Notice, Panel, PanelContent, PanelHeader, PanelTitle, StatusBadge } from "@meterpilot/ui";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { useActiveOrganization } from "../organizations/organization-context";
import { getPreview, previewKeys } from "./api";

export function PreviewDetailPage() {
  const organization = useActiveOrganization();
  const { previewId = "" } = useParams();
  const query = useQuery({
    enabled: previewId.length > 0,
    queryFn: () => getPreview(organization.active.organization.id, previewId),
    queryKey: previewKeys.detail(organization.active.organization.id, previewId),
  });
  if (query.isPending)
    return (
      <div className="page-frame">
        <p className="font-mp-display text-2xl font-semibold">Loading calculation trace…</p>
      </div>
    );
  if (query.error)
    return (
      <div className="page-frame">
        <Notice title="Preview unavailable" tone="danger">
          <p>The pricing preview could not be loaded.</p>
        </Notice>
      </div>
    );
  const preview = query.data.preview;
  return (
    <div className="page-frame">
      <Link
        className="inline-flex min-h-11 items-center gap-2 font-semibold underline decoration-mp-signal-strong decoration-2 underline-offset-4"
        to="/previews"
      >
        <ArrowLeftIcon aria-hidden="true" size={17} />
        Invoice previews
      </Link>
      <header className="mt-5 border-mp-border border-b pb-7">
        <div className="flex flex-wrap gap-3">
          <p className="section-kicker">Calculation evidence / Revision {preview.revision}</p>
          <StatusBadge
            tone={
              preview.status === "completed"
                ? "success"
                : preview.status === "failed"
                  ? "danger"
                  : "warning"
            }
          >
            {preview.status}
          </StatusBadge>
        </div>
        <h1 className="mt-4 break-all font-mp-display text-[clamp(2.25rem,6vw,4.5rem)] font-semibold">
          {preview.id}
        </h1>
        <p className="mt-3 text-sm text-mp-ink-muted">
          {preview.currency} {preview.subtotalMinor ?? "—"} exact minor units ·{" "}
          {preview.lines.length} line{preview.lines.length === 1 ? "" : "s"}
        </p>
      </header>
      {preview.failureCode ? (
        <Notice className="mt-6" title="Preview failed" tone="danger">
          <p>Failure code: {preview.failureCode}</p>
        </Notice>
      ) : null}
      <div className="mt-6 space-y-5">
        {preview.lines.map((line) => (
          <Panel key={line.id}>
            <PanelHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <PanelTitle as="h2">{line.componentKey}</PanelTitle>
                <span className="font-mp-mono text-sm font-semibold">
                  {line.amountMinor} minor units
                </span>
              </div>
            </PanelHeader>
            <PanelContent>
              <dl className="grid gap-4 sm:grid-cols-3">
                <div>
                  <dt className="section-kicker">Quantity</dt>
                  <dd className="mt-1 font-semibold">{line.quantity}</dd>
                </div>
                <div>
                  <dt className="section-kicker">Pre-round</dt>
                  <dd className="mt-1 font-semibold">{line.preRoundAmount}</dd>
                </div>
                <div>
                  <dt className="section-kicker">Rounded</dt>
                  <dd className="mt-1 font-semibold">{line.roundedAmount}</dd>
                </div>
              </dl>
              <details className="mt-5 border border-mp-border">
                <summary className="cursor-pointer p-3 font-semibold">Expand pricing trace</summary>
                <pre className="max-h-[28rem] overflow-auto border-mp-border border-t bg-mp-ink p-4 font-mp-mono text-xs leading-6 text-mp-paper">
                  <code>
                    {JSON.stringify(
                      { pricingTrace: line.pricingTrace, sourceBuckets: line.sourceBuckets },
                      null,
                      2,
                    )}
                  </code>
                </pre>
              </details>
              <p className="mt-4 break-all font-mp-mono text-[0.625rem] text-mp-ink-muted">
                Calculation hash · {line.calculationHash}
              </p>
            </PanelContent>
          </Panel>
        ))}
      </div>
    </div>
  );
}
