import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { requestId } from "hono/request-id";

import { createApiKeyMiddleware } from "../src/features/api-keys/middleware";
import type { ApiKeyAuthenticator } from "../src/features/api-keys/service";
import type { AppEnvironment } from "../src/http/environment";

const API_KEY_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KEY = `mpk_${"A".repeat(12)}.${"B".repeat(43)}`;

function createMiddlewareApp(authenticator: ApiKeyAuthenticator) {
  const app = new Hono<AppEnvironment>();
  app.use("*", requestId());
  app.get("/protected", createApiKeyMiddleware(authenticator, "events:write"), (context) =>
    context.json(context.get("apiKeyPrincipal")),
  );
  return app;
}

describe("API key authentication middleware", () => {
  test("returns the same generic unauthorized response for missing and invalid credentials", async () => {
    const authenticator: ApiKeyAuthenticator = {
      authenticate: () => Promise.resolve(null),
    };
    const app = createMiddlewareApp(authenticator);

    for (const authorization of [undefined, "Basic credentials", `Bearer ${KEY}`]) {
      const response = await app.request("/protected", {
        headers: {
          ...(authorization ? { Authorization: authorization } : {}),
          "X-Request-Id": "request_unauthorized",
        },
      });
      const body = await response.text();

      expect(response.status).toBe(401);
      expect(body).not.toContain(KEY);
      expect(JSON.parse(body)).toEqual({
        error: {
          code: "unauthorized",
          message: "A valid API key is required.",
          requestId: "request_unauthorized",
        },
      });
    }
  });

  test("rejects a valid key that lacks the required scope", async () => {
    const app = createMiddlewareApp({
      authenticate: () =>
        Promise.resolve({
          apiKeyId: API_KEY_ID,
          organizationId: ORGANIZATION_ID,
          scopes: ["events:read"],
        }),
    });
    const response = await app.request("/protected", {
      headers: { Authorization: `Bearer ${KEY}`, "X-Request-Id": "request_scope" },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "forbidden",
        message: "The API key does not grant the required scope.",
        requestId: "request_scope",
      },
    });
  });

  test("sets the authenticated principal when the required scope is present", async () => {
    const principal = {
      apiKeyId: API_KEY_ID,
      organizationId: ORGANIZATION_ID,
      scopes: ["events:write", "events:read"] as const,
    };
    const app = createMiddlewareApp({ authenticate: () => Promise.resolve(principal) });
    const response = await app.request("/protected", {
      headers: { Authorization: `Bearer ${KEY}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(principal);
  });
});
