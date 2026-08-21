import { z } from "zod";

import {
  deploymentEnvironmentSchema,
  type EnvironmentSource,
  logLevelSchema,
  parseConfiguration,
} from "./common";
import { databaseUrlSchema } from "./database";

const browserOriginSchema = z
  .url()
  .superRefine((value, context) => {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      context.addIssue({
        code: "custom",
        message: "must use the http or https protocol",
      });
    }

    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      context.addIssue({
        code: "custom",
        message: "must be an origin without credentials, path, query, or fragment",
      });
    }
  })
  .transform((value) => new URL(value).origin);

function integerEnvironmentVariable(
  options: Readonly<{ default: number; max: number; min: number }>,
) {
  return z.preprocess((value) => {
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
    return value;
  }, z.number().int().min(options.min).max(options.max).default(options.default));
}

export const serverConfigSchema = z
  .object({
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    DATABASE_URL: databaseUrlSchema,
    HOST: z.string().trim().min(1).default("0.0.0.0"),
    LOG_LEVEL: logLevelSchema,
    NODE_ENV: deploymentEnvironmentSchema,
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    RATE_LIMIT_API_KEY_REQUESTS: integerEnvironmentVariable({
      default: 12_000,
      max: 1_000_000,
      min: 1,
    }),
    RATE_LIMIT_DASHBOARD_REQUESTS: integerEnvironmentVariable({
      default: 600,
      max: 100_000,
      min: 1,
    }),
    RATE_LIMIT_WINDOW_MS: integerEnvironmentVariable({
      default: 60_000,
      max: 3_600_000,
      min: 1_000,
    }),
    WEB_APP_URL: browserOriginSchema,
  })
  .transform((environment) => ({
    authBaseUrl: environment.BETTER_AUTH_URL,
    authSecret: environment.BETTER_AUTH_SECRET,
    databaseUrl: environment.DATABASE_URL,
    host: environment.HOST,
    logLevel: environment.LOG_LEVEL,
    nodeEnvironment: environment.NODE_ENV,
    port: environment.PORT,
    rateLimitApiKeyRequests: environment.RATE_LIMIT_API_KEY_REQUESTS,
    rateLimitDashboardRequests: environment.RATE_LIMIT_DASHBOARD_REQUESTS,
    rateLimitWindowMs: environment.RATE_LIMIT_WINDOW_MS,
    webAppOrigin: environment.WEB_APP_URL,
  }));

export type ServerConfig = z.output<typeof serverConfigSchema>;

export function parseServerConfig(environment: EnvironmentSource = process.env): ServerConfig {
  return parseConfiguration(serverConfigSchema, environment, "server");
}
