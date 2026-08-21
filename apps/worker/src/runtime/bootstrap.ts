import { parseWorkerConfig, type WorkerConfig } from "@meterpilot/config/worker";
import { checkDatabaseHealth, createDatabase, type Database } from "@meterpilot/db";
import {
  createObservability,
  type Observability,
  type ObservabilityOptions,
} from "@meterpilot/observability";

import { createJobDispatcher } from "../jobs/dispatcher";
import { createDrizzleJobRepository } from "../jobs/drizzle-repository";
import { createDrizzleQuotaReservationExpirer } from "../jobs/drizzle-quota-reservation-expirer";
import { createDrizzleUsageEventProcessor } from "../jobs/drizzle-usage-event-processor";
import { createDrizzleUsageAggregateRebuilder } from "../jobs/drizzle-usage-aggregate-rebuilder";
import { createDrizzleSubscriptionEntitlementRefresher } from "../jobs/drizzle-subscription-entitlement-refresher";
import { createDrizzleInvoicePreviewGenerator } from "../jobs/drizzle-invoice-preview-generator";
import { createDrizzleSimulationRunner } from "../jobs/drizzle-simulation-runner";
import { createDrizzleBillingExportGenerator } from "../jobs/drizzle-billing-export-generator";
import { createDrizzleReconciliationRunner } from "../jobs/drizzle-reconciliation-runner";
import { createDrizzleRetentionEnforcer } from "../jobs/drizzle-retention-enforcer";
import { createProcessUsageEventHandler } from "../jobs/process-usage-event";
import { createExpireQuotaReservationHandler } from "../jobs/expire-quota-reservation";
import { createRebuildUsageAggregatesHandler } from "../jobs/rebuild-usage-aggregates";
import { createRefreshSubscriptionEntitlementsHandler } from "../jobs/refresh-subscription-entitlements";
import { createGenerateInvoicePreviewHandler } from "../jobs/generate-invoice-preview";
import { createRunSimulationHandler } from "../jobs/run-simulation";
import { createGenerateBillingExportHandler } from "../jobs/generate-billing-export";
import { createRunReconciliationHandler } from "../jobs/run-reconciliation";
import { createEnforceRetentionHandler } from "../jobs/enforce-retention";
import type { JobRepository } from "../jobs/repository";
import type { QuotaReservationExpirer } from "../jobs/quota-reservation-expirer";
import type { UsageEventProcessor } from "../jobs/usage-event-processor";
import type { UsageAggregateRebuilder } from "../jobs/usage-aggregate-rebuilder";
import type { SubscriptionEntitlementRefresher } from "../jobs/subscription-entitlement-refresher";
import type { InvoicePreviewGenerator } from "../jobs/invoice-preview-generator";
import type { SimulationRunner } from "../jobs/simulation-runner";
import type { BillingExportGenerator } from "../jobs/billing-export-generator";
import type { ReconciliationRunner } from "../jobs/reconciliation-runner";
import type { RetentionEnforcer } from "../jobs/retention-enforcer";
import { runWorker, type WorkerRuntimeOptions } from "./worker";

const SERVICE_NAME = "meterpilot-worker";

type RuntimeDatabase = Pick<Database, "client" | "close" | "db">;

export type BootstrapWorkerDependencies = Readonly<{
  checkDatabaseHealth: (client: RuntimeDatabase["client"]) => Promise<void>;
  createDatabase: (databaseUrl: string) => RuntimeDatabase;
  createBillingExportGenerator?: (database: RuntimeDatabase["db"]) => BillingExportGenerator;
  createJobRepository: (database: RuntimeDatabase["db"]) => JobRepository;
  createInvoicePreviewGenerator: (database: RuntimeDatabase["db"]) => InvoicePreviewGenerator;
  createObservability: (options: ObservabilityOptions) => Observability;
  createQuotaReservationExpirer: (database: RuntimeDatabase["db"]) => QuotaReservationExpirer;
  createReconciliationRunner?: (database: RuntimeDatabase["db"]) => ReconciliationRunner;
  createRetentionEnforcer: (database: RuntimeDatabase["db"]) => RetentionEnforcer;
  createSimulationRunner: (database: RuntimeDatabase["db"]) => SimulationRunner;
  createSubscriptionEntitlementRefresher: (
    database: RuntimeDatabase["db"],
  ) => SubscriptionEntitlementRefresher;
  createUsageAggregateRebuilder: (
    database: RuntimeDatabase["db"],
    processor: UsageEventProcessor,
  ) => UsageAggregateRebuilder;
  createUsageEventProcessor: (database: RuntimeDatabase["db"]) => UsageEventProcessor;
  createWorkerId: () => string;
  parseWorkerConfig: () => WorkerConfig;
  runWorker: (options: WorkerRuntimeOptions) => Promise<void>;
}>;

const defaultDependencies: BootstrapWorkerDependencies = {
  checkDatabaseHealth,
  createBillingExportGenerator: createDrizzleBillingExportGenerator,
  createDatabase,
  createJobRepository: createDrizzleJobRepository,
  createInvoicePreviewGenerator: createDrizzleInvoicePreviewGenerator,
  createObservability,
  createQuotaReservationExpirer: createDrizzleQuotaReservationExpirer,
  createReconciliationRunner: createDrizzleReconciliationRunner,
  createRetentionEnforcer: createDrizzleRetentionEnforcer,
  createSimulationRunner: createDrizzleSimulationRunner,
  createSubscriptionEntitlementRefresher: createDrizzleSubscriptionEntitlementRefresher,
  createUsageAggregateRebuilder: createDrizzleUsageAggregateRebuilder,
  createUsageEventProcessor: createDrizzleUsageEventProcessor,
  createWorkerId: () => `worker-${process.pid}-${crypto.randomUUID()}`,
  parseWorkerConfig,
  runWorker,
};

export async function bootstrapWorker(
  signal: AbortSignal,
  dependencies: BootstrapWorkerDependencies = defaultDependencies,
): Promise<void> {
  const config = dependencies.parseWorkerConfig();
  const observability = dependencies.createObservability({
    environment: config.nodeEnvironment,
    level: config.logLevel,
    service: SERVICE_NAME,
  });
  const database = dependencies.createDatabase(config.databaseUrl);

  let runtimeFailure: Readonly<{ error: unknown }> | null = null;

  try {
    await dependencies.checkDatabaseHealth(database.client);
    const repository = dependencies.createJobRepository(database.db);
    const previewGenerator = dependencies.createInvoicePreviewGenerator(database.db);
    const expirer = dependencies.createQuotaReservationExpirer(database.db);
    const processor = dependencies.createUsageEventProcessor(database.db);
    const subscriptionEntitlementRefresher = dependencies.createSubscriptionEntitlementRefresher(
      database.db,
    );
    const simulationRunner = dependencies.createSimulationRunner(database.db);
    const billingExportGenerator = dependencies.createBillingExportGenerator?.(database.db);
    const reconciliationRunner = dependencies.createReconciliationRunner?.(database.db);
    const retentionEnforcer = dependencies.createRetentionEnforcer(database.db);
    const rebuilder = dependencies.createUsageAggregateRebuilder(database.db, processor);
    const dispatcher = createJobDispatcher([
      createExpireQuotaReservationHandler({ expirer, metrics: observability.metrics }),
      createGenerateInvoicePreviewHandler({
        generator: previewGenerator,
        metrics: observability.metrics,
      }),
      createProcessUsageEventHandler({ metrics: observability.metrics, processor }),
      createRefreshSubscriptionEntitlementsHandler({
        refresher: subscriptionEntitlementRefresher,
      }),
      createEnforceRetentionHandler({
        enforcer: retentionEnforcer,
        metrics: observability.metrics,
      }),
      createRebuildUsageAggregatesHandler({ metrics: observability.metrics, rebuilder }),
      createRunSimulationHandler({ metrics: observability.metrics, runner: simulationRunner }),
      ...(reconciliationRunner
        ? [
            createRunReconciliationHandler({
              metrics: observability.metrics,
              runner: reconciliationRunner,
            }),
          ]
        : []),
      ...(billingExportGenerator
        ? [
            createGenerateBillingExportHandler({
              generator: billingExportGenerator,
              metrics: observability.metrics,
            }),
          ]
        : []),
    ]);

    await dependencies.runWorker({
      config,
      dispatcher,
      observability,
      repository,
      signal,
      workerId: dependencies.createWorkerId(),
    });
  } catch (error) {
    observability.logger.error("worker_runtime_failed", { error });
    runtimeFailure = { error };
  }

  try {
    await database.close();
    observability.logger.info("worker_database_closed");
  } catch (closeError) {
    observability.logger.error("worker_database_close_failed", { error: closeError });
    if (runtimeFailure) {
      throw new AggregateError(
        [runtimeFailure.error, closeError],
        "Worker runtime and database cleanup failed.",
      );
    }
    throw closeError;
  }

  if (runtimeFailure) {
    throw runtimeFailure.error;
  }
}
