import type { Counter, Gauge, Histogram, Meter } from "@opentelemetry/api";

export type EventOutcome = "accepted" | "conflicted" | "duplicated" | "rejected";
export type ReservationOutcome =
  | "committed"
  | "conflict"
  | "expired"
  | "over_limit"
  | "released"
  | "reserved";
export type DatabaseContentionOutcome = "deadlock" | "retry";
export type FailedOperation = "export" | "preview";

export type MeterPilotMetrics = Readonly<{
  recordAggregationLag: (receivedLagMs: number, occurredLagMs: number) => void;
  recordBucketRebuild: (durationMs: number) => void;
  recordDatabaseContention: (outcome: DatabaseContentionOutcome, count?: number) => void;
  recordDatabasePoolWait: (durationMs: number) => void;
  recordDirtyBucketCount: (count: number) => void;
  recordEntitlementCheck: (durationMs: number) => void;
  recordEvent: (outcome: EventOutcome, count?: number) => void;
  recordFailure: (operation: FailedOperation, count?: number) => void;
  recordIngestion: (durationMs: number, batchSize: number) => void;
  recordJobQueue: (depth: number, oldestAgeMs: number) => void;
  recordLateUsage: (kind: "adjustment" | "late_event", count?: number) => void;
  recordReconciliationDrift: (count: number, magnitude: number) => void;
  recordRetention: (count: number) => void;
  recordReservation: (outcome: ReservationOutcome, durationMs: number) => void;
  recordSimulation: (queueMs: number, computeMs: number) => void;
}>;

type Instruments = Readonly<{
  aggregationLag: Histogram;
  bucketRebuildDuration: Histogram;
  databaseContention: Counter;
  databasePoolWait: Histogram;
  dirtyBucketCount: Gauge;
  entitlementCheckDuration: Histogram;
  events: Counter;
  failures: Counter;
  ingestionBatchSize: Histogram;
  ingestionDuration: Histogram;
  jobQueueDepth: Gauge;
  lateUsage: Counter;
  oldestJobAge: Gauge;
  reconciliationDriftCount: Counter;
  reconciliationDriftMagnitude: Histogram;
  retentionRedacted: Counter;
  reservationDuration: Histogram;
  reservations: Counter;
  simulationComputeDuration: Histogram;
  simulationQueueDuration: Histogram;
}>;

function nonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a finite non-negative number.`);
  }
  return value;
}

function count(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
  return value;
}

function seconds(milliseconds: number, field: string): number {
  return nonNegative(milliseconds, field) / 1000;
}

function createInstruments(meter: Meter): Instruments {
  return {
    aggregationLag: meter.createHistogram("meterpilot.aggregation.lag", {
      description: "Lag between accepted usage and aggregate visibility.",
      unit: "s",
    }),
    bucketRebuildDuration: meter.createHistogram("meterpilot.aggregation.bucket_rebuild.duration", {
      description: "Duration of dirty usage bucket rebuilds.",
      unit: "s",
    }),
    databaseContention: meter.createCounter("meterpilot.database.contention", {
      description: "Database transaction retries and deadlocks.",
      unit: "{event}",
    }),
    databasePoolWait: meter.createHistogram("meterpilot.database.pool_wait.duration", {
      description: "Time spent waiting for a database connection.",
      unit: "s",
    }),
    dirtyBucketCount: meter.createGauge("meterpilot.aggregation.dirty_buckets", {
      description: "Current dirty usage bucket count.",
      unit: "{bucket}",
    }),
    entitlementCheckDuration: meter.createHistogram("meterpilot.entitlement.check.duration", {
      description: "Entitlement evaluation duration.",
      unit: "s",
    }),
    events: meter.createCounter("meterpilot.events", {
      description: "Usage events by ingestion outcome.",
      unit: "{event}",
    }),
    failures: meter.createCounter("meterpilot.operation.failures", {
      description: "Invoice preview and export failures.",
      unit: "{failure}",
    }),
    ingestionBatchSize: meter.createHistogram("meterpilot.ingestion.batch_size", {
      description: "Number of events per ingestion request.",
      unit: "{event}",
    }),
    ingestionDuration: meter.createHistogram("meterpilot.ingestion.duration", {
      description: "Durable ingestion request duration.",
      unit: "s",
    }),
    jobQueueDepth: meter.createGauge("meterpilot.jobs.queue_depth", {
      description: "Current durable job queue depth.",
      unit: "{job}",
    }),
    lateUsage: meter.createCounter("meterpilot.usage.late", {
      description: "Late usage events and resulting adjustments.",
      unit: "{event}",
    }),
    oldestJobAge: meter.createGauge("meterpilot.jobs.oldest_age", {
      description: "Age of the oldest unprocessed durable job.",
      unit: "s",
    }),
    reconciliationDriftCount: meter.createCounter("meterpilot.reconciliation.drift", {
      description: "Detected reconciliation drift items.",
      unit: "{item}",
    }),
    reconciliationDriftMagnitude: meter.createHistogram(
      "meterpilot.reconciliation.drift_magnitude",
      {
        description: "Absolute magnitude of detected reconciliation drift.",
        unit: "1",
      },
    ),
    retentionRedacted: meter.createCounter("meterpilot.retention.properties_redacted", {
      description: "Raw usage-event property objects removed by retention enforcement.",
      unit: "{event}",
    }),
    reservationDuration: meter.createHistogram("meterpilot.reservation.duration", {
      description: "Quota reservation operation duration.",
      unit: "s",
    }),
    reservations: meter.createCounter("meterpilot.reservations", {
      description: "Quota reservation outcomes.",
      unit: "{operation}",
    }),
    simulationComputeDuration: meter.createHistogram("meterpilot.simulation.compute.duration", {
      description: "Pricing simulation compute duration.",
      unit: "s",
    }),
    simulationQueueDuration: meter.createHistogram("meterpilot.simulation.queue.duration", {
      description: "Pricing simulation queue duration.",
      unit: "s",
    }),
  };
}

export function createMeterPilotMetrics(meter: Meter): MeterPilotMetrics {
  const instruments = createInstruments(meter);

  return Object.freeze({
    recordAggregationLag(receivedLagMs, occurredLagMs) {
      instruments.aggregationLag.record(seconds(receivedLagMs, "receivedLagMs"), {
        basis: "received_at",
      });
      instruments.aggregationLag.record(seconds(occurredLagMs, "occurredLagMs"), {
        basis: "occurred_at",
      });
    },
    recordBucketRebuild(durationMs) {
      instruments.bucketRebuildDuration.record(seconds(durationMs, "durationMs"));
    },
    recordDatabaseContention(outcome, value = 1) {
      instruments.databaseContention.add(count(value, "count"), { outcome });
    },
    recordDatabasePoolWait(durationMs) {
      instruments.databasePoolWait.record(seconds(durationMs, "durationMs"));
    },
    recordDirtyBucketCount(value) {
      instruments.dirtyBucketCount.record(count(value, "count"));
    },
    recordEntitlementCheck(durationMs) {
      instruments.entitlementCheckDuration.record(seconds(durationMs, "durationMs"));
    },
    recordEvent(outcome, value = 1) {
      instruments.events.add(count(value, "count"), { outcome });
    },
    recordFailure(operation, value = 1) {
      instruments.failures.add(count(value, "count"), { operation });
    },
    recordIngestion(durationMs, batchSize) {
      instruments.ingestionDuration.record(seconds(durationMs, "durationMs"));
      instruments.ingestionBatchSize.record(count(batchSize, "batchSize"));
    },
    recordJobQueue(depth, oldestAgeMs) {
      instruments.jobQueueDepth.record(count(depth, "depth"));
      instruments.oldestJobAge.record(seconds(oldestAgeMs, "oldestAgeMs"));
    },
    recordLateUsage(kind, value = 1) {
      instruments.lateUsage.add(count(value, "count"), { kind });
    },
    recordReconciliationDrift(value, magnitude) {
      instruments.reconciliationDriftCount.add(count(value, "count"));
      instruments.reconciliationDriftMagnitude.record(nonNegative(magnitude, "magnitude"));
    },
    recordRetention(value) {
      instruments.retentionRedacted.add(count(value, "count"));
    },
    recordReservation(outcome, durationMs) {
      instruments.reservations.add(1, { outcome });
      instruments.reservationDuration.record(seconds(durationMs, "durationMs"), { outcome });
    },
    recordSimulation(queueMs, computeMs) {
      instruments.simulationQueueDuration.record(seconds(queueMs, "queueMs"));
      instruments.simulationComputeDuration.record(seconds(computeMs, "computeMs"));
    },
  });
}
