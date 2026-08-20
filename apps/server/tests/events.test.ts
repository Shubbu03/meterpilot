import { describe, expect, test } from "bun:test";
import { MAX_EVENT_SINGLE_BODY_SIZE_BYTES, type UsageEvent } from "@meterpilot/contracts/events";
import { createObservability } from "@meterpilot/observability";

import type { ApiKeyPrincipal } from "../src/features/api-keys/repository";
import type { AuthGateway } from "../src/features/identity/authentication";
import { createEventService } from "../src/features/events/service";
import type { EventRepository } from "../src/features/events/repository";
import { createApp } from "../src/http/app";
import {
  createApiKeyServiceStub,
  createEventRepositoryStub,
  createEventServiceStub,
  createOrganizationRepositoryStub,
} from "./helpers";

const NOW = new Date("2026-08-20T04:00:00.000Z");
const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const API_KEY_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const KEY = `mpk_${"A".repeat(12)}.${"B".repeat(43)}`;

const event: UsageEvent = {
  id: "evt_http_01",
  occurredAt: "2026-08-20T03:59:00.000Z",
  properties: {
    inputTokens: "820",
    model: "gpt-x-small",
    outputTokens: "233",
  },
  subject: "workspace_acme",
  type: "llm.tokens.consumed",
};

const principal: ApiKeyPrincipal = {
  apiKeyId: API_KEY_ID,
  organizationId: ORGANIZATION_ID,
  scopes: ["events:write", "events:read"],
};

function createEventTestApp(
  eventService: ReturnType<typeof createEventService> | ReturnType<typeof createEventServiceStub>,
  authenticatedPrincipal: ApiKeyPrincipal | null = principal,
) {
  const auth: AuthGateway = {
    getSession: () => Promise.resolve(null),
    handler: () => Promise.resolve(new Response("auth")),
  };

  return createApp({
    apiKeyService: createApiKeyServiceStub({
      authenticate: () => Promise.resolve(authenticatedPrincipal),
    }),
    auth,
    checkDatabaseHealth: () => Promise.resolve(),
    eventService,
    observability: createObservability({
      environment: "test",
      level: "error",
      service: "meterpilot-server",
      write: () => undefined,
    }),
    organizationRepository: createOrganizationRepositoryStub(),
  });
}

function idempotentRepository(): EventRepository {
  const hashes = new Map<string, string>();

  return createEventRepositoryStub({
    ingest(_source, writes) {
      return Promise.resolve(
        writes.map((write) => {
          const existingHash = hashes.get(write.event.id);
          if (!existingHash) {
            hashes.set(write.event.id, write.payloadHash);
            return { id: write.event.id, status: "accepted" as const };
          }

          return {
            id: write.event.id,
            status:
              existingHash === write.payloadHash
                ? ("duplicate" as const)
                : ("idempotency_conflict" as const),
          };
        }),
      );
    },
  });
}

describe("event routes", () => {
  test("accepts an event and treats reordered properties as a duplicate", async () => {
    const app = createEventTestApp(createEventService(idempotentRepository(), { now: () => NOW }));
    const firstResponse = await app.request("/v1/events", {
      body: JSON.stringify(event),
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        "X-Request-Id": "request_first",
      },
      method: "POST",
    });
    expect(firstResponse.status).toBe(202);
    expect(firstResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(await firstResponse.json()).toEqual({
      requestId: "request_first",
      results: [{ id: event.id, status: "accepted" }],
    });

    const reordered = {
      ...event,
      properties: {
        outputTokens: "233",
        model: "gpt-x-small",
        inputTokens: "820",
      },
    };
    const duplicateResponse = await app.request("/v1/events", {
      body: JSON.stringify(reordered),
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        "X-Request-Id": "request_duplicate",
      },
      method: "POST",
    });

    expect(duplicateResponse.status).toBe(202);
    expect(await duplicateResponse.json()).toEqual({
      requestId: "request_duplicate",
      results: [{ id: event.id, status: "duplicate" }],
    });

    const conflictResponse = await app.request("/v1/events", {
      body: JSON.stringify({
        ...event,
        properties: { ...event.properties, inputTokens: "821" },
      }),
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        "X-Request-Id": "request_conflict",
      },
      method: "POST",
    });

    expect(conflictResponse.status).toBe(202);
    expect(await conflictResponse.json()).toEqual({
      requestId: "request_conflict",
      results: [{ id: event.id, status: "idempotency_conflict" }],
    });
  });

  test("returns ordered partial results for a mixed-validity batch", async () => {
    const app = createEventTestApp(createEventService(idempotentRepository(), { now: () => NOW }));
    const response = await app.request("/v1/events/batch", {
      body: JSON.stringify({
        events: [event, { ...event, id: "evt_invalid", type: "Invalid Event" }],
      }),
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        "X-Request-Id": "request_batch",
      },
      method: "POST",
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      requestId: "request_batch",
      results: [
        { id: event.id, status: "accepted" },
        {
          code: "invalid_event",
          id: "evt_invalid",
          message: "The event is invalid.",
          status: "rejected",
        },
      ],
    });
  });

  test("requires the endpoint scope before invoking ingestion", async () => {
    let ingestionCalls = 0;
    const eventService = createEventServiceStub({
      ingestOne: (_principal, _input, requestId) => {
        ingestionCalls++;
        return Promise.resolve({ requestId, results: [] });
      },
    });
    const app = createEventTestApp(eventService, {
      ...principal,
      scopes: ["events:read"],
    });
    const response = await app.request("/v1/events", {
      body: JSON.stringify(event),
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(ingestionCalls).toBe(0);
  });

  test("returns a structured payload-too-large error before parsing JSON", async () => {
    let ingestionCalls = 0;
    const app = createEventTestApp(
      createEventServiceStub({
        ingestOne: (_principal, _input, requestId) => {
          ingestionCalls++;
          return Promise.resolve({ requestId, results: [] });
        },
      }),
    );
    const response = await app.request("/v1/events", {
      body: "{}",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Length": String(MAX_EVENT_SINGLE_BODY_SIZE_BYTES + 1),
        "Content-Type": "application/json",
        "X-Request-Id": "request_large",
      },
      method: "POST",
    });

    expect(response.status).toBe(413);
    expect(ingestionCalls).toBe(0);
    expect(await response.json()).toEqual({
      error: {
        code: "payload_too_large",
        message: "The event request exceeds the allowed size.",
        requestId: "request_large",
      },
    });
  });

  test("reads processing state through the API key organization only", async () => {
    let receivedOrganizationId: string | undefined;
    let receivedEventKey: string | undefined;
    const service = createEventService(
      createEventRepositoryStub({
        find(organizationId, eventKey) {
          receivedOrganizationId = organizationId;
          receivedEventKey = eventKey;
          return Promise.resolve({
            event,
            processingState: "pending",
            receivedAt: NOW,
          });
        },
      }),
    );
    const app = createEventTestApp(service);
    const response = await app.request(`/v1/events/${event.id}`, {
      headers: {
        Authorization: `Bearer ${KEY}`,
        "X-Request-Id": "request_read",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(receivedOrganizationId).toBe(ORGANIZATION_ID);
    expect(receivedEventKey).toBe(event.id);
    expect(await response.json()).toEqual({
      event: {
        ...event,
        processingState: "pending",
        receivedAt: NOW.toISOString(),
      },
      requestId: "request_read",
    });
  });

  test("does not disclose whether another tenant owns an event key", async () => {
    const otherOrganizationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let receivedOrganizationId: string | undefined;
    const service = createEventService(
      createEventRepositoryStub({
        find(organizationId) {
          receivedOrganizationId = organizationId;
          return Promise.resolve(
            organizationId === otherOrganizationId
              ? { event, processingState: "pending", receivedAt: NOW }
              : null,
          );
        },
      }),
    );
    const app = createEventTestApp(service);
    const response = await app.request("/v1/events/evt_other_tenant", {
      headers: {
        Authorization: `Bearer ${KEY}`,
        "X-Request-Id": "request_missing",
      },
    });

    expect(response.status).toBe(404);
    expect(receivedOrganizationId).toBe(ORGANIZATION_ID);
    expect(await response.json()).toEqual({
      error: {
        code: "not_found",
        message: "The requested event was not found.",
        requestId: "request_missing",
      },
    });
  });
});
