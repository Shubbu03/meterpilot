import { zValidator } from "@hono/zod-validator";
import {
  eventParamSchema,
  MAX_EVENT_BATCH_BODY_SIZE_BYTES,
  MAX_EVENT_SINGLE_BODY_SIZE_BYTES,
  usageEventBatchEnvelopeSchema,
} from "@meterpilot/contracts/events";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { createApiKeyMiddleware } from "../api-keys/middleware";
import type { ApiKeyService } from "../api-keys/service";
import type { AppEnvironment } from "../../http/environment";
import { publicError, validationError } from "../../http/public-errors";
import type { EventService } from "./service";

export type EventRouteDependencies = Readonly<{
  apiKeyService: ApiKeyService;
  eventService: EventService;
}>;

function payloadTooLarge(context: Context) {
  return publicError(
    context,
    413,
    "payload_too_large",
    "The event request exceeds the allowed size.",
  );
}

export function registerEventRoutes(
  app: Hono<AppEnvironment>,
  dependencies: EventRouteDependencies,
) {
  const requireWriteScope = createApiKeyMiddleware(dependencies.apiKeyService, "events:write");
  const requireReadScope = createApiKeyMiddleware(dependencies.apiKeyService, "events:read");
  const limitSingleBody = bodyLimit({
    maxSize: MAX_EVENT_SINGLE_BODY_SIZE_BYTES,
    onError: payloadTooLarge,
  });
  const limitBatchBody = bodyLimit({
    maxSize: MAX_EVENT_BATCH_BODY_SIZE_BYTES,
    onError: payloadTooLarge,
  });
  const validateEventKey = zValidator("param", eventParamSchema, (result, context) => {
    if (!result.success) {
      return validationError(context, result.error.issues);
    }
  });

  app.post("/v1/events", requireWriteScope, limitSingleBody, async (context) => {
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return publicError(context, 400, "validation_error", "The request body must be valid JSON.");
    }

    const response = await dependencies.eventService.ingestOne(
      context.get("apiKeyPrincipal"),
      input,
      context.get("requestId"),
    );
    context.header("Cache-Control", "no-store");
    return context.json(response, 202);
  });

  app.post("/v1/events/batch", requireWriteScope, limitBatchBody, async (context) => {
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return publicError(context, 400, "validation_error", "The request body must be valid JSON.");
    }

    const parsed = usageEventBatchEnvelopeSchema.safeParse(input);
    if (!parsed.success) {
      return validationError(context, parsed.error.issues);
    }

    const response = await dependencies.eventService.ingestBatch(
      context.get("apiKeyPrincipal"),
      parsed.data.events,
      context.get("requestId"),
    );
    context.header("Cache-Control", "no-store");
    return context.json(response, 202);
  });

  app.get("/v1/events/:eventKey", requireReadScope, validateEventKey, async (context) => {
    const event = await dependencies.eventService.find(
      context.get("apiKeyPrincipal"),
      context.req.valid("param").eventKey,
    );
    if (!event) {
      return publicError(context, 404, "not_found", "The requested event was not found.");
    }

    context.header("Cache-Control", "no-store");
    return context.json({ event, requestId: context.get("requestId") });
  });
}
