import { describe, expect, test } from "bun:test";

import {
  createMeterPilotClient,
  MeterPilotConfigurationError,
  MeterPilotHttpError,
  MeterPilotResponseError,
  MeterPilotTimeoutError,
  MeterPilotValidationError,
} from "../src";

const EVENT = {
  id: "evt_01JZ",
  occurredAt: "2026-08-13T12:00:00.000Z",
  properties: {},
  subject: "workspace_acme",
  type: "llm.tokens.consumed",
};

describe("MeterPilot SDK failures", () => {
  test("rejects unsafe configuration without exposing the API key", () => {
    const secret = "do-not-expose-this";

    expect(() =>
      createMeterPilotClient({ apiKey: secret, baseUrl: "http://meterpilot.example.com" }),
    ).toThrow(MeterPilotConfigurationError);

    try {
      createMeterPilotClient({ apiKey: secret, baseUrl: "not-a-url" });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  test("validates events before invoking fetch", async () => {
    let fetchCalled = false;
    const client = createMeterPilotClient({
      apiKey: "secret-api-key",
      baseUrl: "http://localhost:3000",
      fetch: async () => {
        fetchCalled = true;
        throw new Error("must not run");
      },
      requestIdFactory: () => "request_04",
    });

    expect(client.events.send({ ...EVENT, subject: "../other-tenant" })).rejects.toBeInstanceOf(
      MeterPilotValidationError,
    );
    expect(fetchCalled).toBeFalse();
  });

  test("returns typed public HTTP errors", async () => {
    const client = createMeterPilotClient({
      apiKey: "secret-api-key",
      baseUrl: "https://meterpilot.example.com",
      fetch: async () =>
        Response.json(
          {
            error: {
              code: "unauthorized",
              message: "The credential is invalid.",
              requestId: "request_05",
            },
          },
          { status: 401 },
        ),
      requestIdFactory: () => "request_05",
    });

    try {
      await client.events.send(EVENT);
      throw new Error("expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(MeterPilotHttpError);
      expect(error).toMatchObject({ code: "unauthorized", requestId: "request_05", status: 401 });
    }
  });

  test("rejects malformed success responses", async () => {
    const client = createMeterPilotClient({
      apiKey: "secret-api-key",
      baseUrl: "https://meterpilot.example.com",
      fetch: async () => Response.json({ accepted: true }, { status: 202 }),
      requestIdFactory: () => "request_06",
    });

    expect(client.events.send(EVENT)).rejects.toBeInstanceOf(MeterPilotResponseError);
  });

  test("aborts requests at the configured timeout", async () => {
    const client = createMeterPilotClient({
      apiKey: "secret-api-key",
      baseUrl: "https://meterpilot.example.com",
      fetch: async (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
      requestIdFactory: () => "request_07",
      timeoutMs: 5,
    });

    expect(client.events.send(EVENT)).rejects.toBeInstanceOf(MeterPilotTimeoutError);
  });
});
