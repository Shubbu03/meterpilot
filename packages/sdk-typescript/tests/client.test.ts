import { describe, expect, test } from "bun:test";

import { createMeterPilotClient } from "../src";

const EVENT = {
  id: "evt_01JZ",
  occurredAt: "2026-08-13T12:00:00.000Z",
  properties: { inputTokens: "820" },
  subject: "workspace_acme",
  type: "llm.tokens.consumed",
};

describe("MeterPilot event client", () => {
  test("sends one event with authentication and a request ID", async () => {
    const requests: Request[] = [];
    const client = createMeterPilotClient({
      apiKey: "secret-api-key",
      baseUrl: "https://meterpilot.example.com",
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json(
          { requestId: "request_01", results: [{ id: EVENT.id, status: "accepted" }] },
          { status: 202 },
        );
      },
      requestIdFactory: () => "request_01",
    });

    const response = await client.events.send(EVENT);
    const request = requests[0];

    expect(response.results[0]?.status).toBe("accepted");
    expect(request?.url).toBe("https://meterpilot.example.com/v1/events");
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("authorization")).toBe("Bearer secret-api-key");
    expect(request?.headers.get("x-request-id")).toBe("request_01");
    expect(await request?.json()).toEqual(EVENT);
  });

  test("sends an event batch to the batch endpoint", async () => {
    let request: Request | undefined;
    const client = createMeterPilotClient({
      apiKey: "secret-api-key",
      baseUrl: "https://meterpilot.example.com/api/",
      fetch: async (input, init) => {
        request = new Request(input, init);
        return Response.json(
          { requestId: "request_02", results: [{ id: EVENT.id, status: "duplicate" }] },
          { status: 202 },
        );
      },
      requestIdFactory: () => "request_02",
    });

    await client.events.sendBatch([EVENT]);

    expect(request?.url).toBe("https://meterpilot.example.com/api/v1/events/batch");
    expect(await request?.json()).toEqual({ events: [EVENT] });
  });

  test("supports caller cancellation", async () => {
    const caller = new AbortController();
    const client = createMeterPilotClient({
      apiKey: "secret-api-key",
      baseUrl: "https://meterpilot.example.com",
      fetch: async (_input, init) => {
        caller.abort("stop");
        if (init?.signal?.aborted) {
          throw init.signal.reason;
        }
        await new Promise((resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
          resolve(undefined);
        });
        throw new Error("unreachable");
      },
      requestIdFactory: () => "request_03",
    });

    expect(client.events.send(EVENT, { signal: caller.signal })).rejects.toBe("stop");
  });
});
