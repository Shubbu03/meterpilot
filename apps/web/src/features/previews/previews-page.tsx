import { createInvoicePreviewRequestSchema } from "@meterpilot/contracts/previews";
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
import { ArrowRightIcon, FileTextIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../lib/api/client";
import { queryClient } from "../../lib/query-client";
import { firstFieldErrors } from "../auth/form-errors";
import { catalogKeys, listSubscriptions } from "../catalog/api";
import { useActiveOrganization } from "../organizations/organization-context";
import { createPreview, listPreviews, previewKeys } from "./api";

function utcStart(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}
export function PreviewsPage() {
  const organization = useActiveOrganization();
  const organizationId = organization.active.organization.id;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const previewsQuery = useQuery({
    queryFn: () => listPreviews(organizationId),
    queryKey: previewKeys.all(organizationId),
  });
  const subscriptionsQuery = useQuery({
    queryFn: () => listSubscriptions(organizationId),
    queryKey: catalogKeys.subscriptions(organizationId),
  });
  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof createPreview>[1]) =>
      createPreview(organizationId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: previewKeys.all(organizationId) }),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = createInvoicePreviewRequestSchema.safeParse({
      periodEnd: utcStart(String(data.get("periodEnd"))),
      periodStart: utcStart(String(data.get("periodStart"))),
      subscriptionId: data.get("subscriptionId"),
    });
    if (!parsed.success) {
      setErrors(firstFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    mutation.mutate(parsed.data, { onSuccess: () => form.reset() });
  }
  return (
    <div className="page-frame">
      <header className="border-mp-border border-b pb-7">
        <p className="section-kicker">Verification / Explainable pricing</p>
        <h1 className="mt-3 font-mp-display text-[clamp(2.75rem,7vw,5.5rem)] leading-[0.9] font-semibold tracking-[-0.045em]">
          Invoice previews
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-mp-ink-muted">
          Generate immutable pricing evidence for a complete subscription period before any line
          reaches an external billing system.
        </p>
      </header>
      {mutation.error ? (
        <Notice className="mt-6" title="Preview not requested" tone="danger">
          <p>
            {mutation.error instanceof ApiError
              ? `${mutation.error.message} Request ID: ${mutation.error.requestId}`
              : "The preview request failed."}
          </p>
        </Notice>
      ) : null}
      <div className="mt-6 grid gap-6 xl:grid-cols-[0.65fr_1.35fr]">
        <Panel>
          <PanelHeader>
            <PanelTitle as="h2">Request preview</PanelTitle>
          </PanelHeader>
          <PanelContent>
            {subscriptionsQuery.data?.items.some(
              (subscription) => subscription.status === "active",
            ) ? (
              <form className="grid gap-4" onSubmit={submit}>
                <label className="grid gap-1.5 text-sm font-semibold">
                  Subscription
                  <select
                    className="min-h-11 border border-mp-border bg-mp-panel px-3"
                    name="subscriptionId"
                  >
                    {subscriptionsQuery.data.items
                      .filter((subscription) => subscription.status === "active")
                      .map((subscription) => (
                        <option key={subscription.id} value={subscription.id}>
                          {subscription.customerKey} · {subscription.planKey} v
                          {subscription.planVersion}
                        </option>
                      ))}
                  </select>
                </label>
                <TextField
                  {...(errors.periodStart ? { error: errors.periodStart } : {})}
                  label="Period start"
                  name="periodStart"
                  required
                  type="date"
                />
                <TextField
                  {...(errors.periodEnd ? { error: errors.periodEnd } : {})}
                  label="Period end"
                  name="periodEnd"
                  required
                  type="date"
                />
                <Button loading={mutation.isPending} loadingLabel="Queuing preview…" type="submit">
                  Generate preview
                </Button>
              </form>
            ) : (
              <p className="text-sm text-mp-ink-muted">
                Create an active subscription before requesting a preview.
              </p>
            )}
          </PanelContent>
        </Panel>
        <section>
          <p className="section-kicker">Immutable revisions</p>
          <h2 className="section-title">Preview ledger</h2>
          {previewsQuery.data?.items.length === 0 ? (
            <EmptyState
              className="mt-4 border border-mp-border bg-mp-panel"
              description={<p>Generate the first preview from an active subscription.</p>}
              title="No pricing previews yet"
            />
          ) : (
            <div className="mt-4 space-y-3">
              {previewsQuery.data?.items.map((preview) => (
                <article
                  className="grid gap-4 border border-mp-border bg-mp-panel p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center"
                  key={preview.id}
                >
                  <FileTextIcon aria-hidden="true" size={23} />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{preview.customerKey}</p>
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
                    <p className="mt-1 text-xs text-mp-ink-muted">
                      Revision {preview.revision} · {preview.currency}{" "}
                      {preview.subtotalMinor ?? "pending"} minor units
                    </p>
                  </div>
                  <Link
                    aria-label={`Open preview ${preview.id}`}
                    className="inline-grid size-11 place-items-center border border-mp-border hover:bg-mp-paper"
                    to={`/previews/${preview.id}`}
                  >
                    <ArrowRightIcon aria-hidden="true" size={17} />
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
