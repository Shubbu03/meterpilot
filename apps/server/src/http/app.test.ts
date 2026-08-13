import { describe, expect, spyOn, test } from "bun:test";

import { createApp } from "./app";

describe("HTTP application", () => {
  test("reports combined service health", async () => {
    const response = await createApp().request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: "meterpilot-server",
      status: "ok",
    });
  });

  test("adds request and security headers", async () => {
    const response = await createApp().request("/health");

    expect(response.headers.get("x-request-id")).toBeString();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  test("preserves a valid caller request ID", async () => {
    const response = await createApp().request("/health", {
      headers: {
        "X-Request-Id": "request_01",
      },
    });

    expect(response.headers.get("x-request-id")).toBe("request_01");
  });

  test("returns a structured not-found error", async () => {
    const response = await createApp().request("/missing", {
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
    const app = createApp();
    const errorLog = spyOn(console, "error").mockImplementation(() => undefined);

    app.get("/throws", () => {
      throw new Error("private implementation detail");
    });

    try {
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
    } finally {
      errorLog.mockRestore();
    }
  });
});
