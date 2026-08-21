import { createSubscriptionRequestSchema } from "@meterpilot/contracts/catalog";
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
import { ReceiptIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { ApiError } from "../../lib/api/client";
import { queryClient } from "../../lib/query-client";
import { firstFieldErrors } from "../auth/form-errors";
import { customerKeys, listCustomers } from "../customers/api";
import { useActiveOrganization } from "../organizations/organization-context";
import {
  cancelSubscription,
  catalogKeys,
  createSubscription,
  listPlans,
  listSubscriptions,
} from "./api";

function utcStart(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(value.getTime()) ? value.toISOString() : "";
}
function dateInput(offsetDays = 0) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

export function SubscriptionsPage() {
  const organization = useActiveOrganization();
  const organizationId = organization.active.organization.id;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cancelTarget, setCancelTarget] = useState<{ id: string; customerKey: string }>();
  const [confirmation, setConfirmation] = useState("");
  const subscriptionsQuery = useQuery({
    queryFn: () => listSubscriptions(organizationId),
    queryKey: catalogKeys.subscriptions(organizationId),
  });
  const plansQuery = useQuery({
    queryFn: () => listPlans(organizationId),
    queryKey: catalogKeys.plans(organizationId),
  });
  const customersQuery = useQuery({
    queryFn: () => listCustomers(organizationId),
    queryKey: customerKeys.list(organizationId),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: catalogKeys.subscriptions(organizationId) });
  const createMutation = useMutation({
    mutationFn: (input: Parameters<typeof createSubscription>[1]) =>
      createSubscription(organizationId, input),
    onSuccess: refresh,
  });
  const cancelMutation = useMutation({
    mutationFn: ({ endsAt, id }: { endsAt: string; id: string }) =>
      cancelSubscription(organizationId, id, endsAt),
    async onSuccess() {
      setCancelTarget(undefined);
      setConfirmation("");
      await refresh();
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const selected = String(data.get("planVersion")).split(":");
    const startsAt = utcStart(String(data.get("startsAt")));
    const billingAnchor = utcStart(String(data.get("billingAnchor")));
    const endDate = String(data.get("endsAt") ?? "");
    const parsed = createSubscriptionRequestSchema.safeParse({
      billingAnchor,
      commercialSlot: data.get("commercialSlot"),
      customerKey: data.get("customerKey"),
      endsAt: endDate ? utcStart(endDate) : null,
      planKey: selected[0],
      planVersion: Number(selected[1]),
      startsAt,
    });
    if (!parsed.success) {
      setErrors(firstFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    createMutation.mutate(parsed.data, { onSuccess: () => form.reset() });
  }
  const publishedVersions =
    plansQuery.data?.items.flatMap((plan) =>
      plan.versions
        .filter((version) => version.status === "published")
        .map((version) => ({
          label: `${plan.name} · v${version.version}`,
          planKey: plan.key,
          version: version.version,
        })),
    ) ?? [];
  const operationError = createMutation.error ?? cancelMutation.error;
  return (
    <div className="page-frame">
      <header className="border-mp-border border-b pb-7">
        <p className="section-kicker">Configuration / Commercial assignment</p>
        <h1 className="mt-3 font-mp-display text-[clamp(2.75rem,7vw,5.5rem)] leading-[0.9] font-semibold tracking-[-0.045em]">
          Subscriptions
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-mp-ink-muted">
          Assign one published plan version to a customer’s non-overlapping commercial slot and
          control its effective interval.
        </p>
      </header>
      {operationError ? (
        <Notice className="mt-6" title="Subscription operation failed" tone="danger">
          <p>
            {operationError instanceof ApiError
              ? `${operationError.message} Request ID: ${operationError.requestId}`
              : "The subscription operation failed."}
          </p>
        </Notice>
      ) : null}
      <div className="mt-6 grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
        <Panel>
          <PanelHeader>
            <PanelTitle as="h2">Create subscription</PanelTitle>
          </PanelHeader>
          <PanelContent>
            {publishedVersions.length > 0 && customersQuery.data?.items.length ? (
              <form className="grid gap-4" onSubmit={submit}>
                <label className="grid gap-1.5 text-sm font-semibold">
                  Customer
                  <select
                    className="min-h-11 border border-mp-border bg-mp-panel px-3"
                    name="customerKey"
                  >
                    {customersQuery.data.items
                      .filter((customer) => !customer.archivedAt)
                      .map((customer) => (
                        <option key={customer.id} value={customer.externalKey}>
                          {customer.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm font-semibold">
                  Published plan version
                  <select
                    className="min-h-11 border border-mp-border bg-mp-panel px-3"
                    name="planVersion"
                  >
                    {publishedVersions.map((version) => (
                      <option
                        key={`${version.planKey}:${version.version}`}
                        value={`${version.planKey}:${version.version}`}
                      >
                        {version.label}
                      </option>
                    ))}
                  </select>
                </label>
                <TextField
                  {...(errors.commercialSlot ? { error: errors.commercialSlot } : {})}
                  defaultValue="default"
                  label="Commercial slot"
                  name="commercialSlot"
                  required
                />
                <TextField
                  {...(errors.billingAnchor ? { error: errors.billingAnchor } : {})}
                  defaultValue={dateInput()}
                  label="Billing anchor"
                  name="billingAnchor"
                  required
                  type="date"
                />
                <TextField
                  {...(errors.startsAt ? { error: errors.startsAt } : {})}
                  defaultValue={dateInput()}
                  label="Starts"
                  name="startsAt"
                  required
                  type="date"
                />
                <TextField
                  {...(errors.endsAt ? { error: errors.endsAt } : {})}
                  label="Ends (optional)"
                  name="endsAt"
                  type="date"
                />
                <Button
                  loading={createMutation.isPending}
                  loadingLabel="Creating subscription…"
                  type="submit"
                >
                  Create subscription
                </Button>
              </form>
            ) : (
              <p className="text-sm leading-6 text-mp-ink-muted">
                A customer and published plan version are required first.
              </p>
            )}
          </PanelContent>
        </Panel>
        <section>
          <p className="section-kicker">Commercial ledger</p>
          <h2 className="section-title">Assignments</h2>
          {subscriptionsQuery.data?.items.length === 0 ? (
            <EmptyState
              className="mt-4 border border-mp-border bg-mp-panel"
              description={<p>Create an assignment after publishing a plan version.</p>}
              title="No subscriptions yet"
            />
          ) : (
            <div className="mt-4 space-y-3">
              {subscriptionsQuery.data?.items.map((subscription) => (
                <article
                  className="grid gap-4 border border-mp-border bg-mp-panel p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center"
                  key={subscription.id}
                >
                  <ReceiptIcon aria-hidden="true" size={23} />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{subscription.customerKey}</p>
                      <StatusBadge tone={subscription.status === "active" ? "success" : "neutral"}>
                        {subscription.status}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-xs text-mp-ink-muted">
                      {subscription.planKey} v{subscription.planVersion} ·{" "}
                      {subscription.commercialSlot} · starts{" "}
                      {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
                        new Date(subscription.startsAt),
                      )}
                    </p>
                  </div>
                  {subscription.status === "active" ? (
                    <Button
                      onClick={() => {
                        setCancelTarget({
                          customerKey: subscription.customerKey,
                          id: subscription.id,
                        });
                        setConfirmation("");
                      }}
                      size="compact"
                      variant="danger"
                    >
                      Schedule end
                    </Button>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
      {cancelTarget ? (
        <section className="fixed inset-0 z-50 grid place-items-center bg-mp-ink/70 p-4">
          <form
            className="w-full max-w-lg border border-mp-border bg-mp-panel p-6"
            onSubmit={(event) => {
              event.preventDefault();
              const endsAt = utcStart(String(new FormData(event.currentTarget).get("endsAt")));
              if (confirmation === cancelTarget.customerKey && endsAt)
                cancelMutation.mutate({ endsAt, id: cancelTarget.id });
            }}
          >
            <h2 className="font-mp-display text-3xl font-semibold">Schedule subscription end</h2>
            <p className="mt-3 text-sm text-mp-ink-muted">
              Type <strong>{cancelTarget.customerKey}</strong> and select the exclusive end date.
              Historical pricing evidence remains immutable.
            </p>
            <TextField
              className="mt-5"
              label="Customer key confirmation"
              onChange={(event) => setConfirmation(event.currentTarget.value)}
              value={confirmation}
            />
            <TextField
              className="mt-4"
              defaultValue={dateInput(30)}
              label="End date"
              name="endsAt"
              required
              type="date"
            />
            <div className="mt-5 flex justify-end gap-3">
              <Button onClick={() => setCancelTarget(undefined)} variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={confirmation !== cancelTarget.customerKey}
                loading={cancelMutation.isPending}
                loadingLabel="Scheduling…"
                type="submit"
                variant="danger"
              >
                Schedule end
              </Button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
