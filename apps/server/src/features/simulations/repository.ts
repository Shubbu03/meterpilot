import type {
  CreateSimulationRequest,
  Simulation,
  SimulationListQuery,
  SimulationResult,
  SimulationResultListQuery,
} from "@meterpilot/contracts/simulations";

import type { PageResult, TenantAuthorization } from "../organizations/repository";

export type SimulationMutationResult =
  | Readonly<{ jobId: string; simulation: Simulation; status: "ok" }>
  | Readonly<{ status: "conflict" | "forbidden" | "not_found" }>;

export class SimulationNotReadyError extends Error {
  constructor() {
    super("Simulation results are available only after the run completes successfully.");
    this.name = "SimulationNotReadyError";
  }
}

export class InvalidSimulationCursorError extends Error {
  override readonly name = "InvalidSimulationCursorError";

  constructor() {
    super("The pagination cursor is invalid.");
  }
}

export type SimulationRepository = Readonly<{
  create: (
    tenant: TenantAuthorization,
    input: CreateSimulationRequest,
    requestId: string,
  ) => Promise<SimulationMutationResult>;
  find: (tenant: TenantAuthorization, simulationId: string) => Promise<Simulation | null>;
  list: (
    tenant: TenantAuthorization,
    query: SimulationListQuery,
  ) => Promise<PageResult<Simulation>>;
  listResults: (
    tenant: TenantAuthorization,
    simulationId: string,
    page: SimulationResultListQuery,
  ) => Promise<PageResult<SimulationResult> | null>;
  report: (
    tenant: TenantAuthorization,
    simulationId: string,
  ) => Promise<Readonly<{ results: readonly SimulationResult[]; simulation: Simulation }> | null>;
}>;
