import { describe, expect, test } from "bun:test";
import { healthResponseSchema } from "@meterpilot/contracts/common";

import { ApiClient, ApiContractError, ApiError, type ApiFetch } from "../src/lib/api/client";

describe("ApiClient", () => {
  test("sends credentialed requests and validates successful responses", async () => {
    let receivedRequest: Request | undefined;
    const fetcher: ApiFetch = async (input, init) => {
      receivedRequest = new Request(input, init);
      return Response.json({ service: "meterpilot-server", status: "ok" });
    };
    const client = new ApiClient("http://localhost:3000", fetcher);

    const result = await client.request("/health", healthResponseSchema, {
      json: { probe: true },
      method: "POST",
      requestId: "web-test-1",
    });

    expect(result).toEqual({ service: "meterpilot-server", status: "ok" });
    expect(receivedRequest?.credentials).toBe("include");
    expect(receivedRequest?.headers.get("accept")).toBe("application/json");
    expect(receivedRequest?.headers.get("content-type")).toBe("application/json");
    expect(receivedRequest?.headers.get("x-request-id")).toBe("web-test-1");
    expect(await receivedRequest?.json()).toEqual({ probe: true });
  });

  test("preserves the server public error envelope", async () => {
    const fetcher: ApiFetch = async () =>
      Response.json(
        {
          error: {
            code: "validation_error",
            details: [{ field: "customerId", message: "is required" }],
            message: "Request validation failed.",
            requestId: "server-request-1",
          },
        },
        { status: 400 },
      );
    const client = new ApiClient("http://localhost:3000", fetcher);

    const error = await client
      .request("/v1/customers", healthResponseSchema, { requestId: "web-test-2" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "validation_error",
      details: [{ field: "customerId", message: "is required" }],
      requestId: "server-request-1",
      status: 400,
    });
  });

  test("redacts malformed server bodies behind a contract error", async () => {
    const fetcher: ApiFetch = async () =>
      Response.json(
        { databasePassword: "must-not-leak", service: "unexpected-service", status: "ok" },
        { headers: { "x-request-id": "server-request-2" } },
      );
    const client = new ApiClient("http://localhost:3000", fetcher);

    const error = await client
      .request("/health", healthResponseSchema, { requestId: "web-test-3" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiContractError);
    expect(error).toMatchObject({ requestId: "server-request-2", status: 200 });
    expect(String(error)).not.toContain("must-not-leak");
  });

  test("rejects attempts to escape the configured API origin", async () => {
    const fetcher: ApiFetch = async () => Response.json({});
    const client = new ApiClient("http://localhost:3000", fetcher);

    const error = await client
      .request("https://example.com/health", healthResponseSchema)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TypeError);
  });

  test("notifies the session boundary when the API returns unauthorized", async () => {
    let unauthorizedCalls = 0;
    const fetcher: ApiFetch = async () =>
      Response.json(
        {
          error: {
            code: "unauthorized",
            message: "A valid dashboard session is required.",
            requestId: "server-request-3",
          },
        },
        { status: 401 },
      );
    const client = new ApiClient("http://localhost:3000", fetcher, () => {
      unauthorizedCalls++;
    });

    await client
      .request("/v1/organizations", healthResponseSchema, { requestId: "web-test-4" })
      .catch(() => undefined);

    expect(unauthorizedCalls).toBe(1);
  });
});
