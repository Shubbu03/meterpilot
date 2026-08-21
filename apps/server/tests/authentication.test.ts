import { describe, expect, test } from "bun:test";
import type { Database } from "@meterpilot/db";

import { createAuthentication } from "../src/features/identity/authentication";

describe("Better Auth configuration", () => {
  test("uses database sessions, email/password, UUIDs, and the configured origin", async () => {
    const authentication = createAuthentication({
      baseUrl: "http://localhost:3000",
      database: {} as Database["db"],
      secret: "test-secret-that-is-at-least-32-characters-long",
      trustedOrigins: ["http://localhost:5173"],
    });

    expect(authentication.options.baseURL).toBe("http://localhost:3000");
    expect(authentication.options.emailAndPassword).toMatchObject({
      enabled: true,
      revokeSessionsOnPasswordReset: true,
    });
    expect(authentication.options.advanced?.database?.generateId).toBe("uuid");
    expect(authentication.options.rateLimit).toEqual({
      enabled: true,
      max: 100,
      storage: "memory",
      window: 60,
    });
    expect(authentication.options.trustedOrigins).toEqual(["http://localhost:5173"]);
    expect(authentication.options.database).toBeFunction();
    expect((await authentication.$context).adapter.id).toBe("drizzle");
  });
});
