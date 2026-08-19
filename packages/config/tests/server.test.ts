import { describe, expect, test } from "bun:test";

import { parseServerConfig } from "../src/server";

const DATABASE_URL = "postgresql://user:password@localhost:5432/meterpilot";
const AUTH_ENVIRONMENT = {
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
  BETTER_AUTH_URL: "http://localhost:3000",
} as const;

describe("server configuration", () => {
  test("applies safe development defaults", () => {
    expect(parseServerConfig({ ...AUTH_ENVIRONMENT, DATABASE_URL })).toEqual({
      authBaseUrl: "http://localhost:3000",
      authSecret: AUTH_ENVIRONMENT.BETTER_AUTH_SECRET,
      databaseUrl: DATABASE_URL,
      host: "0.0.0.0",
      logLevel: "info",
      nodeEnvironment: "development",
      port: 3000,
    });
  });

  test("parses an explicit port", () => {
    expect(parseServerConfig({ ...AUTH_ENVIRONMENT, DATABASE_URL, PORT: "4100" }).port).toBe(4100);
  });

  test("rejects an invalid port", () => {
    expect(() => parseServerConfig({ ...AUTH_ENVIRONMENT, DATABASE_URL, PORT: "70000" })).toThrow(
      "Invalid server configuration",
    );
  });

  test("requires an explicit strong authentication secret", () => {
    expect(() =>
      parseServerConfig({
        BETTER_AUTH_SECRET: "too-short",
        BETTER_AUTH_URL: AUTH_ENVIRONMENT.BETTER_AUTH_URL,
        DATABASE_URL,
      }),
    ).toThrow("Invalid server configuration");
  });

  test("rejects an invalid authentication URL", () => {
    expect(() =>
      parseServerConfig({
        ...AUTH_ENVIRONMENT,
        BETTER_AUTH_URL: "not-a-url",
        DATABASE_URL,
      }),
    ).toThrow("Invalid server configuration");
  });
});
