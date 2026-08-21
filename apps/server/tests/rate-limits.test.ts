import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { requestId } from "hono/request-id";

import { createCredentialRateLimitMiddleware } from "../src/features/rate-limits/middleware";
import type { RateLimitRepository } from "../src/features/rate-limits/repository";
import type { AppEnvironment } from "../src/http/environment";

const NOW = new Date("2026-09-01T00:00:00.000Z");

function app(repository: RateLimitRepository) {
  const result = new Hono<AppEnvironment>();
  result.use("*", requestId());
  result.use(
    "/v1/*",
    createCredentialRateLimitMiddleware({
      apiKeyRequests: 10,
      dashboardRequests: 5,
      now: () => NOW,
      repository,
      windowMs: 60_000,
    }),
  );
  result.get("/v1/organizations/:organizationId/resource", (context) => context.text("ok"));
  result.get("/v1/events", (context) => context.text("ok"));
  return result;
}

describe("credential rate limiting", () => {
  test("hashes API keys and exposes bounded rate-limit headers", async () => {
    let input: Parameters<RateLimitRepository["consume"]>[0] | undefined;
    const repository: RateLimitRepository = {
      consume(value) {
        input = value;
        return Promise.resolve({
          allowed: true,
          limit: value.limit,
          remaining: 9,
          resetAt: new Date(NOW.getTime() + 60_000),
        });
      },
    };
    const response = await app(repository).request("/v1/events", {
      headers: { Authorization: "Bearer meterpilot-secret" },
    });

    expect(response.status).toBe(200);
    expect(input).toMatchObject({ limit: 10, now: NOW, windowMs: 60_000 });
    expect(input?.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(input?.keyHash).not.toContain("meterpilot-secret");
    expect(response.headers.get("RateLimit-Limit")).toBe("10");
    expect(response.headers.get("RateLimit-Remaining")).toBe("9");
  });

  test("keys dashboard credentials by organization and rejects exhausted windows", async () => {
    const keys: string[] = [];
    const repository: RateLimitRepository = {
      consume(value) {
        keys.push(value.keyHash);
        return Promise.resolve({
          allowed: false,
          limit: value.limit,
          remaining: 0,
          resetAt: new Date(NOW.getTime() + 30_000),
        });
      },
    };
    const limited = app(repository);
    const left = await limited.request(
      "/v1/organizations/11111111-1111-4111-8111-111111111111/resource",
      { headers: { Cookie: "better-auth.session_token=secret" } },
    );
    await limited.request("/v1/organizations/22222222-2222-4222-8222-222222222222/resource", {
      headers: { Cookie: "better-auth.session_token=secret" },
    });

    expect(left.status).toBe(429);
    expect(left.headers.get("Retry-After")).toBe("30");
    const payload = (await left.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("rate_limited");
    expect(keys[0]).not.toBe(keys[1]);
  });

  test("leaves missing credentials to authentication middleware", async () => {
    let calls = 0;
    const response = await app({
      consume: () => {
        calls++;
        throw new Error("unexpected rate-limit lookup");
      },
    }).request("/v1/events");

    expect(response.status).toBe(200);
    expect(calls).toBe(0);
  });

  test("ignores unrelated cookies and hashes only the session credential", async () => {
    const keys: string[] = [];
    const repository: RateLimitRepository = {
      consume(value) {
        keys.push(value.keyHash);
        return Promise.resolve({
          allowed: true,
          limit: value.limit,
          remaining: value.limit - 1,
          resetAt: new Date(NOW.getTime() + 60_000),
        });
      },
    };
    const limited = app(repository);
    await limited.request("/v1/organizations/11111111-1111-4111-8111-111111111111/resource", {
      headers: { Cookie: "theme=dark; better-auth.session_token=secret; locale=en" },
    });
    await limited.request("/v1/organizations/11111111-1111-4111-8111-111111111111/resource", {
      headers: { Cookie: "locale=fr; better-auth.session_token=secret" },
    });
    await limited.request("/v1/organizations/11111111-1111-4111-8111-111111111111/resource", {
      headers: { Cookie: "theme=dark" },
    });

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
});
