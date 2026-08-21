import { createSimulationRequestSchema } from "@meterpilot/contracts/simulations";
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
import { ArrowRightIcon, FlaskIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../lib/api/client";
import { queryClient } from "../../lib/query-client";
import { firstFieldErrors } from "../auth/form-errors";
import { catalogKeys, listPlans } from "../catalog/api";
import { useActiveOrganization } from "../organizations/organization-context";
import { createSimulation, listSimulations, simulationKeys } from "./api";

function utcStart(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}
export function SimulationsPage() {
  const organization = useActiveOrganization();
  const organizationId = organization.active.organization.id;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const simulationsQuery = useQuery({
    queryFn: () => listSimulations(organizationId),
    queryKey: simulationKeys.all(organizationId),
  });
  const plansQuery = useQuery({
    queryFn: () => listPlans(organizationId),
    queryKey: catalogKeys.plans(organizationId),
  });
  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof createSimulation>[1]) =>
      createSimulation(organizationId, input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: simulationKeys.all(organizationId) }),
  });
  const versions =
    plansQuery.data?.items.flatMap((plan) =>
      plan.versions
        .filter((version) => version.status === "published")
        .map((version) => ({ id: version.id, label: `${plan.name} v${version.version}` })),
    ) ?? [];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const customerKeys = String(data.get("customerKeys") ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
    const parsed = createSimulationRequestSchema.safeParse({
      baselinePlanVersionId: data.get("baselinePlanVersionId"),
      candidatePlanVersionId: data.get("candidatePlanVersionId"),
      ...(customerKeys.length ? { customerKeys } : {}),
      increaseThresholdPercent: data.get("increaseThresholdPercent"),
      periodEnd: utcStart(String(data.get("periodEnd"))),
      periodStart: utcStart(String(data.get("periodStart"))),
    });
    if (!parsed.success) {
      setErrors(firstFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    mutation.mutate(parsed.data);
  }
  return (
    <div className="page-frame">
      <header className="border-mp-border border-b pb-7">
        <p className="section-kicker">Verification / Pricing safety</p>
        <h1 className="mt-3 font-mp-display text-[clamp(2.75rem,7vw,5.5rem)] leading-[0.9] font-semibold tracking-[-0.045em]">
          Simulations
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-mp-ink-muted">
          Compare two immutable published plan versions against the same customer usage watermark
          before changing production pricing.
        </p>
      </header>
      {mutation.error ? (
        <Notice className="mt-6" title="Simulation not queued" tone="danger">
          <p>
            {mutation.error instanceof ApiError
              ? `${mutation.error.message} Request ID: ${mutation.error.requestId}`
              : "The simulation request failed."}
          </p>
        </Notice>
      ) : null}
      <div className="mt-6 grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
        <Panel>
          <PanelHeader>
            <PanelTitle as="h2">Run comparison</PanelTitle>
          </PanelHeader>
          <PanelContent>
            {versions.length >= 2 ? (
              <form className="grid gap-4" onSubmit={submit}>
                <label className="grid gap-1.5 text-sm font-semibold">
                  Baseline
                  <select
                    className="min-h-11 border border-mp-border bg-mp-panel px-3"
                    name="baselinePlanVersionId"
                  >
                    {versions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {version.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm font-semibold">
                  Candidate
                  <select
                    className="min-h-11 border border-mp-border bg-mp-panel px-3"
                    name="candidatePlanVersionId"
                  >
                    {versions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {version.label}
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
                <TextField
                  {...(errors.increaseThresholdPercent
                    ? { error: errors.increaseThresholdPercent }
                    : {})}
                  defaultValue="20"
                  inputMode="decimal"
                  label="Increase warning threshold (%)"
                  name="increaseThresholdPercent"
                  required
                />
                <TextField
                  {...(errors.customerKeys ? { error: errors.customerKeys } : {})}
                  hint="Leave empty for all eligible customers; otherwise comma-separated."
                  label="Customer keys (optional)"
                  name="customerKeys"
                />
                <Button
                  loading={mutation.isPending}
                  loadingLabel="Queuing simulation…"
                  type="submit"
                >
                  Run simulation
                </Button>
              </form>
            ) : (
              <p className="text-sm text-mp-ink-muted">
                Publish at least two plan versions to compare pricing.
              </p>
            )}
          </PanelContent>
        </Panel>
        <section>
          <p className="section-kicker">Durable runs</p>
          <h2 className="section-title">Simulation history</h2>
          {simulationsQuery.data?.items.length === 0 ? (
            <EmptyState
              className="mt-4 border border-mp-border bg-mp-panel"
              description={
                <p>Queue a comparison after publishing baseline and candidate versions.</p>
              }
              title="No pricing simulations yet"
            />
          ) : (
            <div className="mt-4 space-y-3">
              {simulationsQuery.data?.items.map((simulation) => (
                <article
                  className="grid gap-4 border border-mp-border bg-mp-panel p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center"
                  key={simulation.id}
                >
                  <FlaskIcon aria-hidden="true" size={23} />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mp-mono text-xs font-semibold">{simulation.id}</p>
                      <StatusBadge
                        tone={
                          simulation.status === "completed"
                            ? "success"
                            : simulation.status === "failed"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {simulation.status}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-xs text-mp-ink-muted">
                      {simulation.customerCount} customers · threshold{" "}
                      {simulation.increaseThresholdPercent}%
                      {simulation.status === "completed"
                        ? ` · delta ${simulation.summary.deltaMinor} minor units`
                        : ""}
                    </p>
                  </div>
                  <Link
                    className="inline-grid size-11 place-items-center border border-mp-border hover:bg-mp-paper"
                    to={`/simulations/${simulation.id}`}
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
