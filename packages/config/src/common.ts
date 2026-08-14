import { z } from "zod";

export type EnvironmentSource = Readonly<Record<string, unknown>>;

export const deploymentEnvironmentSchema = z
  .enum(["development", "test", "production"])
  .default("development");

export const logLevelSchema = z.enum(["debug", "info", "warn", "error"]).default("info");

export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";

  constructor(scope: string, error: z.ZodError) {
    const details = error.issues
      .map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`)
      .join("; ");

    super(`Invalid ${scope} configuration: ${details}`);
  }
}

export function parseConfiguration<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  scope: string,
): z.output<TSchema> {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new ConfigurationError(scope, result.error);
  }

  return result.data;
}
