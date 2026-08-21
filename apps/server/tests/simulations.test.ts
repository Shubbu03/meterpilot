import { describe, expect, test } from "bun:test";
import type { Simulation, SimulationResult } from "@meterpilot/contracts/simulations";
import { createObservability } from "@meterpilot/observability";

import type { AuthGateway } from "../src/features/identity/authentication";
import {
  SimulationNotReadyError,
  type SimulationRepository,
} from "../src/features/simulations/repository";
import { createApp } from "../src/http/app";
import {
  createApiKeyServiceStub,
  createCatalogRepositoryStub,
  createCustomerRepositoryStub,
  createEntitlementRepositoryStub,
  createEventServiceStub,
  createMeterRepositoryStub,
  createOrganizationRepositoryStub,
  createSimulationRepositoryStub,
  createUsageRepositoryStub,
} from "./helpers";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SIMULATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BASELINE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CANDIDATE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CREATED_AT = "2026-10-01T00:00:00.000Z";

const pendingSimulation: Simulation = {
  baselinePlanVersionId: BASELINE_ID,
  calculationHash: null,
  candidatePlanVersionId: CANDIDATE_ID,
  completedAt: null,
  createdAt: CREATED_AT,
  customerCount: 1,
  failureCode: null,
  id: SIMULATION_ID,
  increaseThresholdPercent: "20",
  inputWatermark: CREATED_AT,
  periodEnd: CREATED_AT,
  periodStart: "2026-09-01T00:00:00.000Z",
  status: "pending",
  summary: {},
};

const completedSimulation: Simulation = {
  ...pendingSimulation,
  calculationHash: "a".repeat(64),
  completedAt: CREATED_AT,
  failureCode: null,
  status: "completed",
  summary: {
    baselineTotalMinor: "1000",
    candidateTotalMinor: "1200",
    customerCount: 1,
    decreasedCount: 0,
    deltaMinor: "200",
    excludedCount: 0,
    increasedCount: 1,
    increaseThresholdCount: 1,
    medianDeltaMinor: "200",
    p95DeltaMinor: "200",
    unchangedCount: 0,
  },
};

const result: SimulationResult = {
  baselineAmountMinor: "1000",
  candidateAmountMinor: "1200",
  customerKey: "acme",
  deltaMinor: "200",
  deltaPercent: "20",
  explanation: { baseline: [], candidate: [] },
  failureCode: null,
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  status: "included",
  warningFlags: ["increase_threshold"],
};

function createSimulationTestApp(repository: SimulationRepository) {
  const membership = {
    createdAt: CREATED_AT,
    role: "owner" as const,
    user: { email: "owner@example.com", id: USER_ID, name: "Owner" },
  };
  const auth: AuthGateway = {
    getSession: () => Promise.resolve({ session: { id: "session" }, user: membership.user }),
    handler: () => Promise.resolve(new Response("auth")),
  };

  return createApp({
    apiKeyService: createApiKeyServiceStub(),
    auth,
    catalogRepository: createCatalogRepositoryStub(),
    checkDatabaseHealth: () => Promise.resolve(),
    customerRepository: createCustomerRepositoryStub(),
    entitlementRepository: createEntitlementRepositoryStub(),
    eventService: createEventServiceStub(),
    meterRepository: createMeterRepositoryStub(),
    observability: createObservability({
      environment: "test",
      level: "error",
      service: "meterpilot-server",
      write: () => undefined,
    }),
    organizationRepository: createOrganizationRepositoryStub({
      resolveTenant: () =>
        Promise.resolve({
          actorUserId: USER_ID,
          membership,
          organization: {
            createdAt: CREATED_AT,
            defaultTimezone: "UTC",
            id: ORGANIZATION_ID,
            name: "Acme",
            slug: "acme",
          },
        }),
    }),
    simulationRepository: repository,
    usageRepository: createUsageRepositoryStub(),
  });
}

describe("pricing simulation routes", () => {
  test("accepts a durable, tenant-scoped simulation request", async () => {
    let receivedInput: unknown;
    const jobId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const app = createSimulationTestApp(
      createSimulationRepositoryStub({
        create(_tenant, input) {
          receivedInput = input;
          return Promise.resolve({ jobId, simulation: pendingSimulation, status: "ok" });
        },
      }),
    );
    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/simulations`, {
      body: JSON.stringify({
        baselinePlanVersionId: BASELINE_ID,
        candidatePlanVersionId: CANDIDATE_ID,
        periodEnd: CREATED_AT,
        periodStart: pendingSimulation.periodStart,
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
        "X-Request-Id": "simulation-request",
      },
      method: "POST",
    });

    expect(response.status).toBe(202);
    expect(receivedInput).toMatchObject({ increaseThresholdPercent: "20" });
    expect(await response.json()).toEqual({
      jobId,
      requestId: "simulation-request",
      simulation: pendingSimulation,
    });
  });

  test("lists private simulation runs newest first with filters and pagination", async () => {
    let receivedQuery: unknown;
    const app = createSimulationTestApp(
      createSimulationRepositoryStub({
        list(_tenant, query) {
          receivedQuery = query;
          return Promise.resolve({ items: [completedSimulation], nextCursor: "next" });
        },
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/simulations?limit=10&status=completed&baselinePlanVersionId=${BASELINE_ID}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(receivedQuery).toEqual({
      baselinePlanVersionId: BASELINE_ID,
      limit: 10,
      status: "completed",
    });
    expect(await response.json()).toEqual({
      items: [completedSimulation],
      nextCursor: "next",
    });
  });

  test("returns completed customer deltas with cursor pagination", async () => {
    let receivedQuery: unknown;
    const app = createSimulationTestApp(
      createSimulationRepositoryStub({
        listResults(_tenant, _simulationId, query) {
          receivedQuery = query;
          return Promise.resolve({ items: [result], nextCursor: null });
        },
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/simulations/${SIMULATION_ID}/customers?limit=10&outcome=increased&warningFlag=increase_threshold`,
    );

    expect(response.status).toBe(200);
    expect(receivedQuery).toEqual({
      limit: 10,
      outcome: "increased",
      warningFlag: "increase_threshold",
    });
    expect(await response.json()).toEqual({ items: [result], nextCursor: null });
  });

  test("downloads private JSON and CSV reports only after completion", async () => {
    const repository = createSimulationRepositoryStub({
      report: () => Promise.resolve({ results: [result], simulation: completedSimulation }),
    });
    const app = createSimulationTestApp(repository);
    const json = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/simulations/${SIMULATION_ID}/report?format=json`,
    );
    const csv = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/simulations/${SIMULATION_ID}/report?format=csv`,
    );

    expect(json.status).toBe(200);
    expect(json.headers.get("Cache-Control")).toBe("no-store");
    expect(await json.json()).toEqual({ results: [result], simulation: completedSimulation });
    expect(csv.headers.get("Content-Type")).toContain("text/csv");
    expect(await csv.text()).toContain(
      '"acme","included","1000","1200","200","20","","increase_threshold"',
    );
  });

  test("reports unfinished results as a stable conflict instead of an empty report", async () => {
    const app = createSimulationTestApp(
      createSimulationRepositoryStub({
        report: () => Promise.reject(new SimulationNotReadyError()),
      }),
    );
    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/simulations/${SIMULATION_ID}/report?format=json`,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "conflict" } });
  });

  test("rejects an excessive simulation period before repository access", async () => {
    let calls = 0;
    const app = createSimulationTestApp(
      createSimulationRepositoryStub({
        create: () => {
          calls++;
          return Promise.resolve({ status: "forbidden" });
        },
      }),
    );
    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/simulations`, {
      body: JSON.stringify({
        baselinePlanVersionId: BASELINE_ID,
        candidatePlanVersionId: CANDIDATE_ID,
        periodEnd: "2028-01-01T00:00:00.000Z",
        periodStart: "2026-01-01T00:00:00.000Z",
      }),
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(calls).toBe(0);
  });
});
