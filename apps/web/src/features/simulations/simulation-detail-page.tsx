import { Notice, Panel, PanelContent, PanelHeader, PanelTitle, StatusBadge } from "@meterpilot/ui";
import { ArrowLeftIcon, WarningIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { useActiveOrganization } from "../organizations/organization-context";
import { getSimulation, getSimulationResults, simulationKeys } from "./api";

export function SimulationDetailPage() {
  const organization = useActiveOrganization();
  const organizationId = organization.active.organization.id;
  const { simulationId = "" } = useParams();
  const simulationQuery = useQuery({
    enabled: simulationId.length > 0,
    queryFn: () => getSimulation(organizationId, simulationId),
    queryKey: simulationKeys.detail(organizationId, simulationId),
  });
  const resultsQuery = useQuery({
    enabled: simulationQuery.data?.simulation.status === "completed",
    queryFn: () => getSimulationResults(organizationId, simulationId),
    queryKey: simulationKeys.results(organizationId, simulationId),
  });
  if (simulationQuery.isPending)
    return (
      <div className="page-frame">
        <p className="font-mp-display text-2xl font-semibold">Loading simulation…</p>
      </div>
    );
  if (simulationQuery.error)
    return (
      <div className="page-frame">
        <Notice title="Simulation unavailable" tone="danger">
          <p>The requested run could not be loaded.</p>
        </Notice>
      </div>
    );
  const simulation = simulationQuery.data.simulation;
  return (
    <div className="page-frame">
      <Link
        className="inline-flex min-h-11 items-center gap-2 font-semibold underline decoration-mp-signal-strong decoration-2 underline-offset-4"
        to="/simulations"
      >
        <ArrowLeftIcon aria-hidden="true" size={17} />
        Simulations
      </Link>
      <header className="mt-5 border-mp-border border-b pb-7">
        <div className="flex flex-wrap gap-3">
          <p className="section-kicker">Pricing comparison</p>
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
        <h1 className="mt-4 break-all font-mp-display text-[clamp(2.25rem,6vw,4.5rem)] font-semibold">
          {simulation.id}
        </h1>
      </header>
      {simulation.status === "pending" ? (
        <Notice className="mt-6" title="Simulation processing" tone="info">
          <p>The durable worker has not completed this run yet.</p>
        </Notice>
      ) : null}
      {simulation.status === "failed" ? (
        <Notice className="mt-6" title="Simulation failed" tone="danger">
          <p>Failure code: {simulation.failureCode}</p>
        </Notice>
      ) : null}
      {simulation.status === "completed" ? (
        <>
          <section className="mt-6 grid border-mp-border border-t border-l sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Baseline", simulation.summary.baselineTotalMinor],
              ["Candidate", simulation.summary.candidateTotalMinor],
              ["Delta", simulation.summary.deltaMinor],
              ["P95 delta", simulation.summary.p95DeltaMinor],
            ].map(([label, value]) => (
              <div className="border-mp-border border-r border-b bg-mp-panel p-5" key={label}>
                <p className="section-kicker">{label}</p>
                <p className="mt-4 break-all font-mp-display text-3xl font-semibold">{value}</p>
                <p className="mt-1 text-xs text-mp-ink-muted">exact minor units</p>
              </div>
            ))}
          </section>
          <Panel className="mt-6">
            <PanelHeader>
              <PanelTitle as="h2">Customer outliers</PanelTitle>
            </PanelHeader>
            <PanelContent>
              {resultsQuery.error ? (
                <Notice title="Results unavailable" tone="danger">
                  <p>Customer comparisons could not be loaded.</p>
                </Notice>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[48rem] text-left text-sm">
                    <thead>
                      <tr className="font-mp-mono text-xs text-mp-ink-muted">
                        <th className="p-3">Customer</th>
                        <th className="p-3">Baseline</th>
                        <th className="p-3">Candidate</th>
                        <th className="p-3">Delta</th>
                        <th className="p-3">Warnings</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-mp-border">
                      {resultsQuery.data?.items.map((result) => (
                        <tr key={result.id}>
                          <td className="p-3 font-semibold">{result.customerKey}</td>
                          {result.status === "included" ? (
                            <>
                              <td className="p-3">{result.baselineAmountMinor}</td>
                              <td className="p-3">{result.candidateAmountMinor}</td>
                              <td className="p-3">
                                {result.deltaMinor} ({result.deltaPercent ?? "n/a"}%)
                              </td>
                              <td className="p-3">
                                {result.warningFlags.map((flag) => (
                                  <span
                                    className="mr-2 inline-flex items-center gap-1 text-xs text-mp-warning"
                                    key={flag}
                                  >
                                    <WarningIcon aria-hidden="true" size={14} />
                                    {flag}
                                  </span>
                                ))}
                              </td>
                            </>
                          ) : (
                            <td className="p-3 text-mp-danger" colSpan={4}>
                              Excluded · {result.failureCode}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </PanelContent>
          </Panel>
        </>
      ) : null}
    </div>
  );
}
