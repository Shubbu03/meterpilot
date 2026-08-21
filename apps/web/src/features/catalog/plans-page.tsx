import {
  createPlanRequestSchema,
  createPlanVersionRequestSchema,
  type PlanComponent,
  type PriceModel,
} from "@meterpilot/contracts/catalog";
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
import { RocketLaunchIcon, StackIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { ApiError } from "../../lib/api/client";
import { queryClient } from "../../lib/query-client";
import { firstFieldErrors } from "../auth/form-errors";
import { useActiveOrganization } from "../organizations/organization-context";
import { catalogKeys, createPlan, createPlanVersion, listPlans, publishPlanVersion } from "./api";

const componentExample = JSON.stringify(
  [
    {
      billingInterval: "month",
      componentKey: "platform",
      entitlement: null,
      featureKey: null,
      price: { amount: "4900", model: "flat" },
      rounding: { minorUnitScale: 2, mode: "half_away_from_zero" },
    },
  ],
  null,
  2,
);

function priceExample(price: PriceModel) {
  if (price.model === "flat") return `${price.amount} exact price units per month`;
  if (price.model === "per_unit")
    return `100 units × ${price.unitRate} = ${Number(price.unitRate) * 100} before rounding`;
  if (price.model === "included_overage")
    return `100 units includes ${price.includedQuantity}; excess uses ${price.overageRate}`;
  return `100 units traverse ${price.tiers.length} graduated tier${price.tiers.length === 1 ? "" : "s"}`;
}

export function PlansPage() {
  const organization = useActiveOrganization();
  const organizationId = organization.active.organization.id;
  const [planErrors, setPlanErrors] = useState<Record<string, string>>({});
  const [versionErrors, setVersionErrors] = useState<Record<string, string>>({});
  const [componentError, setComponentError] = useState<string>();
  const [draftComponents, setDraftComponents] = useState<PlanComponent[]>([]);
  const plansQuery = useQuery({
    queryFn: () => listPlans(organizationId),
    queryKey: catalogKeys.plans(organizationId),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: catalogKeys.plans(organizationId) });
  const planMutation = useMutation({
    mutationFn: (input: Parameters<typeof createPlan>[1]) => createPlan(organizationId, input),
    onSuccess: refresh,
  });
  const versionMutation = useMutation({
    mutationFn: ({
      input,
      planKey,
    }: {
      input: Parameters<typeof createPlanVersion>[2];
      planKey: string;
    }) => createPlanVersion(organizationId, planKey, input),
    onSuccess: refresh,
  });
  const publishMutation = useMutation({
    mutationFn: ({ planKey, version }: { planKey: string; version: number }) =>
      publishPlanVersion(organizationId, planKey, version),
    onSuccess: refresh,
  });

  function submitPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = createPlanRequestSchema.safeParse({
      key: data.get("key"),
      name: data.get("name"),
    });
    if (!parsed.success) {
      setPlanErrors(firstFieldErrors(parsed.error));
      return;
    }
    setPlanErrors({});
    planMutation.mutate(parsed.data, { onSuccess: () => form.reset() });
  }
  function submitVersion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setComponentError(undefined);
    const form = event.currentTarget;
    const data = new FormData(form);
    let components: unknown;
    try {
      components = JSON.parse(String(data.get("components")));
    } catch {
      setComponentError("Components must be valid JSON.");
      return;
    }
    const effective = new Date(String(data.get("effectiveFrom")));
    const parsed = createPlanVersionRequestSchema.safeParse({
      components,
      currency: data.get("currency"),
      effectiveFrom: Number.isFinite(effective.getTime()) ? effective.toISOString() : "",
    });
    if (!parsed.success) {
      setVersionErrors(firstFieldErrors(parsed.error));
      setDraftComponents([]);
      return;
    }
    setVersionErrors({});
    setDraftComponents(parsed.data.components as PlanComponent[]);
    versionMutation.mutate({ input: parsed.data, planKey: String(data.get("planKey")) });
  }
  const operationError = planMutation.error ?? versionMutation.error ?? publishMutation.error;

  return (
    <div className="page-frame">
      <header className="border-mp-border border-b pb-7">
        <p className="section-kicker">Configuration / Commercial policy</p>
        <div className="mt-3 flex items-end justify-between gap-5">
          <div>
            <h1 className="font-mp-display text-[clamp(2.75rem,7vw,5.5rem)] leading-[0.9] font-semibold tracking-[-0.045em]">
              Plans
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-mp-ink-muted">
              Compose immutable pricing versions, inspect a worked quantity example, then publish an
              effective commercial policy.
            </p>
          </div>
          <StackIcon
            aria-hidden="true"
            className="hidden text-mp-signal-strong sm:block"
            size={36}
          />
        </div>
      </header>
      {operationError ? (
        <Notice className="mt-6" title="Plan operation failed" tone="danger">
          <p>
            {operationError instanceof ApiError
              ? `${operationError.message} Request ID: ${operationError.requestId}`
              : "The plan operation failed."}
          </p>
        </Notice>
      ) : null}
      <div className="mt-6 grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
        <Panel>
          <PanelHeader>
            <PanelTitle as="h2">Create plan</PanelTitle>
          </PanelHeader>
          <PanelContent>
            <form className="grid gap-4" onSubmit={submitPlan}>
              <TextField
                {...(planErrors.name ? { error: planErrors.name } : {})}
                label="Plan name"
                name="name"
                placeholder="Growth"
                required
              />
              <TextField
                {...(planErrors.key ? { error: planErrors.key } : {})}
                label="Plan key"
                name="key"
                placeholder="growth"
                required
              />
              <Button loading={planMutation.isPending} loadingLabel="Creating plan…" type="submit">
                Create plan
              </Button>
            </form>
          </PanelContent>
        </Panel>
        <Panel>
          <PanelHeader>
            <PanelTitle as="h2">Draft version</PanelTitle>
          </PanelHeader>
          <PanelContent>
            {plansQuery.data?.items.some((plan) => !plan.archivedAt) ? (
              <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitVersion}>
                <label className="grid gap-1.5 text-sm font-semibold">
                  Plan
                  <select
                    className="min-h-11 border border-mp-border bg-mp-panel px-3"
                    name="planKey"
                  >
                    {plansQuery.data.items
                      .filter((plan) => !plan.archivedAt)
                      .map((plan) => (
                        <option key={plan.id} value={plan.key}>
                          {plan.name} · {plan.key}
                        </option>
                      ))}
                  </select>
                </label>
                <TextField
                  {...(versionErrors.currency ? { error: versionErrors.currency } : {})}
                  defaultValue="USD"
                  label="Currency"
                  maxLength={3}
                  name="currency"
                  required
                />
                <TextField
                  {...(versionErrors.effectiveFrom ? { error: versionErrors.effectiveFrom } : {})}
                  className="sm:col-span-2"
                  label="Effective from"
                  name="effectiveFrom"
                  required
                  type="datetime-local"
                />
                <label className="grid gap-1.5 text-sm font-semibold sm:col-span-2">
                  Components JSON
                  <textarea
                    className="min-h-64 border border-mp-border bg-mp-ink p-4 font-mp-mono text-xs leading-5 text-mp-paper"
                    defaultValue={componentExample}
                    name="components"
                  />
                </label>
                {componentError || versionErrors.components ? (
                  <p className="text-sm font-semibold text-mp-danger sm:col-span-2">
                    {componentError ?? versionErrors.components}
                  </p>
                ) : null}
                <Button
                  className="sm:col-span-2"
                  loading={versionMutation.isPending}
                  loadingLabel="Creating version…"
                  type="submit"
                >
                  Validate and create draft
                </Button>
              </form>
            ) : (
              <p className="text-sm text-mp-ink-muted">Create a plan before drafting a version.</p>
            )}
            {draftComponents.length > 0 ? (
              <div className="mt-5 border border-mp-signal-strong bg-mp-signal-soft p-4">
                <p className="section-kicker">Worked example before publish</p>
                <ul className="mt-3 space-y-2 text-sm">
                  {draftComponents.map((component) => (
                    <li key={component.componentKey}>
                      <strong>{component.componentKey}</strong> · {priceExample(component.price)}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-mp-ink-muted">
                  This display is explanatory; the server pricing engine remains the exact
                  calculation authority.
                </p>
              </div>
            ) : null}
          </PanelContent>
        </Panel>
      </div>
      <section className="mt-8">
        <p className="section-kicker">Version registry</p>
        <h2 className="section-title">Plan lifecycle</h2>
        {plansQuery.data?.items.length === 0 ? (
          <EmptyState
            className="mt-4 border border-mp-border bg-mp-panel"
            description={<p>Create the first plan and its version above.</p>}
            title="No pricing plans yet"
          />
        ) : null}
        <div className="mt-4 space-y-5">
          {plansQuery.data?.items.map((plan) => (
            <article className="border border-mp-border bg-mp-panel" key={plan.id}>
              <header className="p-5">
                <h3 className="font-mp-display text-2xl font-semibold">{plan.name}</h3>
                <p className="mt-1 font-mp-mono text-xs text-mp-ink-muted">{plan.key}</p>
              </header>
              <ul className="divide-y divide-mp-border border-mp-border border-t">
                {plan.versions.map((version) => (
                  <li
                    className="grid gap-3 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center"
                    key={version.id}
                  >
                    <StatusBadge
                      tone={
                        version.status === "published"
                          ? "success"
                          : version.status === "draft"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {version.status}
                    </StatusBadge>
                    <div>
                      <p className="font-semibold">
                        Version {version.version} · {version.currency}
                      </p>
                      <p className="text-xs text-mp-ink-muted">
                        {version.components.length} component
                        {version.components.length === 1 ? "" : "s"} · effective{" "}
                        {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
                          new Date(version.effectiveFrom),
                        )}
                      </p>
                    </div>
                    {version.status === "draft" ? (
                      <Button
                        onClick={() =>
                          publishMutation.mutate({ planKey: plan.key, version: version.version })
                        }
                        size="compact"
                      >
                        <RocketLaunchIcon aria-hidden="true" size={16} />
                        Publish
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
