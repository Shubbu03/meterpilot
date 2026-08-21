import { describe, expect, test } from "bun:test";

import { parseServerConfig } from "../src/server";

const DATABASE_URL = "postgresql://user:password@localhost:5432/meterpilot";
const AUTH_ENVIRONMENT = {
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
  BETTER_AUTH_URL: "http://localhost:3000",
  WEB_APP_URL: "http://localhost:5173",
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
      rateLimitApiKeyRequests: 12_000,
      rateLimitDashboardRequests: 600,
      rateLimitWindowMs: 60_000,
      webAppOrigin: "http://localhost:5173",
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

  test("parses bounded credential rate limits", () => {
    const config = parseServerConfig({
      ...AUTH_ENVIRONMENT,
      DATABASE_URL,
      RATE_LIMIT_API_KEY_REQUESTS: "20000",
      RATE_LIMIT_DASHBOARD_REQUESTS: "900",
      RATE_LIMIT_WINDOW_MS: "30000",
    });
    expect(config).toMatchObject({
      rateLimitApiKeyRequests: 20_000,
      rateLimitDashboardRequests: 900,
      rateLimitWindowMs: 30_000,
    });
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

  test("requires an explicit web application origin", () => {
    expect(() =>
      parseServerConfig({
        BETTER_AUTH_SECRET: AUTH_ENVIRONMENT.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: AUTH_ENVIRONMENT.BETTER_AUTH_URL,
        DATABASE_URL,
      }),
    ).toThrow("Invalid server configuration");
  });

  test("normalizes the configured web application origin", () => {
    const config = parseServerConfig({
      ...AUTH_ENVIRONMENT,
      DATABASE_URL,
      WEB_APP_URL: "https://dashboard.example.com:443/",
    });

    expect(config.webAppOrigin).toBe("https://dashboard.example.com");
  });

  test("rejects web application URLs that are not exact HTTP origins", () => {
    for (const webAppUrl of [
      "ftp://dashboard.example.com",
      "https://dashboard.example.com/app",
      "https://user:password@dashboard.example.com",
      "https://dashboard.example.com?tenant=acme",
    ]) {
      expect(() =>
        parseServerConfig({ ...AUTH_ENVIRONMENT, DATABASE_URL, WEB_APP_URL: webAppUrl }),
      ).toThrow("Invalid server configuration");
    }
  });
});
