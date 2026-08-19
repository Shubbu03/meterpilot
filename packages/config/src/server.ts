import { z } from "zod";

import {
  deploymentEnvironmentSchema,
  type EnvironmentSource,
  logLevelSchema,
  parseConfiguration,
} from "./common";
import { databaseUrlSchema } from "./database";

export const serverConfigSchema = z
  .object({
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    DATABASE_URL: databaseUrlSchema,
    HOST: z.string().trim().min(1).default("0.0.0.0"),
    LOG_LEVEL: logLevelSchema,
    NODE_ENV: deploymentEnvironmentSchema,
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  })
  .transform((environment) => ({
    authBaseUrl: environment.BETTER_AUTH_URL,
    authSecret: environment.BETTER_AUTH_SECRET,
    databaseUrl: environment.DATABASE_URL,
    host: environment.HOST,
    logLevel: environment.LOG_LEVEL,
    nodeEnvironment: environment.NODE_ENV,
    port: environment.PORT,
  }));

export type ServerConfig = z.output<typeof serverConfigSchema>;

export function parseServerConfig(environment: EnvironmentSource = process.env): ServerConfig {
  return parseConfiguration(serverConfigSchema, environment, "server");
}
