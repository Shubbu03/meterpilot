import { createCustomerRequestSchema } from "@meterpilot/contracts/customers";
import { Button, EmptyState, Notice, StatusBadge, TextField } from "@meterpilot/ui";
import { ArrowRightIcon, PlusIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";

import { ApiError } from "../../lib/api/client";
import { queryClient } from "../../lib/query-client";
import { firstFieldErrors } from "../auth/form-errors";
import { useActiveOrganization } from "../organizations/organization-context";
import { createCustomer, customerKeys, listCustomers } from "./api";

export function CustomersPage() {
  const organization = useActiveOrganization();
  const organizationId = organization.active.organization.id;
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const cursor = cursorHistory.at(-1);
  const customersQuery = useQuery({
    queryFn: () => listCustomers(organizationId, cursor),
    queryKey: customerKeys.list(organizationId, cursor),
  });
  const createMutation = useMutation({
    mutationFn: (input: Parameters<typeof createCustomer>[1]) =>
      createCustomer(organizationId, input),
    async onSuccess() {
      setFieldErrors({});
      await queryClient.invalidateQueries({ queryKey: customerKeys.all(organizationId) });
    },
  });

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = formData.get("email");
    const subjects = String(formData.get("subjects") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const parsed = createCustomerRequestSchema.safeParse({
      billingTimezone: formData.get("billingTimezone"),
      ...(typeof email === "string" && email.trim() ? { email: email.trim() } : {}),
      externalKey: formData.get("externalKey"),
      metadata: {},
      name: formData.get("name"),
      subjects,
    });

    if (!parsed.success) {
      setFieldErrors(firstFieldErrors(parsed.error));
      return;
    }

    setFieldErrors({});
    createMutation.mutate(parsed.data, { onSuccess: () => form.reset() });
  }

  const mutationError = createMutation.error;

  return (
    <div className="page-frame">
      <header className="border-mp-border border-b pb-7">
        <p className="section-kicker">Operations / Billable identities</p>
        <div className="mt-3 flex items-end justify-between gap-5">
          <div>
            <h1 className="font-mp-display text-[clamp(2.75rem,7vw,5.5rem)] leading-[0.9] font-semibold tracking-[-0.045em]">
              Customers
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-mp-ink-muted">
              Map every external subject to the customer that owns its usage, billing timezone,
              subscriptions, and entitlements.
            </p>
          </div>
          <UsersThreeIcon
            aria-hidden="true"
            className="hidden text-mp-signal-strong sm:block"
            size={36}
          />
        </div>
      </header>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(20rem,0.72fr)_minmax(0,1.28fr)]">
        <section
          aria-labelledby="create-customer-heading"
          className="border border-mp-border bg-mp-panel p-5 sm:p-6"
        >
          <div className="flex items-center gap-2">
            <PlusIcon aria-hidden="true" size={19} />
            <h2 className="font-mp-display text-2xl font-semibold" id="create-customer-heading">
              Create customer
            </h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-mp-ink-muted">
            The external key is stable. Add comma-separated subject keys now or attach more later.
          </p>
          {mutationError ? (
            <Notice className="mt-5" title="Customer not created" tone="danger">
              <p>
                {mutationError instanceof ApiError && mutationError.code === "conflict"
                  ? "That customer or subject key is already in use."
                  : "The customer could not be created."}
                {mutationError instanceof ApiError ? ` Request ID: ${mutationError.requestId}` : ""}
              </p>
            </Notice>
          ) : null}
          <form className="mt-5 grid gap-4" noValidate onSubmit={handleCreate}>
            <TextField
              {...(fieldErrors.name ? { error: fieldErrors.name } : {})}
              label="Customer name"
              maxLength={200}
              name="name"
              placeholder="Acme Labs"
              required
            />
            <TextField
              {...(fieldErrors.externalKey ? { error: fieldErrors.externalKey } : {})}
              autoCapitalize="none"
              label="External key"
              maxLength={128}
              name="externalKey"
              placeholder="customer_acme"
              required
            />
            <TextField
              {...(fieldErrors.email ? { error: fieldErrors.email } : {})}
              autoCapitalize="none"
              label="Billing email (optional)"
              name="email"
              placeholder="billing@acme.com"
              type="email"
            />
            <TextField
              {...(fieldErrors.billingTimezone ? { error: fieldErrors.billingTimezone } : {})}
              defaultValue={organization.active.organization.defaultTimezone}
              label="Billing timezone"
              maxLength={64}
              name="billingTimezone"
              required
            />
            <TextField
              {...(fieldErrors.subjects ? { error: fieldErrors.subjects } : {})}
              hint="Separate multiple keys with commas."
              label="Subject keys (optional)"
              name="subjects"
              placeholder="workspace_acme, project_core"
            />
            <Button
              loading={createMutation.isPending}
              loadingLabel="Creating customer…"
              type="submit"
            >
              Create customer
            </Button>
          </form>
        </section>

        <section aria-labelledby="customer-list-heading">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="section-kicker">Organization directory</p>
              <h2 className="section-title" id="customer-list-heading">
                Customer records
              </h2>
            </div>
            {customersQuery.data ? (
              <span className="font-mp-mono text-xs text-mp-ink-muted">
                Page {cursorHistory.length + 1}
              </span>
            ) : null}
          </div>
          {customersQuery.isPending ? (
            <p className="font-mp-display text-2xl font-semibold">Loading customers…</p>
          ) : null}
          {customersQuery.error ? (
            <Notice title="Customers unavailable" tone="danger">
              <p>The customer directory could not be loaded.</p>
              <Button
                className="mt-4"
                onClick={() => void customersQuery.refetch()}
                size="compact"
                variant="secondary"
              >
                Try again
              </Button>
            </Notice>
          ) : null}
          {customersQuery.data?.items.length === 0 ? (
            <EmptyState
              className="border border-mp-border bg-mp-panel"
              description={
                <p>
                  Create the first customer here, then ingest events using one of its subject keys.
                </p>
              }
              title="No customer identities yet"
            />
          ) : null}
          {customersQuery.data && customersQuery.data.items.length > 0 ? (
            <div className="overflow-hidden border border-mp-border bg-mp-panel">
              <ul className="divide-y divide-mp-border">
                {customersQuery.data.items.map((customer) => (
                  <li
                    className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    key={customer.id}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold">{customer.name}</p>
                        <StatusBadge tone={customer.archivedAt ? "neutral" : "success"}>
                          {customer.archivedAt ? "archived" : "active"}
                        </StatusBadge>
                      </div>
                      <p className="mt-1 truncate font-mp-mono text-xs text-mp-ink-muted">
                        {customer.externalKey} · {customer.subjects.length} subject
                        {customer.subjects.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Link
                      aria-label={`Open customer ${customer.name}`}
                      className="inline-grid size-11 place-items-center border border-mp-border hover:bg-mp-paper"
                      to={`/customers/${encodeURIComponent(customer.externalKey)}`}
                    >
                      <ArrowRightIcon aria-hidden="true" size={17} />
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between gap-4 border-mp-border border-t p-4">
                <Button
                  disabled={cursorHistory.length === 0}
                  onClick={() => setCursorHistory((history) => history.slice(0, -1))}
                  size="compact"
                  variant="secondary"
                >
                  Previous
                </Button>
                <Button
                  disabled={!customersQuery.data.nextCursor}
                  onClick={() => {
                    if (customersQuery.data.nextCursor)
                      setCursorHistory((history) => [
                        ...history,
                        customersQuery.data.nextCursor as string,
                      ]);
                  }}
                  size="compact"
                  variant="secondary"
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
