import { parseServerConfig, type ServerConfig } from "@meterpilot/config/server";
import { checkDatabaseHealth, createDatabase, type Database } from "@meterpilot/db";
import {
  createObservability,
  type Observability,
  type ObservabilityOptions,
} from "@meterpilot/observability";

import { createDrizzleApiKeyRepository } from "../features/api-keys/drizzle-repository";
import { createApiKeyService, type ApiKeyService } from "../features/api-keys/service";
import {
  createAuthentication,
  createAuthGateway,
  type AuthGateway,
  type AuthenticationOptions,
} from "../features/identity/authentication";
import { createDrizzleOrganizationRepository } from "../features/organizations/drizzle-repository";
import type { OrganizationRepository } from "../features/organizations/repository";
import { createApp } from "../http/app";
import { type ServerRuntime, type StartServerOptions, startServer } from "./server";

const SERVICE_NAME = "meterpilot-server";

type RuntimeDatabase = Pick<Database, "client" | "close" | "db">;

export type BootstrapDependencies = Readonly<{
  checkDatabaseHealth: (client: RuntimeDatabase["client"]) => Promise<void>;
  createAuthGateway: (options: AuthenticationOptions) => AuthGateway;
  createApiKeyService: (database: RuntimeDatabase["db"]) => ApiKeyService;
  createDatabase: (databaseUrl: string) => RuntimeDatabase;
  createObservability: (options: ObservabilityOptions) => Observability;
  createOrganizationRepository: (database: RuntimeDatabase["db"]) => OrganizationRepository;
  parseServerConfig: () => ServerConfig;
  startServer: (options: StartServerOptions) => ServerRuntime;
}>;

const defaultDependencies: BootstrapDependencies = {
  checkDatabaseHealth,
  createApiKeyService: (database) => createApiKeyService(createDrizzleApiKeyRepository(database)),
  createAuthGateway: (options) => createAuthGateway(createAuthentication(options)),
  createDatabase,
  createObservability,
  createOrganizationRepository: createDrizzleOrganizationRepository,
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
    const auth = dependencies.createAuthGateway({
      baseUrl: config.authBaseUrl,
      database: database.db,
      secret: config.authSecret,
    });
    const organizationRepository = dependencies.createOrganizationRepository(database.db);
    const app = createApp({
      apiKeyService,
      auth,
      checkDatabaseHealth: () => dependencies.checkDatabaseHealth(database.client),
      observability,
      organizationRepository,
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
