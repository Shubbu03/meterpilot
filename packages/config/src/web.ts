import { z } from "zod";

import { type EnvironmentSource, parseConfiguration } from "./common";

export const webConfigSchema = z
  .object({
    VITE_API_BASE_URL: z.url().default("http://localhost:3000"),
  })
  .transform((environment) => ({
    apiBaseUrl: environment.VITE_API_BASE_URL,
  }));

export type WebConfig = z.output<typeof webConfigSchema>;

export function parseWebConfig(environment: EnvironmentSource): WebConfig {
  return parseConfiguration(webConfigSchema, environment, "web");
}
