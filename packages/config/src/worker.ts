import { z } from "zod";

import {
  deploymentEnvironmentSchema,
  type EnvironmentSource,
  logLevelSchema,
  parseConfiguration,
} from "./common";
import { databaseUrlSchema } from "./database";

function integerEnvironmentVariable(
  options: Readonly<{ default: number; max: number; min: number }>,
) {
  return z.preprocess((value) => {
    if (typeof value === "string" && /^\d+$/.test(value)) {
      return Number(value);
    }
    return value;
  }, z.number().int().min(options.min).max(options.max).default(options.default));
}

export const workerConfigSchema = z
  .object({
    DATABASE_URL: databaseUrlSchema,
    JOB_CLAIM_LIMIT: integerEnvironmentVariable({ default: 10, max: 100, min: 1 }),
    JOB_LEASE_DURATION_MS: integerEnvironmentVariable({
      default: 60_000,
      max: 86_400_000,
      min: 1_000,
    }),
    JOB_MAX_ATTEMPTS: integerEnvironmentVariable({ default: 8, max: 100, min: 1 }),
    JOB_POLL_INTERVAL_MS: integerEnvironmentVariable({ default: 1_000, max: 60_000, min: 10 }),
    JOB_RETRY_BASE_DELAY_MS: integerEnvironmentVariable({
      default: 1_000,
      max: 3_600_000,
      min: 10,
    }),
    JOB_RETRY_MAX_DELAY_MS: integerEnvironmentVariable({
      default: 300_000,
      max: 86_400_000,
      min: 10,
    }),
    LOG_LEVEL: logLevelSchema,
    NODE_ENV: deploymentEnvironmentSchema,
  })
  .superRefine((environment, context) => {
    if (environment.JOB_RETRY_BASE_DELAY_MS > environment.JOB_RETRY_MAX_DELAY_MS) {
      context.addIssue({
        code: "custom",
        message: "must be greater than or equal to JOB_RETRY_BASE_DELAY_MS",
        path: ["JOB_RETRY_MAX_DELAY_MS"],
      });
    }
  })
  .transform((environment) => ({
    claimLimit: environment.JOB_CLAIM_LIMIT,
    databaseUrl: environment.DATABASE_URL,
    leaseDurationMs: environment.JOB_LEASE_DURATION_MS,
    logLevel: environment.LOG_LEVEL,
    maxAttempts: environment.JOB_MAX_ATTEMPTS,
    nodeEnvironment: environment.NODE_ENV,
    pollIntervalMs: environment.JOB_POLL_INTERVAL_MS,
    retryBaseDelayMs: environment.JOB_RETRY_BASE_DELAY_MS,
    retryMaxDelayMs: environment.JOB_RETRY_MAX_DELAY_MS,
  }));

export type WorkerConfig = z.output<typeof workerConfigSchema>;

export function parseWorkerConfig(environment: EnvironmentSource = process.env): WorkerConfig {
  return parseConfiguration(workerConfigSchema, environment, "worker");
}
