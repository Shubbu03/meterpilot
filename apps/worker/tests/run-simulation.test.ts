import { describe, expect, test } from "bun:test";
import { SIMULATION_RUN_JOB_TYPE } from "@meterpilot/db/schema";
import type { MeterPilotMetrics } from "@meterpilot/observability";

import { compareSimulationAmounts } from "../src/jobs/drizzle-simulation-runner";
import { permanentJobError } from "../src/jobs/errors";
import { createRunSimulationHandler } from "../src/jobs/run-simulation";

const SIMULATION_ID = "11111111-1111-4111-8111-111111111111";

function job() {
  return {
    attemptCount: 1,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    id: "22222222-2222-4222-8222-222222222222",
    leaseExpiresAt: new Date("2026-10-01T00:01:00.000Z"),
    organizationId: "33333333-3333-4333-8333-333333333333",
    payload: { requestId: "simulation-request", simulationId: SIMULATION_ID },
    resourceId: SIMULATION_ID,
    resourceType: "simulation",
    type: SIMULATION_RUN_JOB_TYPE,
  };
}

function metrics(record: (queueMs: number, computeMs: number) => void): MeterPilotMetrics {
  return { recordSimulation: record } as MeterPilotMetrics;
}

describe("run pricing simulation handler", () => {
  test("dispatches trusted metadata and records separate queue and compute durations", async () => {
    let received: readonly unknown[] = [];
    const measurements: number[][] = [];
    let timer = 100;
    const handler = createRunSimulationHandler({
      clock: () => new Date("2026-10-01T00:00:04.000Z").getTime(),
      metrics: metrics((...values) => measurements.push(values)),
      runner: {
        fail: () => Promise.resolve(),
        run(...input) {
          received = input;
          return Promise.resolve({ status: "completed" });
        },
      },
      timer: () => {
        const current = timer;
        timer += 25;
        return current;
      },
    });

    await handler.handle(job(), { signal: new AbortController().signal });

    expect(received.slice(0, 3)).toEqual([
      "33333333-3333-4333-8333-333333333333",
      SIMULATION_ID,
      "simulation-request",
    ]);
    expect(measurements).toEqual([[4_000, 25]]);
  });

  test("rejects tampered resource identity before invoking the runner", async () => {
    let calls = 0;
    const handler = createRunSimulationHandler({
      metrics: metrics(() => undefined),
      runner: {
        fail: () => Promise.resolve(),
        run: () => {
          calls++;
          return Promise.resolve({ status: "completed" });
        },
      },
    });

    await expect(
      handler.handle(
        { ...job(), resourceId: "44444444-4444-4444-8444-444444444444" },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: "invalid_job_payload", retryable: false });
    expect(calls).toBe(0);
  });

  test("persists a stable terminal failure code", async () => {
    let failedWith: string | undefined;
    const handler = createRunSimulationHandler({
      metrics: metrics(() => undefined),
      runner: {
        fail(_organizationId, _simulationId, failureCode) {
          failedWith = failureCode;
          return Promise.resolve();
        },
        run: () => {
          throw permanentJobError("invalid_plan_version", "Stored pricing input is invalid.");
        },
      },
    });

    await expect(
      handler.handle(job(), { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "invalid_plan_version", retryable: false });
    expect(failedWith).toBe("invalid_plan_version");
  });
});

describe("simulation amount comparison", () => {
  test("baseline-versus-baseline always produces an exact zero delta", () => {
    const comparison = compareSimulationAmounts(
      { totalMinor: "12345" },
      { totalMinor: "12345" },
      "20",
    );

    expect(comparison.delta.toFixed(0)).toBe("0");
    expect(comparison.deltaPercent).toBe("0");
    expect(comparison.warnings).toEqual([]);
  });

  test("flags zero baselines and configured increase thresholds", () => {
    expect(
      compareSimulationAmounts({ totalMinor: "0" }, { totalMinor: "100" }, "20").warnings,
    ).toEqual(["baseline_zero_candidate_positive"]);
    expect(
      compareSimulationAmounts({ totalMinor: "100" }, { totalMinor: "120" }, "20").warnings,
    ).toEqual(["increase_threshold"]);
  });
});
