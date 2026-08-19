import { describe, expect, test } from "bun:test";
import { createObservability } from "@meterpilot/observability";

import type { AuthGateway } from "../src/features/identity/authentication";
import { createApp } from "../src/http/app";
import { createOrganizationRepositoryStub } from "./helpers";

type LogEntry = Readonly<Record<string, unknown>>;

function createTestApp(options: Readonly<{ checkDatabaseHealth?: () => Promise<void> }> = {}) {
  const logs: LogEntry[] = [];
  let currentTime = 0;
  const observability = createObservability({
    environment: "test",
    level: "debug",
    service: "meterpilot-server",
    write(line) {
      logs.push(JSON.parse(line) as LogEntry);
    },
  });
  const auth: AuthGateway = {
    getSession: () => Promise.resolve(null),
    handler: () => Promise.resolve(new Response("auth response")),
  };
  const app = createApp({
    auth,
    checkDatabaseHealth: options.checkDatabaseHealth ?? (() => Promise.resolve()),
    now: () => currentTime++,
    observability,
    organizationRepository: createOrganizationRepositoryStub(),
  });

  return { app, logs };
}

describe("HTTP application", () => {
  test("mounts the Better Auth handler at its canonical base path", async () => {
    const { app } = createTestApp();
    const response = await app.request("/api/auth/get-session");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("auth response");
  });

  test("reports combined service health after checking PostgreSQL", async () => {
    let healthChecks = 0;
    const { app } = createTestApp({
      checkDatabaseHealth: () => {
        healthChecks++;
        return Promise.resolve();
      },
    });
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(healthChecks).toBe(1);
    expect(await response.json()).toEqual({
      service: "meterpilot-server",
      status: "ok",
    });
  });

  test("reports degraded health without exposing database errors", async () => {
    const { app, logs } = createTestApp({
      checkDatabaseHealth: () => Promise.reject(new Error("private connection detail")),
    });
    const response = await app.request("/health");
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).not.toContain("private connection detail");
    expect(JSON.parse(body)).toEqual({
      service: "meterpilot-server",
      status: "degraded",
    });
    expect(logs).toContainEqual(
      expect.objectContaining({
        error: { name: "Error" },
        event: "database_health_check_failed",
        level: "warn",
      }),
    );
  });

  test("adds request and security headers", async () => {
    const { app } = createTestApp();
    const response = await app.request("/health");

    expect(response.headers.get("x-request-id")).toBeString();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  test("preserves a valid caller request ID", async () => {
    const { app } = createTestApp();
    const response = await app.request("/health", {
      headers: {
        "X-Request-Id": "request_01",
      },
    });

    expect(response.headers.get("x-request-id")).toBe("request_01");
  });

  test("records structured request completion logs", async () => {
    const { app, logs } = createTestApp();
    await app.request("/health", {
      headers: {
        "X-Request-Id": "request_log_01",
      },
    });

    expect(logs).toContainEqual(
      expect.objectContaining({
        durationMs: 1,
        event: "http_request_completed",
        method: "GET",
        path: "/health",
        requestId: "request_log_01",
        statusCode: 200,
      }),
    );
  });

  test("returns a structured not-found error", async () => {
    const { app } = createTestApp();
    const response = await app.request("/missing", {
      headers: {
        "X-Request-Id": "request_02",
      },
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "route_not_found",
        message: "The requested route does not exist.",
        requestId: "request_02",
      },
    });
  });

  test("does not expose internal error details", async () => {
    const { app, logs } = createTestApp();

    app.get("/throws", () => {
      throw new Error("private implementation detail");
    });

    const response = await app.request("/throws", {
      headers: {
        "X-Request-Id": "request_03",
      },
    });
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain("private implementation detail");
    expect(JSON.parse(body)).toEqual({
      error: {
        code: "internal_error",
        message: "An unexpected error occurred.",
        requestId: "request_03",
      },
    });
    expect(logs).toContainEqual(
      expect.objectContaining({
        error: { name: "Error" },
        event: "unhandled_request_error",
        requestId: "request_03",
      }),
    );
  });
});
