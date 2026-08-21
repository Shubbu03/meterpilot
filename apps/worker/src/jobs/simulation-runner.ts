export type SimulationRunResult = Readonly<{ status: "completed" | "not_found" | "terminal" }>;

export type SimulationRunner = Readonly<{
  fail: (
    organizationId: string,
    simulationId: string,
    failureCode: string,
    requestId: string,
  ) => Promise<void>;
  run: (
    organizationId: string,
    simulationId: string,
    requestId: string,
    signal: AbortSignal,
  ) => Promise<SimulationRunResult>;
}>;
