import { describe, expect, test } from "bun:test";
import type { WorkerConfig } from "@meterpilot/config/worker";
import { createObservability } from "@meterpilot/observability";

import type { JobRepository } from "../src/jobs/repository";
import { type BootstrapWorkerDependencies, bootstrapWorker } from "../src/runtime/bootstrap";
import type { WorkerRuntimeOptions } from "../src/runtime/worker";

const config: WorkerConfig = {
  claimLimit: 10,
  databaseUrl: "postgresql://meterpilot:meterpilot_local@127.0.0.1:5432/meterpilot",
  leaseDurationMs: 60_000,
  logLevel: "debug",
  maxAttempts: 8,
  nodeEnvironment: "test",
  pollIntervalMs: 1_000,
  retryBaseDelayMs: 1_000,
  retryMaxDelayMs: 300_000,
};

const repository: JobRepository = {
  claim: () => Promise.resolve([]),
  complete: () => Promise.resolve("updated"),
  fail: () => Promise.resolve("updated"),
  inspect: () => Promise.resolve({ depth: 0, oldestAgeMs: 0 }),
  retry: () => Promise.resolve("updated"),
};

function createDependencies(options: {
  close?: () => Promise<void>;
  runWorker?: (runtime: WorkerRuntimeOptions) => Promise<void>;
}) {
  const calls: string[] = [];
  let runtimeOptions: WorkerRuntimeOptions | undefined;
  const databaseClient = {} as never;
  const database = {} as never;
  const dependencies: BootstrapWorkerDependencies = {
    checkDatabaseHealth(client) {
      expect(client).toBe(databaseClient);
      calls.push("health_checked");
      return Promise.resolve();
    },
    createDatabase(databaseUrl) {
      expect(databaseUrl).toBe(config.databaseUrl);
      return {
        client: databaseClient,
        close:
          options.close ??
          (() => {
            calls.push("database_closed");
            return Promise.resolve();
          }),
        db: database,
      };
    },
    createJobRepository(receivedDatabase) {
      expect(receivedDatabase).toBe(database);
      return repository;
    },
    createInvoicePreviewGenerator(receivedDatabase) {
      expect(receivedDatabase).toBe(database);
      return {
        fail: () => Promise.resolve(),
        generate: () => Promise.resolve({ status: "terminal" }),
      };
    },
    createObservability: (observabilityOptions) =>
      createObservability({ ...observabilityOptions, write: () => undefined }),
    createQuotaReservationExpirer(receivedDatabase) {
      expect(receivedDatabase).toBe(database);
      return {
        expire: () => Promise.resolve({ status: "terminal" }),
      };
    },
    createRetentionEnforcer(receivedDatabase) {
      expect(receivedDatabase).toBe(database);
      return {
        enforce: () => Promise.resolve({ redactedCount: 0, status: "enforced" }),
      };
    },
    createSimulationRunner(receivedDatabase) {
      expect(receivedDatabase).toBe(database);
      return {
        fail: () => Promise.resolve(),
        run: () => Promise.resolve({ status: "terminal" }),
      };
    },
    createSubscriptionEntitlementRefresher(receivedDatabase) {
      expect(receivedDatabase).toBe(database);
      return {
        refresh: () => Promise.resolve({ status: "terminal" }),
      };
    },
    createUsageAggregateRebuilder(receivedDatabase, receivedProcessor) {
      expect(receivedDatabase).toBe(database);
      expect(receivedProcessor.process).toBeFunction();
      return {
        rebuild: () => Promise.resolve({ eventCount: 0, status: "rebuilt" }),
      };
    },
    createUsageEventProcessor(receivedDatabase) {
      expect(receivedDatabase).toBe(database);
      return {
        process: () =>
          Promise.resolve({
            bucketCount: 0,
            occurredAt: new Date("2026-08-20T00:00:00.000Z"),
            receivedAt: new Date("2026-08-20T00:00:00.000Z"),
            status: "processed",
          }),
      };
    },
    createWorkerId: () => "worker-test",
    parseWorkerConfig: () => config,
    runWorker(runtime) {
      runtimeOptions = runtime;
      calls.push("worker_started");
      return options.runWorker?.(runtime) ?? Promise.resolve();
    },
  };

  return { calls, dependencies, runtimeOptions: () => runtimeOptions };
}

describe("worker bootstrap", () => {
  test("composes configuration, database, handler registry, and runtime", async () => {
    const setup = createDependencies({});

    await bootstrapWorker(new AbortController().signal, setup.dependencies);

    expect(setup.calls).toEqual(["health_checked", "worker_started", "database_closed"]);
    expect(setup.runtimeOptions()?.config).toBe(config);
    expect(setup.runtimeOptions()?.repository).toBe(repository);
    expect(setup.runtimeOptions()?.workerId).toBe("worker-test");
  });

  test("closes the database when runtime execution fails", async () => {
    const runtimeError = new Error("runtime failed");
    const setup = createDependencies({
      runWorker: () => Promise.reject(runtimeError),
    });

    await expect(bootstrapWorker(new AbortController().signal, setup.dependencies)).rejects.toBe(
      runtimeError,
    );
    expect(setup.calls).toContain("database_closed");
  });

  test("preserves runtime and cleanup failures", async () => {
    const runtimeError = new Error("runtime failed");
    const closeError = new Error("close failed");
    const setup = createDependencies({
      close: () => Promise.reject(closeError),
      runWorker: () => Promise.reject(runtimeError),
    });

    try {
      await bootstrapWorker(new AbortController().signal, setup.dependencies);
      throw new Error("Expected bootstrap failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([runtimeError, closeError]);
    }
  });
});
