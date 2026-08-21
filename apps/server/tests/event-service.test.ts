import { describe, expect, test } from "bun:test";
import type { UsageEvent } from "@meterpilot/contracts/events";

import type { ApiKeyPrincipal } from "../src/features/api-keys/repository";
import { hashUsageEvent } from "../src/features/events/canonicalization";
import { createEventService } from "../src/features/events/service";
import { createEventRepositoryStub } from "./helpers";

const NOW = new Date("2026-08-20T04:00:00.000Z");
const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const API_KEY_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const principal: ApiKeyPrincipal = {
  apiKeyId: API_KEY_ID,
  organizationId: ORGANIZATION_ID,
  scopes: ["events:write", "events:read"],
};

const event: UsageEvent = {
  id: "evt_01JZ",
  occurredAt: "2026-08-20T03:59:00.000Z",
  properties: { inputTokens: "820", model: "gpt-x-small" },
  subject: "workspace_acme",
  type: "llm.tokens.consumed",
};

describe("event service", () => {
  test("persists a reverse correction with a target-bound idempotency hash", async () => {
    let receivedWrite: unknown;
    const service = createEventService(
      createEventRepositoryStub({
        correct(_source, write) {
          receivedWrite = write;
          return Promise.resolve({
            correctedEventId: event.id,
            correctionEventId: "evt_reverse",
            kind: "reverse",
            status: "accepted",
          });
        },
      }),
      { now: () => NOW },
    );

    expect(
      await service.correct(
        principal,
        event.id,
        { id: "evt_reverse", kind: "reverse" },
        "request_reverse",
      ),
    ).toEqual({
      response: {
        correction: {
          correctedEventId: event.id,
          correctionEventId: "evt_reverse",
          kind: "reverse",
          status: "accepted",
        },
        requestId: "request_reverse",
      },
      status: "ok",
    });
    expect(receivedWrite).toMatchObject({
      correctedEventKey: event.id,
      receivedAt: NOW,
      request: { id: "evt_reverse", kind: "reverse" },
      requestId: "request_reverse",
    });
    expect(receivedWrite).toHaveProperty("payloadHash", expect.stringMatching(/^[a-f0-9]{64}$/));
  });

  test("rejects self-references and future replacements before persistence", async () => {
    let writes = 0;
    const service = createEventService(
      createEventRepositoryStub({
        correct: () => {
          writes++;
          return Promise.resolve({ status: "not_found" });
        },
      }),
      { now: () => NOW },
    );

    expect(
      await service.correct(principal, event.id, { id: event.id, kind: "reverse" }, "self"),
    ).toMatchObject({ status: "validation_error" });
    expect(
      await service.correct(
        principal,
        event.id,
        {
          event: { ...event, id: "evt_future", occurredAt: "2026-08-20T04:06:00.000Z" },
          kind: "replace",
        },
        "future",
      ),
    ).toMatchObject({ status: "validation_error" });
    expect(writes).toBe(0);
  });

  test("persists a validated event with its canonical hash and source", async () => {
    let receivedSource: unknown;
    let receivedWrites: unknown;
    const service = createEventService(
      createEventRepositoryStub({
        ingest(source, writes) {
          receivedSource = source;
          receivedWrites = writes;
          return Promise.resolve([{ id: event.id, status: "accepted" }]);
        },
      }),
      { now: () => NOW },
    );

    expect(await service.ingestOne(principal, event, "request_ingest")).toEqual({
      requestId: "request_ingest",
      results: [{ id: event.id, status: "accepted" }],
    });
    expect(receivedSource).toEqual({
      apiKeyId: API_KEY_ID,
      organizationId: ORGANIZATION_ID,
    });
    expect(receivedWrites).toEqual([
      {
        event,
        payloadHash: hashUsageEvent(event),
        receivedAt: NOW,
        requestId: "request_ingest",
      },
    ]);
  });

  test("preserves partial batch results while only persisting valid events", async () => {
    let persistedIds: readonly string[] = [];
    const secondEvent = { ...event, id: "evt_second" };
    const service = createEventService(
      createEventRepositoryStub({
        ingest(_source, writes) {
          persistedIds = writes.map((write) => write.event.id);
          return Promise.resolve([
            { id: event.id, status: "duplicate" },
            { id: secondEvent.id, status: "accepted" },
          ]);
        },
      }),
      { now: () => NOW },
    );

    const response = await service.ingestBatch(
      principal,
      [event, { ...event, id: "unsafe id" }, secondEvent],
      "request_batch",
    );

    expect(persistedIds).toEqual([event.id, secondEvent.id]);
    expect(response).toEqual({
      requestId: "request_batch",
      results: [
        { id: event.id, status: "duplicate" },
        {
          code: "invalid_event",
          message: "The event is invalid.",
          status: "rejected",
        },
        { id: secondEvent.id, status: "accepted" },
      ],
    });
  });

  test("returns stable rejection results without touching persistence", async () => {
    let writes = 0;
    const service = createEventService(
      createEventRepositoryStub({
        ingest: () => {
          writes++;
          return Promise.resolve([]);
        },
      }),
      { now: () => NOW },
    );
    const response = await service.ingestOne(
      principal,
      { ...event, occurredAt: "2026-08-20T04:06:00.000Z" },
      "request_rejected",
    );

    expect(writes).toBe(0);
    expect(response.results).toEqual([
      {
        code: "invalid_event",
        id: event.id,
        message: "The event is invalid.",
        status: "rejected",
      },
    ]);
  });

  test("reads an event only through the authenticated organization", async () => {
    let receivedOrganizationId: string | undefined;
    const service = createEventService(
      createEventRepositoryStub({
        find(organizationId) {
          receivedOrganizationId = organizationId;
          return Promise.resolve({
            event,
            processingState: "pending",
            propertiesRedactedAt: null,
            receivedAt: NOW,
          });
        },
      }),
    );

    expect(await service.find(principal, event.id)).toEqual({
      correctedBy: null,
      correctionOf: null,
      ...event,
      processingState: "pending",
      propertiesRedactedAt: null,
      receivedAt: NOW.toISOString(),
    });
    expect(receivedOrganizationId).toBe(ORGANIZATION_ID);
  });
});
