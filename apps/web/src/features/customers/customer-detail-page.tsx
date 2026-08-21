import { subjectKeySchema } from "@meterpilot/contracts/events";
import {
  Button,
  Notice,
  Panel,
  PanelContent,
  PanelHeader,
  PanelTitle,
  StatusBadge,
  TextField,
} from "@meterpilot/ui";
import { ArrowLeftIcon, ChartLineIcon, LinkSimpleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router";

import { ApiError } from "../../lib/api/client";
import { queryClient } from "../../lib/query-client";
import { useActiveOrganization } from "../organizations/organization-context";
import { attachCustomerSubject, customerKeys, getCustomer } from "./api";

export function CustomerDetailPage() {
  const organization = useActiveOrganization();
  const organizationId = organization.active.organization.id;
  const { customerKey = "" } = useParams();
  const [subjectError, setSubjectError] = useState<string>();
  const customerQuery = useQuery({
    enabled: customerKey.length > 0,
    queryFn: () => getCustomer(organizationId, customerKey),
    queryKey: customerKeys.detail(organizationId, customerKey),
  });
  const attachMutation = useMutation({
    mutationFn: (externalKey: string) =>
      attachCustomerSubject(organizationId, customerKey, externalKey),
    async onSuccess() {
      await queryClient.invalidateQueries({
        queryKey: customerKeys.detail(organizationId, customerKey),
      });
      await queryClient.invalidateQueries({ queryKey: customerKeys.all(organizationId) });
    },
  });

  function handleAttach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = subjectKeySchema.safeParse(new FormData(form).get("externalKey"));
    if (!parsed.success) {
      setSubjectError(parsed.error.issues[0]?.message ?? "Enter a valid subject key.");
      return;
    }
    setSubjectError(undefined);
    attachMutation.mutate(parsed.data, { onSuccess: () => form.reset() });
  }

  if (customerQuery.isPending)
    return (
      <div className="page-frame">
        <p className="font-mp-display text-2xl font-semibold">Loading customer…</p>
      </div>
    );
  if (customerQuery.error)
    return (
      <div className="page-frame">
        <Notice title="Customer unavailable" tone="danger">
          <p>The customer could not be loaded in this organization.</p>
        </Notice>
        <Link
          className="mt-5 inline-flex min-h-11 items-center gap-2 font-semibold underline decoration-mp-signal-strong decoration-2 underline-offset-4"
          to="/customers"
        >
          <ArrowLeftIcon aria-hidden="true" size={17} />
          Back to customers
        </Link>
      </div>
    );

  const customer = customerQuery.data.customer;

  return (
    <div className="page-frame">
      <Link
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline decoration-mp-signal-strong decoration-2 underline-offset-4"
        to="/customers"
      >
        <ArrowLeftIcon aria-hidden="true" size={17} />
        Customers
      </Link>
      <header className="mt-5 border-mp-border border-b pb-7">
        <div className="flex flex-wrap items-center gap-3">
          <p className="section-kicker">Customer identity</p>
          <StatusBadge tone={customer.archivedAt ? "neutral" : "success"}>
            {customer.archivedAt ? "archived" : "active"}
          </StatusBadge>
        </div>
        <h1 className="mt-4 font-mp-display text-[clamp(2.75rem,7vw,5rem)] leading-none font-semibold tracking-[-0.04em]">
          {customer.name}
        </h1>
        <p className="mt-4 font-mp-mono text-sm text-mp-ink-muted">{customer.externalKey}</p>
      </header>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <Panel>
          <PanelHeader>
            <PanelTitle as="h2">Subject mappings</PanelTitle>
          </PanelHeader>
          <PanelContent>
            {customer.subjects.length === 0 ? (
              <p className="text-sm text-mp-ink-muted">No usage subjects are attached yet.</p>
            ) : (
              <ul className="divide-y divide-mp-border border border-mp-border">
                {customer.subjects.map((subject) => (
                  <li className="flex items-center justify-between gap-3 p-3" key={subject.id}>
                    <span className="font-mp-mono text-xs font-semibold">
                      {subject.externalKey}
                    </span>
                    <time className="text-xs text-mp-ink-muted" dateTime={subject.createdAt}>
                      {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
                        new Date(subject.createdAt),
                      )}
                    </time>
                  </li>
                ))}
              </ul>
            )}
            {attachMutation.error ? (
              <Notice className="mt-5" title="Subject not attached" tone="danger">
                <p>
                  {attachMutation.error instanceof ApiError &&
                  attachMutation.error.code === "conflict"
                    ? "That subject key is already attached to a customer."
                    : "The subject could not be attached."}
                  {attachMutation.error instanceof ApiError
                    ? ` Request ID: ${attachMutation.error.requestId}`
                    : ""}
                </p>
              </Notice>
            ) : null}
            <form
              className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
              noValidate
              onSubmit={handleAttach}
            >
              <TextField
                {...(subjectError ? { error: subjectError } : {})}
                autoCapitalize="none"
                label="Attach subject key"
                name="externalKey"
                placeholder="workspace_acme"
                required
              />
              <Button loading={attachMutation.isPending} loadingLabel="Attaching…" type="submit">
                <LinkSimpleIcon aria-hidden="true" size={17} />
                Attach
              </Button>
            </form>
          </PanelContent>
        </Panel>
        <div className="space-y-6">
          <Panel>
            <PanelHeader>
              <PanelTitle as="h2">Billing profile</PanelTitle>
            </PanelHeader>
            <PanelContent>
              <dl className="space-y-4 text-sm">
                <div>
                  <dt className="section-kicker">Timezone</dt>
                  <dd className="mt-1 font-semibold">{customer.billingTimezone}</dd>
                </div>
                <div>
                  <dt className="section-kicker">Billing email</dt>
                  <dd className="mt-1 font-semibold">{customer.email ?? "Not configured"}</dd>
                </div>
                <div>
                  <dt className="section-kicker">Created</dt>
                  <dd className="mt-1 font-semibold">
                    {new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(
                      new Date(customer.createdAt),
                    )}
                  </dd>
                </div>
              </dl>
            </PanelContent>
          </Panel>
          <Link
            className="flex min-h-12 items-center justify-between gap-3 border border-mp-border bg-mp-panel p-4 font-semibold hover:bg-mp-paper"
            to={`/usage?customerKey=${encodeURIComponent(customer.externalKey)}`}
          >
            <span className="flex items-center gap-2">
              <ChartLineIcon aria-hidden="true" size={20} />
              Inspect usage
            </span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
