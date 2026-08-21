import {
  createMeterRequestSchema,
  createMeterVersionRequestSchema,
  type Meter,
} from "@meterpilot/contracts/meters";
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
import { ArchiveBoxIcon, GaugeIcon, PlusIcon, RocketLaunchIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { ApiError } from "../../lib/api/client";
import { queryClient } from "../../lib/query-client";
import { firstFieldErrors } from "../auth/form-errors";
import { useActiveOrganization } from "../organizations/organization-context";
import {
  archiveMeter,
  createMeter,
  createMeterVersion,
  listMeters,
  meterKeys,
  publishMeterVersion,
} from "./api";

function localDateTime(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function meterTone(status: Meter["status"]) {
  return status === "active" ? "success" : status === "draft" ? "warning" : "neutral";
}

export function MetersPage() {
  const organization = useActiveOrganization();
  const organizationId = organization.active.organization.id;
  const [meterErrors, setMeterErrors] = useState<Record<string, string>>({});
  const [versionErrors, setVersionErrors] = useState<Record<string, string>>({});
  const [versionFormError, setVersionFormError] = useState<string>();
  const [archiveTarget, setArchiveTarget] = useState<string>();
  const [archiveConfirmation, setArchiveConfirmation] = useState("");
  const metersQuery = useQuery({
    queryFn: () => listMeters(organizationId),
    queryKey: meterKeys.list(organizationId),
  });
  const refreshMeters = () =>
    queryClient.invalidateQueries({ queryKey: meterKeys.all(organizationId) });
  const createMutation = useMutation({
    mutationFn: (input: Parameters<typeof createMeter>[1]) => createMeter(organizationId, input),
    onSuccess: refreshMeters,
  });
  const versionMutation = useMutation({
    mutationFn: ({
      input,
      meterKey,
    }: {
      input: Parameters<typeof createMeterVersion>[2];
      meterKey: string;
    }) => createMeterVersion(organizationId, meterKey, input),
    onSuccess: refreshMeters,
  });
  const publishMutation = useMutation({
    mutationFn: ({ meterKey, version }: { meterKey: string; version: number }) =>
      publishMeterVersion(organizationId, meterKey, version),
    onSuccess: refreshMeters,
  });
  const archiveMutation = useMutation({
    mutationFn: (meterKey: string) => archiveMeter(organizationId, meterKey),
    async onSuccess() {
      setArchiveTarget(undefined);
      setArchiveConfirmation("");
      await refreshMeters();
    },
  });

  function handleCreateMeter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const parsed = createMeterRequestSchema.safeParse({
      key: formData.get("key"),
      name: formData.get("name"),
    });
    if (!parsed.success) {
      setMeterErrors(firstFieldErrors(parsed.error));
      return;
    }
    setMeterErrors({});
    createMutation.mutate(parsed.data, { onSuccess: () => form.reset() });
  }

  function handleCreateVersion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVersionFormError(undefined);
    const form = event.currentTarget;
    const formData = new FormData(form);
    const filtersInput = String(formData.get("filters") ?? "[]");
    let filters: unknown;
    try {
      filters = JSON.parse(filtersInput);
    } catch {
      setVersionFormError("Filters must be a valid JSON array.");
      return;
    }
    const aggregation = formData.get("aggregation");
    const valueProperty = String(formData.get("valueProperty") ?? "").trim();
    const effectiveFrom = new Date(String(formData.get("effectiveFrom")));
    const effectiveTo = String(formData.get("effectiveTo") ?? "").trim();
    const effectiveToDate = effectiveTo ? new Date(effectiveTo) : null;

    if (
      !Number.isFinite(effectiveFrom.getTime()) ||
      (effectiveToDate && !Number.isFinite(effectiveToDate.getTime()))
    ) {
      setVersionFormError("Enter valid effective dates.");
      return;
    }

    const parsed = createMeterVersionRequestSchema.safeParse({
      aggregation,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: effectiveToDate?.toISOString() ?? null,
      eventType: formData.get("eventType"),
      filters,
      groupByKeys: String(formData.get("groupByKeys") ?? "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
      valueProperty: aggregation === "sum" ? valueProperty || null : null,
    });
    if (!parsed.success) {
      setVersionErrors(firstFieldErrors(parsed.error));
      return;
    }
    setVersionErrors({});
    versionMutation.mutate(
      { input: parsed.data, meterKey: String(formData.get("meterKey")) },
      { onSuccess: () => form.reset() },
    );
  }

  const operationError =
    createMutation.error ?? versionMutation.error ?? publishMutation.error ?? archiveMutation.error;

  return (
    <div className="page-frame">
      <header className="border-mp-border border-b pb-7">
        <p className="section-kicker">Configuration / Aggregation rules</p>
        <div className="mt-3 flex items-end justify-between gap-5">
          <div>
            <h1 className="font-mp-display text-[clamp(2.75rem,7vw,5.5rem)] leading-[0.9] font-semibold tracking-[-0.045em]">
              Meters
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-mp-ink-muted">
              Turn immutable events into versioned, explainable quantities. Publishing a version
              queues a durable aggregate rebuild.
            </p>
          </div>
          <GaugeIcon
            aria-hidden="true"
            className="hidden text-mp-signal-strong sm:block"
            size={36}
          />
        </div>
      </header>
      {operationError ? (
        <Notice className="mt-6" title="Meter operation failed" tone="danger">
          <p>
            {operationError instanceof ApiError
              ? `${operationError.message} Request ID: ${operationError.requestId}`
              : "The meter operation could not be completed."}
          </p>
        </Notice>
      ) : null}
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel>
          <PanelHeader>
            <PanelTitle as="h2">Create meter identity</PanelTitle>
          </PanelHeader>
          <PanelContent>
            <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={handleCreateMeter}>
              <TextField
                {...(meterErrors.name ? { error: meterErrors.name } : {})}
                label="Meter name"
                maxLength={200}
                name="name"
                placeholder="LLM tokens"
                required
              />
              <TextField
                {...(meterErrors.key ? { error: meterErrors.key } : {})}
                autoCapitalize="none"
                label="Meter key"
                maxLength={128}
                name="key"
                placeholder="llm.tokens"
                required
              />
              <Button
                className="sm:col-span-2"
                loading={createMutation.isPending}
                loadingLabel="Creating meter…"
                type="submit"
              >
                <PlusIcon aria-hidden="true" size={17} />
                Create draft meter
              </Button>
            </form>
          </PanelContent>
        </Panel>
        <Panel>
          <PanelHeader>
            <PanelTitle as="h2">Draft a meter version</PanelTitle>
          </PanelHeader>
          <PanelContent>
            {metersQuery.data?.items.some((meter) => meter.status !== "archived") ? (
              <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={handleCreateVersion}>
                <label className="grid gap-1.5 text-sm font-semibold" htmlFor="version-meter">
                  Meter
                  <select
                    className="min-h-11 border border-mp-border bg-mp-panel px-3"
                    id="version-meter"
                    name="meterKey"
                    required
                  >
                    {metersQuery.data.items
                      .filter((meter) => meter.status !== "archived")
                      .map((meter) => (
                        <option key={meter.id} value={meter.key}>
                          {meter.name} · {meter.key}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm font-semibold" htmlFor="version-aggregation">
                  Aggregation
                  <select
                    className="min-h-11 border border-mp-border bg-mp-panel px-3"
                    id="version-aggregation"
                    name="aggregation"
                  >
                    <option value="count">Count events</option>
                    <option value="sum">Sum a property</option>
                  </select>
                </label>
                <TextField
                  {...(versionErrors.eventType ? { error: versionErrors.eventType } : {})}
                  label="Event type"
                  name="eventType"
                  placeholder="llm.tokens.consumed"
                  required
                />
                <TextField
                  {...(versionErrors.valueProperty ? { error: versionErrors.valueProperty } : {})}
                  hint="Required only for sum aggregation."
                  label="Value property"
                  name="valueProperty"
                  placeholder="tokens"
                />
                <TextField
                  {...(versionErrors.effectiveFrom ? { error: versionErrors.effectiveFrom } : {})}
                  defaultValue={localDateTime(new Date())}
                  label="Effective from"
                  name="effectiveFrom"
                  required
                  type="datetime-local"
                />
                <TextField
                  {...(versionErrors.effectiveTo ? { error: versionErrors.effectiveTo } : {})}
                  label="Effective to (optional)"
                  name="effectiveTo"
                  type="datetime-local"
                />
                <TextField
                  {...(versionErrors.groupByKeys ? { error: versionErrors.groupByKeys } : {})}
                  hint="Up to three comma-separated property keys."
                  label="Group by"
                  name="groupByKeys"
                  placeholder="model, region"
                />
                <label className="grid gap-1.5 text-sm font-semibold" htmlFor="version-filters">
                  Filters JSON
                  <textarea
                    className="min-h-24 border border-mp-border bg-mp-panel p-3 font-mp-mono text-xs"
                    defaultValue="[]"
                    id="version-filters"
                    name="filters"
                  />
                </label>
                {versionFormError ? (
                  <p className="text-sm font-semibold text-mp-danger sm:col-span-2" role="alert">
                    {versionFormError}
                  </p>
                ) : null}
                <Button
                  className="sm:col-span-2"
                  loading={versionMutation.isPending}
                  loadingLabel="Creating version…"
                  type="submit"
                >
                  Create immutable draft version
                </Button>
              </form>
            ) : (
              <p className="text-sm text-mp-ink-muted">
                Create a meter identity before drafting its first version.
              </p>
            )}
          </PanelContent>
        </Panel>
      </div>
      <section aria-labelledby="meter-list-heading" className="mt-8">
        <div className="mb-4">
          <p className="section-kicker">Version registry</p>
          <h2 className="section-title" id="meter-list-heading">
            Meter definitions
          </h2>
        </div>
        {metersQuery.isPending ? (
          <p className="font-mp-display text-2xl font-semibold">Loading meters…</p>
        ) : null}
        {metersQuery.error ? (
          <Notice title="Meters unavailable" tone="danger">
            <p>The meter registry could not be loaded.</p>
          </Notice>
        ) : null}
        {metersQuery.data?.items.length === 0 ? (
          <EmptyState
            className="border border-mp-border bg-mp-panel"
            description={
              <p>Create a meter identity, add a version, test its event match, then publish it.</p>
            }
            title="No meter definitions yet"
          />
        ) : null}
        <div className="space-y-5">
          {metersQuery.data?.items.map((meter) => (
            <article className="border border-mp-border bg-mp-panel" key={meter.id}>
              <header className="flex flex-col gap-4 border-mp-border border-b p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="font-mp-display text-2xl font-semibold">{meter.name}</h3>
                    <StatusBadge tone={meterTone(meter.status)}>{meter.status}</StatusBadge>
                  </div>
                  <p className="mt-1 font-mp-mono text-xs text-mp-ink-muted">{meter.key}</p>
                </div>
                {meter.status !== "archived" ? (
                  <Button
                    onClick={() => {
                      setArchiveTarget(meter.key);
                      setArchiveConfirmation("");
                    }}
                    size="compact"
                    variant="danger"
                  >
                    <ArchiveBoxIcon aria-hidden="true" size={16} />
                    Archive
                  </Button>
                ) : null}
              </header>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[50rem] text-left text-sm">
                  <thead className="font-mp-mono text-[0.625rem] tracking-wider text-mp-ink-muted uppercase">
                    <tr>
                      <th className="px-5 py-3">Version</th>
                      <th className="px-5 py-3">Lifecycle</th>
                      <th className="px-5 py-3">Rule</th>
                      <th className="px-5 py-3">Effective</th>
                      <th className="px-5 py-3">
                        <span className="sr-only">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-mp-border">
                    {meter.versions.map((version) => (
                      <tr key={version.id}>
                        <td className="px-5 py-4 font-mp-mono font-semibold">v{version.version}</td>
                        <td className="px-5 py-4">
                          <StatusBadge tone={version.publishedAt ? "success" : "warning"}>
                            {version.publishedAt ? "published" : "draft"}
                          </StatusBadge>
                        </td>
                        <td className="px-5 py-4">
                          <span className="font-semibold">{version.aggregation}</span>
                          <br />
                          <span className="text-xs text-mp-ink-muted">
                            {version.eventType}
                            {version.valueProperty ? ` · ${version.valueProperty}` : ""}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-xs">
                          {new Intl.DateTimeFormat(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(version.effectiveFrom))}
                        </td>
                        <td className="px-5 py-4 text-right">
                          {!version.publishedAt && meter.status !== "archived" ? (
                            <Button
                              loading={publishMutation.isPending}
                              loadingLabel="Publishing…"
                              onClick={() =>
                                publishMutation.mutate({
                                  meterKey: meter.key,
                                  version: version.version,
                                })
                              }
                              size="compact"
                            >
                              <RocketLaunchIcon aria-hidden="true" size={16} />
                              Publish
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </div>
      </section>
      {archiveTarget ? (
        <section
          aria-labelledby="archive-meter-heading"
          className="fixed inset-0 z-50 grid place-items-center bg-mp-ink/70 p-4"
        >
          <div className="w-full max-w-lg border border-mp-border bg-mp-panel p-6 shadow-mp-raised">
            <h2 className="font-mp-display text-3xl font-semibold" id="archive-meter-heading">
              Archive {archiveTarget}?
            </h2>
            <p className="mt-3 text-sm leading-6 text-mp-ink-muted">
              The meter remains in historical evidence but cannot receive new versions. Type the
              meter key to confirm.
            </p>
            <TextField
              className="mt-5"
              label="Meter key"
              onChange={(event) => setArchiveConfirmation(event.currentTarget.value)}
              value={archiveConfirmation}
            />
            <div className="mt-5 flex justify-end gap-3">
              <Button onClick={() => setArchiveTarget(undefined)} variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={archiveConfirmation !== archiveTarget}
                loading={archiveMutation.isPending}
                loadingLabel="Archiving…"
                onClick={() => archiveMutation.mutate(archiveTarget)}
                variant="danger"
              >
                Archive meter
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
