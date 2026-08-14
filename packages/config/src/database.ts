import { z } from "zod";

import { type EnvironmentSource, parseConfiguration } from "./common";

const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

export const databaseUrlSchema = z
  .string()
  .min(1, "is required")
  .superRefine((value, context) => {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "must be a valid PostgreSQL URL",
      });
      return;
    }

    if (!POSTGRES_PROTOCOLS.has(url.protocol)) {
      context.addIssue({
        code: "custom",
        message: "must use postgres:// or postgresql://",
      });
    }

    if (!url.hostname || url.pathname === "/" || url.pathname.length < 2) {
      context.addIssue({
        code: "custom",
        message: "must include a host and database name",
      });
    }
  });

export function parseDatabaseUrl(value: unknown): string {
  return parseConfiguration(databaseUrlSchema, value, "database");
}

export function readDatabaseUrl(environment: EnvironmentSource = process.env): string {
  return parseDatabaseUrl(environment.DATABASE_URL);
}
