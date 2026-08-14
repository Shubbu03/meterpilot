import { describe, expect, test } from "bun:test";
import type { Meter } from "@opentelemetry/api";

import { createMeterPilotMetrics } from "../src/metrics";

type Measurement = Readonly<{
  attributes: Record<string, unknown> | undefined;
  kind: "add" | "record";
  name: string;
  value: number;
}>;

function recordingMeter(measurements: Measurement[]): Meter {
  return {
    createCounter(name: string) {
      return {
        add(value: number, attributes?: Record<string, unknown>) {
          measurements.push({ attributes, kind: "add", name, value });
        },
      };
    },
    createGauge(name: string) {
      return {
        record(value: number, attributes?: Record<string, unknown>) {
          measurements.push({ attributes, kind: "record", name, value });
        },
      };
    },
    createHistogram(name: string) {
      return {
        record(value: number, attributes?: Record<string, unknown>) {
          measurements.push({ attributes, kind: "record", name, value });
        },
      };
    },
  } as unknown as Meter;
}

describe("MeterPilot metric catalog", () => {
  test("records plan metrics in base units with bounded attributes", () => {
    const measurements: Measurement[] = [];
    const metrics = createMeterPilotMetrics(recordingMeter(measurements));

    metrics.recordEvent("accepted", 2);
    metrics.recordIngestion(150, 25);
    metrics.recordAggregationLag(2_000, 3_000);
    metrics.recordReservation("over_limit", 100);
    metrics.recordJobQueue(4, 10_000);
    metrics.recordFailure("preview");

    expect(measurements).toContainEqual({
      attributes: { outcome: "accepted" },
      kind: "add",
      name: "meterpilot.events",
      value: 2,
    });
    expect(measurements).toContainEqual({
      attributes: undefined,
      kind: "record",
      name: "meterpilot.ingestion.duration",
      value: 0.15,
    });
    expect(measurements).toContainEqual({
      attributes: { basis: "occurred_at" },
      kind: "record",
      name: "meterpilot.aggregation.lag",
      value: 3,
    });
    expect(measurements).toContainEqual({
      attributes: { outcome: "over_limit" },
      kind: "add",
      name: "meterpilot.reservations",
      value: 1,
    });
  });

  test("rejects invalid measurements before recording", () => {
    const measurements: Measurement[] = [];
    const metrics = createMeterPilotMetrics(recordingMeter(measurements));

    expect(() => metrics.recordIngestion(-1, 1)).toThrow("non-negative");
    expect(() => metrics.recordDirtyBucketCount(1.5)).toThrow("safe integer");
    expect(measurements).toHaveLength(0);
  });
});
