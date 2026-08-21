import {
  createReconciliationRunRequestSchema,
  createStripeInvoiceLineExportRequestSchema,
} from "@meterpilot/contracts/operations";
import {
  Button,
  EmptyState,
  Notice,
  Panel,
  PanelContent,
  PanelHeader,
  PanelTitle,
  StatusBadge,
  TextField,
} from "@meterpilot/ui";
import { ClockCounterClockwiseIcon, ExportIcon, ScalesIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { ApiError } from "../../lib/api/client";
import { queryClient } from "../../lib/query-client";
import { customerKeys, listCustomers } from "../customers/api";
import { listMeters, meterKeys } from "../meters/api";
import { useActiveOrganization } from "../organizations/organization-context";
import { listPreviews, previewKeys } from "../previews/api";
import {
  createExport,
  createReconciliation,
  listAudit,
  listExports,
  listReconciliations,
  operationKeys,
} from "./api";

const utc = (value: string) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
};
const tone = (status: "pending" | "completed" | "failed") =>
  status === "completed"
    ? ("success" as const)
    : status === "failed"
      ? ("danger" as const)
      : ("warning" as const);

export function ReconciliationPage() {
  const organization = useActiveOrganization();
  const id = organization.active.organization.id;
  const query = useQuery({
    queryFn: () => listReconciliations(id),
    queryKey: operationKeys.reconciliation(id),
  });
  const customers = useQuery({ queryFn: () => listCustomers(id), queryKey: customerKeys.list(id) });
  const meters = useQuery({ queryFn: () => listMeters(id), queryKey: meterKeys.list(id) });
  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof createReconciliation>[1]) =>
      createReconciliation(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: operationKeys.reconciliation(id) }),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = createReconciliationRunRequestSchema.safeParse({
      customerKey: data.get("customerKey"),
      meterKey: data.get("meterKey"),
      periodEnd: utc(String(data.get("periodEnd"))),
      periodStart: utc(String(data.get("periodStart"))),
      repair: data.get("repair") === "on",
    });
    if (parsed.success) mutation.mutate(parsed.data);
  }
  return (
    <div className="page-frame">
      <header className="border-mp-border border-b pb-7">
        <p className="section-kicker">Verification / Drift detection</p>
        <h1 className="mt-3 font-mp-display text-5xl font-semibold">Reconciliation</h1>
        <p className="mt-4 text-sm text-mp-ink-muted">
          Compare raw accepted evidence with derived aggregate state at an explicit watermark.
        </p>
      </header>
      {mutation.error ? (
        <Notice className="mt-6" title="Run not queued" tone="danger">
          <p>
            {mutation.error instanceof ApiError
              ? `${mutation.error.message} Request ID: ${mutation.error.requestId}`
              : "The request failed."}
          </p>
        </Notice>
      ) : null}
      <div className="mt-6 grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
        <Panel>
          <PanelHeader>
            <PanelTitle as="h2">Start reconciliation</PanelTitle>
          </PanelHeader>
          <PanelContent>
            <form className="grid gap-4" onSubmit={submit}>
              <label className="grid gap-1.5 text-sm font-semibold">
                Customer
                <select
                  className="min-h-11 border border-mp-border bg-mp-panel px-3"
                  name="customerKey"
                >
                  {customers.data?.items.map((item) => (
                    <option key={item.id} value={item.externalKey}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-semibold">
                Meter
                <select
                  className="min-h-11 border border-mp-border bg-mp-panel px-3"
                  name="meterKey"
                >
                  {meters.data?.items.map((item) => (
                    <option key={item.id} value={item.key}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <TextField label="Period start" name="periodStart" required type="date" />
              <TextField label="Period end" name="periodEnd" required type="date" />
              <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                <input name="repair" type="checkbox" />
                Repair detected aggregate drift
              </label>
              <Button loading={mutation.isPending} loadingLabel="Queuing…" type="submit">
                Start durable run
              </Button>
            </form>
          </PanelContent>
        </Panel>
        <section>
          <h2 className="section-title">Run history</h2>
          {query.data?.items.length === 0 ? (
            <EmptyState
              className="mt-4 border border-mp-border bg-mp-panel"
              description={<p>Start the first scoped comparison.</p>}
              title="No reconciliation runs"
            />
          ) : (
            <div className="mt-4 space-y-3">
              {query.data?.items.map((run) => (
                <article
                  className="grid gap-4 border border-mp-border bg-mp-panel p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center"
                  key={run.id}
                >
                  <ScalesIcon size={22} />
                  <div>
                    <p className="font-semibold">
                      {run.customerKey} · {run.meterKey}
                    </p>
                    <p className="text-xs text-mp-ink-muted">
                      {run.kind} · repair {run.repairRequested ? "requested" : "off"}
                      {run.status === "completed"
                        ? ` · ${run.summary.driftCount} drift findings`
                        : ""}
                    </p>
                  </div>
                  <StatusBadge tone={tone(run.status)}>{run.status}</StatusBadge>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function ExportsPage() {
  const organization = useActiveOrganization();
  const id = organization.active.organization.id;
  const query = useQuery({ queryFn: () => listExports(id), queryKey: operationKeys.exports(id) });
  const previews = useQuery({ queryFn: () => listPreviews(id), queryKey: previewKeys.all(id) });
  const mutation = useMutation({
    mutationFn: ({
      previewId,
      stripeCustomerId,
    }: {
      previewId: string;
      stripeCustomerId: string;
    }) => createExport(id, previewId, stripeCustomerId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: operationKeys.exports(id) }),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = createStripeInvoiceLineExportRequestSchema.safeParse({
      previewId: data.get("previewId"),
      stripeCustomerId: data.get("stripeCustomerId"),
    });
    if (parsed.success) mutation.mutate(parsed.data);
  }
  return (
    <div className="page-frame">
      <header className="border-mp-border border-b pb-7">
        <p className="section-kicker">Administration / Billing handoff</p>
        <h1 className="mt-3 font-mp-display text-5xl font-semibold">Exports</h1>
        <p className="mt-4 text-sm text-mp-ink-muted">
          Produce immutable Stripe invoice-item batches bound to a completed preview hash.
        </p>
      </header>
      <form
        className="mt-6 grid gap-4 border border-mp-border bg-mp-panel p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={submit}
      >
        <label className="grid gap-1.5 text-sm font-semibold">
          Completed preview
          <select className="min-h-11 border border-mp-border bg-mp-panel px-3" name="previewId">
            {previews.data?.items
              .filter((item) => item.status === "completed")
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.customerKey} · revision {item.revision}
                </option>
              ))}
          </select>
        </label>
        <TextField
          label="Stripe customer ID"
          name="stripeCustomerId"
          placeholder="cus_..."
          required
        />
        <Button type="submit">Create export</Button>
      </form>
      {query.data?.items.length === 0 ? (
        <EmptyState
          className="mt-6 border border-mp-border bg-mp-panel"
          description={<p>Create an export from a completed preview.</p>}
          title="No billing exports"
        />
      ) : (
        <div className="mt-6 space-y-3">
          {query.data?.items.map((item) => (
            <article
              className="flex items-center justify-between gap-4 border border-mp-border bg-mp-panel p-4"
              key={item.id}
            >
              <div className="flex gap-3">
                <ExportIcon size={22} />
                <div>
                  <p className="font-semibold">{item.stripeCustomerId}</p>
                  <p className="text-xs text-mp-ink-muted">
                    Preview revision {item.sourcePreviewRevision} · {item.id}
                  </p>
                </div>
              </div>
              <StatusBadge tone={tone(item.status)}>{item.status}</StatusBadge>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function AuditLogPage() {
  const organization = useActiveOrganization();
  const id = organization.active.organization.id;
  const query = useQuery({ queryFn: () => listAudit(id), queryKey: operationKeys.audit(id) });
  return (
    <div className="page-frame">
      <header className="border-mp-border border-b pb-7">
        <p className="section-kicker">Administration / Immutable evidence</p>
        <h1 className="mt-3 font-mp-display text-5xl font-semibold">Audit log</h1>
        <p className="mt-4 text-sm text-mp-ink-muted">
          Review sensitive operator, API-key, and system actions with request IDs for support.
        </p>
      </header>
      {query.data?.items.length === 0 ? (
        <EmptyState
          className="mt-6 border border-mp-border bg-mp-panel"
          description={<p>Sensitive changes will appear here.</p>}
          title="No audit entries"
        />
      ) : (
        <ol className="mt-6 divide-y divide-mp-border border border-mp-border bg-mp-panel">
          {query.data?.items.map((entry) => (
            <li
              className="grid gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-start"
              key={entry.id}
            >
              <ClockCounterClockwiseIcon size={21} />
              <div>
                <p className="font-semibold">{entry.action}</p>
                <p className="mt-1 text-xs text-mp-ink-muted">
                  {entry.actor.type} · {entry.resourceType}
                  {entry.resourceId ? `:${entry.resourceId}` : ""}
                </p>
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold">Metadata</summary>
                  <pre className="mt-2 overflow-auto bg-mp-ink p-3 font-mp-mono text-xs text-mp-paper">
                    {JSON.stringify(entry.metadata, null, 2)}
                  </pre>
                </details>
              </div>
              <div className="text-right">
                <time className="text-xs" dateTime={entry.occurredAt}>
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(entry.occurredAt))}
                </time>
                <p className="mt-1 font-mp-mono text-[0.625rem] text-mp-ink-muted">
                  {entry.requestId ?? "no request id"}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
