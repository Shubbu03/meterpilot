import { parseServerConfig, type ServerConfig } from "@meterpilot/config/server";
import { checkDatabaseHealth, createDatabase, type Database } from "@meterpilot/db";
import {
  createObservability,
  type Observability,
  type ObservabilityOptions,
} from "@meterpilot/observability";

import { createApp } from "../http/app";
import { type ServerRuntime, type StartServerOptions, startServer } from "./server";

const SERVICE_NAME = "meterpilot-server";

type RuntimeDatabase = Pick<Database, "client" | "close">;

export type BootstrapDependencies = Readonly<{
  checkDatabaseHealth: (client: RuntimeDatabase["client"]) => Promise<void>;
  createDatabase: (databaseUrl: string) => RuntimeDatabase;
  createObservability: (options: ObservabilityOptions) => Observability;
  parseServerConfig: () => ServerConfig;
  startServer: (options: StartServerOptions) => ServerRuntime;
}>;

const defaultDependencies: BootstrapDependencies = {
  checkDatabaseHealth,
  createDatabase,
  createObservability,
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
    const app = createApp({
      checkDatabaseHealth: () => dependencies.checkDatabaseHealth(database.client),
      observability,
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
