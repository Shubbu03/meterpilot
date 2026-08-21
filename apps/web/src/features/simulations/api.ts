import {
  type CreateSimulationRequest,
  createSimulationRequestSchema,
  simulationListResponseSchema,
  simulationMutationResponseSchema,
  simulationResponseSchema,
  simulationResultListResponseSchema,
} from "@meterpilot/contracts/simulations";
import { apiClient } from "../../lib/api/client";
export const simulationKeys = {
  all: (organizationId: string) => ["organizations", organizationId, "simulations"] as const,
  detail: (organizationId: string, simulationId: string) =>
    ["organizations", organizationId, "simulations", simulationId] as const,
  results: (organizationId: string, simulationId: string) =>
    ["organizations", organizationId, "simulations", simulationId, "results"] as const,
};
const base = (organizationId: string) =>
  `/v1/organizations/${encodeURIComponent(organizationId)}/simulations`;
export function listSimulations(organizationId: string) {
  return apiClient.request(`${base(organizationId)}?limit=100`, simulationListResponseSchema);
}
export function createSimulation(organizationId: string, input: CreateSimulationRequest) {
  return apiClient.request(base(organizationId), simulationMutationResponseSchema, {
    json: createSimulationRequestSchema.parse(input),
    method: "POST",
  });
}
export function getSimulation(organizationId: string, simulationId: string) {
  return apiClient.request(
    `${base(organizationId)}/${encodeURIComponent(simulationId)}`,
    simulationResponseSchema,
  );
}
export function getSimulationResults(organizationId: string, simulationId: string) {
  return apiClient.request(
    `${base(organizationId)}/${encodeURIComponent(simulationId)}/customers?limit=100`,
    simulationResultListResponseSchema,
  );
}
