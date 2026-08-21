import { parseServerConfig, type ServerConfig } from "@meterpilot/config/server";
import { checkDatabaseHealth, createDatabase, type Database } from "@meterpilot/db";
import {
  createObservability,
  type Observability,
  type ObservabilityOptions,
} from "@meterpilot/observability";

import { createDrizzleApiKeyRepository } from "../features/api-keys/drizzle-repository";
import { type ApiKeyService, createApiKeyService } from "../features/api-keys/service";
import { createDrizzleCatalogRepository } from "../features/catalog/drizzle-repository";
import type { CatalogRepository } from "../features/catalog/repository";
import { createDrizzleCustomerRepository } from "../features/customers/drizzle-repository";
import type { CustomerRepository } from "../features/customers/repository";
import { createDrizzleEntitlementRepository } from "../features/entitlements/drizzle-repository";
import type { EntitlementRepository } from "../features/entitlements/repository";
import { createDrizzleEventRepository } from "../features/events/drizzle-repository";
import { createEventService, type EventService } from "../features/events/service";
import {
  type AuthenticationOptions,
  type AuthGateway,
  createAuthentication,
  createAuthGateway,
} from "../features/identity/authentication";
import { createDrizzleJobOperationsRepository } from "../features/job-operations/drizzle-repository";
import type { JobOperationsRepository } from "../features/job-operations/repository";
import { createDrizzleMeterRepository } from "../features/meters/drizzle-repository";
import type { MeterRepository } from "../features/meters/repository";
import { createDrizzleOperationsRepository } from "../features/operations/drizzle-repository";
import type { OperationsRepository } from "../features/operations/repository";
import { createDrizzleOrganizationRepository } from "../features/organizations/drizzle-repository";
import type { OrganizationRepository } from "../features/organizations/repository";
import { createDrizzlePreviewRepository } from "../features/previews/drizzle-repository";
import type { PreviewRepository } from "../features/previews/repository";
import { createDrizzleRateLimitRepository } from "../features/rate-limits/drizzle-repository";
import type { RateLimitRepository } from "../features/rate-limits/repository";
import { createDrizzleRetentionRepository } from "../features/retention/drizzle-repository";
import type { RetentionRepository } from "../features/retention/repository";
import { createDrizzleSimulationRepository } from "../features/simulations/drizzle-repository";
import type { SimulationRepository } from "../features/simulations/repository";
import { createDrizzleUsageRepository } from "../features/usage/drizzle-repository";
import type { UsageRepository } from "../features/usage/repository";
import { createApp } from "../http/app";
import { type ServerRuntime, type StartServerOptions, startServer } from "./server";

const SERVICE_NAME = "meterpilot-server";

type RuntimeDatabase = Pick<Database, "client" | "close" | "db">;

export type BootstrapDependencies = Readonly<{
  checkDatabaseHealth: (client: RuntimeDatabase["client"]) => Promise<void>;
  createAuthGateway: (options: AuthenticationOptions) => AuthGateway;
  createApiKeyService: (database: RuntimeDatabase["db"]) => ApiKeyService;
  createCatalogRepository: (database: RuntimeDatabase["db"]) => CatalogRepository;
  createDatabase: (databaseUrl: string) => RuntimeDatabase;
  createCustomerRepository: (database: RuntimeDatabase["db"]) => CustomerRepository;
  createEventService: (database: RuntimeDatabase["db"]) => EventService;
  createEntitlementRepository: (database: RuntimeDatabase["db"]) => EntitlementRepository;
  createJobOperationsRepository?: (database: RuntimeDatabase["db"]) => JobOperationsRepository;
  createMeterRepository: (database: RuntimeDatabase["db"]) => MeterRepository;
  createObservability: (options: ObservabilityOptions) => Observability;
  createOrganizationRepository: (database: RuntimeDatabase["db"]) => OrganizationRepository;
  createOperationsRepository?: (database: RuntimeDatabase["db"]) => OperationsRepository;
  createPreviewRepository?: (database: RuntimeDatabase["db"]) => PreviewRepository;
  createRateLimitRepository?: (database: RuntimeDatabase["db"]) => RateLimitRepository;
  createRetentionRepository?: (database: RuntimeDatabase["db"]) => RetentionRepository;
  createSimulationRepository?: (database: RuntimeDatabase["db"]) => SimulationRepository;
  createUsageRepository: (database: RuntimeDatabase["db"]) => UsageRepository;
  parseServerConfig: () => ServerConfig;
  startServer: (options: StartServerOptions) => ServerRuntime;
}>;

const defaultDependencies: BootstrapDependencies = {
  checkDatabaseHealth,
  createApiKeyService: (database) => createApiKeyService(createDrizzleApiKeyRepository(database)),
  createAuthGateway: (options) => createAuthGateway(createAuthentication(options)),
  createCatalogRepository: createDrizzleCatalogRepository,
  createDatabase,
  createCustomerRepository: createDrizzleCustomerRepository,
  createEventService: (database) => createEventService(createDrizzleEventRepository(database)),
  createEntitlementRepository: createDrizzleEntitlementRepository,
  createJobOperationsRepository: createDrizzleJobOperationsRepository,
  createMeterRepository: createDrizzleMeterRepository,
  createObservability,
  createOrganizationRepository: createDrizzleOrganizationRepository,
  createOperationsRepository: createDrizzleOperationsRepository,
  createPreviewRepository: createDrizzlePreviewRepository,
  createRateLimitRepository: createDrizzleRateLimitRepository,
  createRetentionRepository: createDrizzleRetentionRepository,
  createSimulationRepository: createDrizzleSimulationRepository,
  createUsageRepository: createDrizzleUsageRepository,
  parseServerConfig,
  startServer,
};

export async function bootstrapServer(
  dependencies: BootstrapDependencies = defaultDependencies,
): Promise<ServerRuntime> {
  const config = dependencies.parseServerConfig();
  const observability = dependencies.createObservability({
    environment: config.nodeEnvironment,
    level: config.logLevel,
    service: SERVICE_NAME,
  });
  const database = dependencies.createDatabase(config.databaseUrl);

  try {
    const apiKeyService = dependencies.createApiKeyService(database.db);
    const catalogRepository = dependencies.createCatalogRepository(database.db);
    const customerRepository = dependencies.createCustomerRepository(database.db);
    const eventService = dependencies.createEventService(database.db);
    const entitlementRepository = dependencies.createEntitlementRepository(database.db);
    const jobOperationsRepository = dependencies.createJobOperationsRepository?.(database.db);
    const meterRepository = dependencies.createMeterRepository(database.db);
    const auth = dependencies.createAuthGateway({
      baseUrl: config.authBaseUrl,
      database: database.db,
      secret: config.authSecret,
      trustedOrigins: [config.webAppOrigin],
    });
    const organizationRepository = dependencies.createOrganizationRepository(database.db);
    const operationsRepository = dependencies.createOperationsRepository?.(database.db);
    const previewRepository = dependencies.createPreviewRepository?.(database.db);
    const rateLimitRepository = dependencies.createRateLimitRepository?.(database.db);
    const retentionRepository = dependencies.createRetentionRepository?.(database.db);
    const simulationRepository = dependencies.createSimulationRepository?.(database.db);
    const usageRepository = dependencies.createUsageRepository(database.db);
    const app = createApp({
      apiKeyService,
      auth,
      catalogRepository,
      checkDatabaseHealth: () => dependencies.checkDatabaseHealth(database.client),
      customerRepository,
      eventService,
      entitlementRepository,
      ...(jobOperationsRepository ? { jobOperationsRepository } : {}),
      meterRepository,
      observability,
      organizationRepository,
      ...(operationsRepository ? { operationsRepository } : {}),
      ...(previewRepository ? { previewRepository } : {}),
      ...(rateLimitRepository
        ? {
            rateLimit: {
              apiKeyRequests: config.rateLimitApiKeyRequests,
              dashboardRequests: config.rateLimitDashboardRequests,
              repository: rateLimitRepository,
              windowMs: config.rateLimitWindowMs,
            },
          }
        : {}),
      ...(retentionRepository ? { retentionRepository } : {}),
      ...(simulationRepository ? { simulationRepository } : {}),
      trustedBrowserOrigin: config.webAppOrigin,
      usageRepository,
    });

    return dependencies.startServer({
      app,
      closeDatabase: database.close,
      config,
      logger: observability.logger,
    });
  } catch (error) {
    observability.logger.error("server_startup_failed", { error });

    try {
      await database.close();
    } catch (closeError) {
      observability.logger.error("database_close_failed", { error: closeError });
      throw new AggregateError([error, closeError], "Server startup cleanup failed.");
    }

    throw error;
  }
}
