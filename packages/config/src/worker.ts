import { z } from "zod";

import {
  deploymentEnvironmentSchema,
  type EnvironmentSource,
  logLevelSchema,
  parseConfiguration,
} from "./common";
import { databaseUrlSchema } from "./database";

export const workerConfigSchema = z
  .object({
    DATABASE_URL: databaseUrlSchema,
    LOG_LEVEL: logLevelSchema,
    NODE_ENV: deploymentEnvironmentSchema,
  })
  .transform((environment) => ({
    databaseUrl: environment.DATABASE_URL,
    logLevel: environment.LOG_LEVEL,
    nodeEnvironment: environment.NODE_ENV,
  }));

export type WorkerConfig = z.output<typeof workerConfigSchema>;

export function parseWorkerConfig(environment: EnvironmentSource = process.env): WorkerConfig {
  return parseConfiguration(workerConfigSchema, environment, "worker");
}
