import {
  configureEntitlementRequestSchema,
  createFeatureRequestSchema,
  createQuotaGrantRequestSchema,
} from "@meterpilot/contracts/entitlements";
import {
  Button,
  EmptyState,
  FreshnessStamp,
  Notice,
  Panel,
  PanelContent,
  PanelHeader,
  PanelTitle,
  StatusBadge,
  TextField,
} from "@meterpilot/ui";
import { FlagIcon, PlusIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router";

import { ApiError } from "../../lib/api/client";
import { queryClient } from "../../lib/query-client";
import { firstFieldErrors } from "../auth/form-errors";
import { customerKeys, listCustomers } from "../customers/api";
import { listMeters, meterKeys } from "../meters/api";
import { useActiveOrganization } from "../organizations/organization-context";
import {
  addQuotaGrant,
  configureEntitlement,
  createFeature,
  entitlementKeys,
  getEntitlementBalance,
  listFeatures,
} from "./api";

function utcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
function todayInput(offsetDays = 0) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

export function FeaturesPage() {
  const organization = useActiveOrganization();
  const organizationId = organization.active.organization.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const customerKey = searchParams.get("customerKey") ?? "";
  const featureKey = searchParams.get("featureKey") ?? "";
  const [featureErrors, setFeatureErrors] = useState<Record<string, string>>({});
  const [configurationErrors, setConfigurationErrors] = useState<Record<string, string>>({});
  const [grantErrors, setGrantErrors] = useState<Record<string, string>>({});
  const featuresQuery = useQuery({
    queryFn: () => listFeatures(organizationId),
    queryKey: entitlementKeys.features(organizationId),
  });
  const customersQuery = useQuery({
    queryFn: () => listCustomers(organizationId),
    queryKey: customerKeys.list(organizationId),
  });
  const metersQuery = useQuery({
    queryFn: () => listMeters(organizationId),
    queryKey: meterKeys.list(organizationId),
  });
  const balanceQuery = useQuery({
    enabled: customerKey.length > 0 && featureKey.length > 0,
    queryFn: () => getEntitlementBalance(organizationId, customerKey, featureKey),
    queryKey: entitlementKeys.balance(organizationId, customerKey, featureKey),
    retry: false,
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: entitlementKeys.all(organizationId) });
  };
  const featureMutation = useMutation({
    mutationFn: (input: Parameters<typeof createFeature>[1]) =>
      createFeature(organizationId, input),
    onSuccess: refresh,
  });
  const configureMutation = useMutation({
    mutationFn: (input: Parameters<typeof configureEntitlement>[3]) =>
      configureEntitlement(organizationId, customerKey, featureKey, input),
    onSuccess: refresh,
  });
  const grantMutation = useMutation({
    mutationFn: (input: Parameters<typeof addQuotaGrant>[3]) =>
      addQuotaGrant(organizationId, customerKey, featureKey, input),
    onSuccess: refresh,
  });

  function createFeatureSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const meterKey = String(data.get("meterKey") ?? "");
    const parsed = createFeatureRequestSchema.safeParse({
      key: data.get("key"),
      meterKey: meterKey || null,
      name: data.get("name"),
    });
    if (!parsed.success) {
      setFeatureErrors(firstFieldErrors(parsed.error));
      return;
    }
    setFeatureErrors({});
    featureMutation.mutate(parsed.data, { onSuccess: () => form.reset() });
  }

  function selectBalance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSearchParams(
      { customerKey: String(data.get("customerKey")), featureKey: String(data.get("featureKey")) },
      { replace: true },
    );
  }

  function configureSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const start = utcDate(String(data.get("periodStart")));
    const end = utcDate(String(data.get("periodEnd")));
    const parsed = configureEntitlementRequestSchema.safeParse({
      enabled: data.get("enabled") === "on",
      mode: data.get("mode"),
      periodEnd: Number.isFinite(end.getTime()) ? end.toISOString() : "",
      periodStart: Number.isFinite(start.getTime()) ? start.toISOString() : "",
    });
    if (!parsed.success) {
      setConfigurationErrors(firstFieldErrors(parsed.error));
      return;
    }
    setConfigurationErrors({});
    configureMutation.mutate(parsed.data);
  }

  function grantSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const effectiveAt = utcDate(String(data.get("effectiveAt")));
    const expiresValue = String(data.get("expiresAt") ?? "");
    const expiresAt = expiresValue ? utcDate(expiresValue) : null;
    const parsed = createQuotaGrantRequestSchema.safeParse({
      effectiveAt: Number.isFinite(effectiveAt.getTime()) ? effectiveAt.toISOString() : "",
      expiresAt: expiresAt && Number.isFinite(expiresAt.getTime()) ? expiresAt.toISOString() : null,
      quantity: data.get("quantity"),
      reason: data.get("reason"),
    });
    if (!parsed.success) {
      setGrantErrors(firstFieldErrors(parsed.error));
      return;
    }
    setGrantErrors({});
    grantMutation.mutate(parsed.data, { onSuccess: () => form.reset() });
  }

  const balanceMissing =
    balanceQuery.error instanceof ApiError && balanceQuery.error.code === "not_found";
  const operationError = featureMutation.error ?? configureMutation.error ?? grantMutation.error;
  const balance = balanceQuery.data?.entitlement;

  return (
    <div className="page-frame">
      <header className="border-mp-border border-b pb-7">
        <p className="section-kicker">Configuration / Access decisions</p>
        <div className="mt-3 flex items-end justify-between gap-5">
          <div>
            <h1 className="font-mp-display text-[clamp(2.75rem,7vw,5.5rem)] leading-[0.9] font-semibold tracking-[-0.045em]">
              Features & entitlements
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-mp-ink-muted">
              Define what customers can use, distinguish advisory visibility from hard enforcement,
              and trace every balance to its freshness version.
            </p>
          </div>
          <FlagIcon
            aria-hidden="true"
            className="hidden text-mp-signal-strong sm:block"
            size={36}
          />
        </div>
      </header>
      {operationError ? (
        <Notice className="mt-6" title="Entitlement operation failed" tone="danger">
          <p>
            {operationError instanceof ApiError
              ? `${operationError.message} Request ID: ${operationError.requestId}`
              : "The entitlement operation could not be completed."}
          </p>
        </Notice>
      ) : null}
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(19rem,0.7fr)_minmax(0,1.3fr)]">
        <div className="space-y-6">
          <Panel>
            <PanelHeader>
              <PanelTitle as="h2">Create product feature</PanelTitle>
            </PanelHeader>
            <PanelContent>
              <form className="grid gap-4" noValidate onSubmit={createFeatureSubmit}>
                <TextField
                  {...(featureErrors.name ? { error: featureErrors.name } : {})}
                  label="Feature name"
                  name="name"
                  placeholder="AI assistant"
                  required
                />
                <TextField
                  {...(featureErrors.key ? { error: featureErrors.key } : {})}
                  autoCapitalize="none"
                  label="Feature key"
                  name="key"
                  placeholder="ai.assistant"
                  required
                />
                <label className="grid gap-1.5 text-sm font-semibold" htmlFor="feature-meter">
                  Meter (optional)
                  <select
                    className="min-h-11 border border-mp-border bg-mp-panel px-3"
                    id="feature-meter"
                    name="meterKey"
                  >
                    <option value="">Boolean / unmetered</option>
                    {metersQuery.data?.items
                      .filter((meter) => meter.status === "active")
                      .map((meter) => (
                        <option key={meter.id} value={meter.key}>
                          {meter.name} · {meter.key}
                        </option>
                      ))}
                  </select>
                </label>
                <Button
                  loading={featureMutation.isPending}
                  loadingLabel="Creating feature…"
                  type="submit"
                >
                  <PlusIcon aria-hidden="true" size={17} />
                  Create feature
                </Button>
              </form>
            </PanelContent>
          </Panel>
          <Panel>
            <PanelHeader>
              <PanelTitle as="h2">Feature registry</PanelTitle>
            </PanelHeader>
            <PanelContent>
              {featuresQuery.data?.items.length === 0 ? (
                <p className="text-sm text-mp-ink-muted">No features are defined.</p>
              ) : (
                <ul className="divide-y divide-mp-border">
                  {featuresQuery.data?.items.map((feature) => (
                    <li className="py-3" key={feature.id}>
                      <p className="font-semibold">{feature.name}</p>
                      <p className="mt-1 font-mp-mono text-xs text-mp-ink-muted">
                        {feature.key}
                        {feature.meterKey ? ` · ${feature.meterKey}` : " · boolean"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </PanelContent>
          </Panel>
        </div>
        <section aria-labelledby="balance-heading">
          <div>
            <p className="section-kicker">Customer decision</p>
            <h2 className="section-title" id="balance-heading">
              Entitlement balance
            </h2>
          </div>
          <form
            className="mt-4 grid gap-4 border border-mp-border bg-mp-panel p-5 md:grid-cols-[1fr_1fr_auto] md:items-end"
            onSubmit={selectBalance}
          >
            <label className="grid gap-1.5 text-sm font-semibold" htmlFor="entitlement-customer">
              Customer
              <select
                className="min-h-11 border border-mp-border bg-mp-panel px-3"
                defaultValue={customerKey}
                id="entitlement-customer"
                name="customerKey"
                required
              >
                <option disabled value="">
                  Select customer
                </option>
                {customersQuery.data?.items
                  .filter((customer) => !customer.archivedAt)
                  .map((customer) => (
                    <option key={customer.id} value={customer.externalKey}>
                      {customer.name} · {customer.externalKey}
                    </option>
                  ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-semibold" htmlFor="entitlement-feature">
              Feature
              <select
                className="min-h-11 border border-mp-border bg-mp-panel px-3"
                defaultValue={featureKey}
                id="entitlement-feature"
                name="featureKey"
                required
              >
                <option disabled value="">
                  Select feature
                </option>
                {featuresQuery.data?.items.map((feature) => (
                  <option key={feature.id} value={feature.key}>
                    {feature.name} · {feature.key}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit">Inspect balance</Button>
          </form>
          {!customerKey || !featureKey ? (
            <EmptyState
              className="mt-5 border border-mp-border bg-mp-panel"
              description={
                <p>Select a customer and feature to read or configure its current period.</p>
              }
              title="No entitlement selected"
            />
          ) : null}
          {balanceQuery.isPending && customerKey && featureKey ? (
            <p className="mt-6 font-mp-display text-2xl font-semibold">Reading entitlement…</p>
          ) : null}
          {balanceMissing ? (
            <Notice className="mt-5" title="Entitlement not configured" tone="warning">
              <p>
                Create the first period below. No balance is assumed until the server returns it.
              </p>
            </Notice>
          ) : null}
          {balance ? (
            <div className="mt-5 border border-mp-border bg-mp-ink p-5 text-mp-paper">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone={balance.enabled ? "success" : "neutral"}>
                    {balance.enabled ? "enabled" : "disabled"}
                  </StatusBadge>
                  <StatusBadge
                    tone={
                      balance.mode === "hard"
                        ? "danger"
                        : balance.mode === "advisory"
                          ? "info"
                          : "neutral"
                    }
                  >
                    {balance.mode === "hard" ? "hard enforced" : balance.mode}
                  </StatusBadge>
                  <StatusBadge tone={balance.allowed ? "success" : "danger"}>
                    {balance.allowed ? "allowed" : "denied"}
                  </StatusBadge>
                </div>
                <FreshnessStamp
                  className="text-mp-border"
                  dateTime={balance.updatedAt}
                  label={`Version ${balance.version}`}
                >
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(balance.updatedAt))}
                </FreshnessStamp>
              </div>
              <dl className="mt-6 grid gap-px bg-mp-border/30 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ["Available", balance.availableQuantity],
                  ["Granted", balance.grantedQuantity],
                  ["Committed", balance.committedQuantity],
                  ["Reserved", balance.reservedQuantity],
                  ["Overage", balance.overageQuantity],
                ].map(([label, value]) => (
                  <div className="bg-mp-ink p-4" key={label}>
                    <dt className="font-mp-mono text-[0.625rem] tracking-wider text-mp-border uppercase">
                      {label}
                    </dt>
                    <dd className="mt-2 break-all font-mp-display text-2xl font-semibold">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-5 text-xs leading-5 text-mp-border">
                <ShieldCheckIcon aria-hidden="true" className="mr-2 inline" size={16} />
                {balance.mode === "hard"
                  ? "Hard mode rejects reservations beyond the available quantity."
                  : balance.mode === "advisory"
                    ? "Advisory mode reports overage but does not enforce a runtime rejection."
                    : "Boolean mode represents feature access without a metered allowance."}
              </p>
            </div>
          ) : null}
          {customerKey && featureKey ? (
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <Panel>
                <PanelHeader>
                  <PanelTitle as="h3">Configure period</PanelTitle>
                </PanelHeader>
                <PanelContent>
                  <form className="grid gap-4" noValidate onSubmit={configureSubmit}>
                    <label
                      className="grid gap-1.5 text-sm font-semibold"
                      htmlFor="entitlement-mode"
                    >
                      Mode
                      <select
                        className="min-h-11 border border-mp-border bg-mp-panel px-3"
                        defaultValue={balance?.mode ?? "advisory"}
                        id="entitlement-mode"
                        name="mode"
                      >
                        <option value="boolean">Boolean</option>
                        <option value="advisory">Advisory</option>
                        <option value="hard">Hard enforced</option>
                      </select>
                    </label>
                    <TextField
                      {...(configurationErrors.periodStart
                        ? { error: configurationErrors.periodStart }
                        : {})}
                      defaultValue={todayInput()}
                      label="Period start"
                      name="periodStart"
                      required
                      type="date"
                    />
                    <TextField
                      {...(configurationErrors.periodEnd
                        ? { error: configurationErrors.periodEnd }
                        : {})}
                      defaultValue={todayInput(30)}
                      label="Period end"
                      name="periodEnd"
                      required
                      type="date"
                    />
                    <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                      <input
                        defaultChecked={balance?.enabled ?? true}
                        name="enabled"
                        type="checkbox"
                      />
                      Enabled
                    </label>
                    <Button
                      loading={configureMutation.isPending}
                      loadingLabel="Saving period…"
                      type="submit"
                    >
                      Save entitlement period
                    </Button>
                  </form>
                </PanelContent>
              </Panel>
              <Panel>
                <PanelHeader>
                  <PanelTitle as="h3">Add allowance grant</PanelTitle>
                </PanelHeader>
                <PanelContent>
                  <form className="grid gap-4" noValidate onSubmit={grantSubmit}>
                    <TextField
                      {...(grantErrors.quantity ? { error: grantErrors.quantity } : {})}
                      inputMode="decimal"
                      label="Quantity"
                      name="quantity"
                      placeholder="1000"
                      required
                    />
                    <TextField
                      {...(grantErrors.reason ? { error: grantErrors.reason } : {})}
                      label="Reason"
                      maxLength={200}
                      name="reason"
                      placeholder="Contract allowance"
                      required
                    />
                    <TextField
                      {...(grantErrors.effectiveAt ? { error: grantErrors.effectiveAt } : {})}
                      defaultValue={todayInput()}
                      label="Effective date"
                      name="effectiveAt"
                      required
                      type="date"
                    />
                    <TextField
                      {...(grantErrors.expiresAt ? { error: grantErrors.expiresAt } : {})}
                      label="Expires (optional)"
                      name="expiresAt"
                      type="date"
                    />
                    <Button
                      disabled={!balance}
                      loading={grantMutation.isPending}
                      loadingLabel="Adding grant…"
                      type="submit"
                    >
                      Add exact grant
                    </Button>
                  </form>
                  {!balance ? (
                    <p className="mt-3 text-xs text-mp-ink-muted">
                      Configure the entitlement before adding a grant.
                    </p>
                  ) : null}
                </PanelContent>
              </Panel>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
