import { describe, expect, test } from "bun:test";

import {
  createSimulationRequestSchema,
  MAX_SIMULATION_CUSTOMERS,
  simulationResultSchema,
  simulationListQuerySchema,
  simulationSchema,
} from "../src/simulations";

const BASELINE_ID = "11111111-1111-4111-8111-111111111111";
const CANDIDATE_ID = "22222222-2222-4222-8222-222222222222";

describe("pricing simulation contracts", () => {
  test("normalizes a bounded baseline comparison", () => {
    expect(
      createSimulationRequestSchema.parse({
        baselinePlanVersionId: BASELINE_ID,
        candidatePlanVersionId: CANDIDATE_ID,
        periodEnd: "2026-10-01T00:00:00.000Z",
        periodStart: "2026-09-01T00:00:00.000Z",
      }),
    ).toEqual({
      baselinePlanVersionId: BASELINE_ID,
      candidatePlanVersionId: CANDIDATE_ID,
      increaseThresholdPercent: "20",
      periodEnd: "2026-10-01T00:00:00.000Z",
      periodStart: "2026-09-01T00:00:00.000Z",
    });
  });

  test("rejects duplicate or oversized cohorts and unbounded periods", () => {
    const common = {
      baselinePlanVersionId: BASELINE_ID,
      candidatePlanVersionId: CANDIDATE_ID,
      periodEnd: "2026-10-01T00:00:00.000Z",
      periodStart: "2026-09-01T00:00:00.000Z",
    };

    expect(
      createSimulationRequestSchema.safeParse({
        ...common,
        customerKeys: ["acme", "acme"],
      }).success,
    ).toBe(false);
    expect(
      createSimulationRequestSchema.safeParse({
        ...common,
        customerKeys: Array.from(
          { length: MAX_SIMULATION_CUSTOMERS + 1 },
          (_, index) => `customer_${index}`,
        ),
      }).success,
    ).toBe(false);
    expect(
      createSimulationRequestSchema.safeParse({
        ...common,
        periodEnd: "2027-10-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  test("makes pending, completed, and failed result shapes mutually exclusive", () => {
    const base = {
      baselinePlanVersionId: BASELINE_ID,
      candidatePlanVersionId: CANDIDATE_ID,
      createdAt: "2026-10-01T00:00:00.000Z",
      customerCount: 1,
      id: "33333333-3333-4333-8333-333333333333",
      increaseThresholdPercent: "20",
      inputWatermark: "2026-10-01T00:00:00.000Z",
      periodEnd: "2026-10-01T00:00:00.000Z",
      periodStart: "2026-09-01T00:00:00.000Z",
    };

    expect(
      simulationSchema.parse({
        ...base,
        calculationHash: null,
        completedAt: null,
        failureCode: null,
        status: "pending",
        summary: {},
      }).status,
    ).toBe("pending");
    expect(
      simulationSchema.safeParse({
        ...base,
        calculationHash: null,
        completedAt: null,
        failureCode: null,
        status: "completed",
        summary: {},
      }).success,
    ).toBe(false);
  });

  test("represents invalid customer usage as an explicit exclusion", () => {
    expect(
      simulationResultSchema.parse({
        baselineAmountMinor: null,
        candidateAmountMinor: null,
        customerKey: "acme",
        deltaMinor: null,
        deltaPercent: null,
        explanation: null,
        failureCode: "invalid_usage_value",
        id: "44444444-4444-4444-8444-444444444444",
        status: "excluded",
        warningFlags: [],
      }).status,
    ).toBe("excluded");
  });

  test("normalizes simulation collection filters", () => {
    expect(
      simulationListQuerySchema.parse({
        baselinePlanVersionId: BASELINE_ID,
        limit: "10",
        status: "completed",
      }),
    ).toEqual({
      baselinePlanVersionId: BASELINE_ID,
      limit: 10,
      status: "completed",
    });
  });
});
