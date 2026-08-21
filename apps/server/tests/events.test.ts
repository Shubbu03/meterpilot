import { describe, expect, test } from "bun:test";
import {
  MAX_EVENT_SINGLE_BODY_SIZE_BYTES,
  type UsageEvent,
  type UsageEventSummary,
} from "@meterpilot/contracts/events";
import { createObservability } from "@meterpilot/observability";

import type { ApiKeyPrincipal } from "../src/features/api-keys/repository";
import type { AuthGateway } from "../src/features/identity/authentication";
import { createEventService } from "../src/features/events/service";
import type { EventRepository } from "../src/features/events/repository";
import { createApp } from "../src/http/app";
import {
  createApiKeyServiceStub,
  createCatalogRepositoryStub,
  createCustomerRepositoryStub,
  createEntitlementRepositoryStub,
  createEventRepositoryStub,
  createEventServiceStub,
  createMeterRepositoryStub,
  createOrganizationRepositoryStub,
  createUsageRepositoryStub,
} from "./helpers";

const NOW = new Date("2026-08-20T04:00:00.000Z");
const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const API_KEY_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
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
    catalogRepository: createCatalogRepositoryStub(),
    customerRepository: createCustomerRepositoryStub(),
    entitlementRepository: createEntitlementRepositoryStub(),
    eventService,
    meterRepository: createMeterRepositoryStub(),
    observability: createObservability({
      environment: "test",
      level: "error",
      service: "meterpilot-server",
      write: () => undefined,
    }),
    organizationRepository: createOrganizationRepositoryStub(),
    usageRepository: createUsageRepositoryStub(),
  });
}

function createDashboardEventTestApp(eventService: ReturnType<typeof createEventServiceStub>) {
  const user = { email: "owner@example.com", id: USER_ID, name: "Owner" };
  const auth: AuthGateway = {
    getSession: () => Promise.resolve({ session: { id: "session" }, user }),
    handler: () => Promise.resolve(new Response("auth")),
  };
  return createApp({
    apiKeyService: createApiKeyServiceStub(),
    auth,
    checkDatabaseHealth: () => Promise.resolve(),
    catalogRepository: createCatalogRepositoryStub(),
    customerRepository: createCustomerRepositoryStub(),
    entitlementRepository: createEntitlementRepositoryStub(),
    eventService,
    meterRepository: createMeterRepositoryStub(),
    observability: createObservability({
      environment: "test",
      level: "error",
      service: "meterpilot-server",
      write: () => undefined,
    }),
    organizationRepository: createOrganizationRepositoryStub({
      resolveTenant: () =>
        Promise.resolve({
          actorUserId: USER_ID,
          membership: {
            createdAt: NOW.toISOString(),
            role: "owner",
            user,
          },
          organization: {
            createdAt: NOW.toISOString(),
            defaultTimezone: "UTC",
            id: ORGANIZATION_ID,
            name: "Acme",
            slug: "acme",
          },
        }),
    }),
    usageRepository: createUsageRepositoryStub(),
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
  test("lists filtered event summaries for the dashboard tenant", async () => {
    const summary: UsageEventSummary = {
      correctedBy: null,
      correctionOf: null,
      customerKey: "customer_acme",
      id: event.id,
      occurredAt: event.occurredAt,
      processingState: "processed",
      propertiesRedactedAt: null,
      receivedAt: NOW.toISOString(),
      subject: event.subject,
      type: event.type,
    };
    let received: unknown;
    const app = createDashboardEventTestApp(
      createEventServiceStub({
        listForOrganization(organizationId, query) {
          received = { organizationId, query };
          return Promise.resolve({ items: [summary], nextCursor: "next-event" });
        },
      }),
    );

    const response = await app.request(
      `/v1/organizations/${ORGANIZATION_ID}/events?customerKey=customer_acme&limit=1&processingState=processed&type=llm.tokens.consumed`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(received).toEqual({
      organizationId: ORGANIZATION_ID,
      query: {
        customerKey: "customer_acme",
        limit: 1,
        processingState: "processed",
        type: "llm.tokens.consumed",
      },
    });
    expect(await response.json()).toEqual({ items: [summary], nextCursor: "next-event" });
  });

  test("reads event properties through the dashboard tenant", async () => {
    let received: unknown;
    const stored = {
      correctedBy: null,
      correctionOf: null,
      ...event,
      processingState: "processed" as const,
      propertiesRedactedAt: null,
      receivedAt: NOW.toISOString(),
    };
    const app = createDashboardEventTestApp(
      createEventServiceStub({
        findForOrganization(organizationId, eventKey) {
          received = { eventKey, organizationId };
          return Promise.resolve(stored);
        },
      }),
    );

    const response = await app.request(`/v1/organizations/${ORGANIZATION_ID}/events/${event.id}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(received).toEqual({ eventKey: event.id, organizationId: ORGANIZATION_ID });
    expect(await response.json()).toMatchObject({ event: stored });
  });

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

  test("accepts a tenant-scoped append-only event correction", async () => {
    let received: readonly unknown[] = [];
    const app = createEventTestApp(
      createEventServiceStub({
        correct(...input) {
          received = input;
          return Promise.resolve({
            response: {
              correction: {
                correctedEventId: event.id,
                correctionEventId: "evt_reverse",
                kind: "reverse",
                status: "accepted",
              },
              requestId: "request_correction",
            },
            status: "ok",
          });
        },
      }),
    );
    const response = await app.request(`/v1/events/${event.id}/corrections`, {
      body: JSON.stringify({ id: "evt_reverse", kind: "reverse" }),
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        "X-Request-Id": "request_correction",
      },
      method: "POST",
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(received.slice(1)).toEqual([
      event.id,
      { id: "evt_reverse", kind: "reverse" },
      "request_correction",
    ]);
    expect(await response.json()).toEqual({
      correction: {
        correctedEventId: event.id,
        correctionEventId: "evt_reverse",
        kind: "reverse",
        status: "accepted",
      },
      requestId: "request_correction",
    });
  });

  test("maps correction conflicts without disclosing another tenant's event", async () => {
    const notFound = createEventTestApp(
      createEventServiceStub({ correct: () => Promise.resolve({ status: "not_found" }) }),
    );
    const conflict = createEventTestApp(
      createEventServiceStub({
        correct: () => Promise.resolve({ status: "already_corrected" }),
      }),
    );
    const request = {
      body: JSON.stringify({ id: "evt_reverse", kind: "reverse" }),
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      method: "POST",
    } as const;

    expect((await notFound.request("/v1/events/evt_other/corrections", request)).status).toBe(404);
    expect((await conflict.request(`/v1/events/${event.id}/corrections`, request)).status).toBe(
      409,
    );
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
            propertiesRedactedAt: null,
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
        correctedBy: null,
        correctionOf: null,
        ...event,
        processingState: "pending",
        propertiesRedactedAt: null,
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
              ? { event, processingState: "pending", propertiesRedactedAt: null, receivedAt: NOW }
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
