import { zValidator } from "@hono/zod-validator";
import {
  eventParamSchema,
  MAX_EVENT_BATCH_BODY_SIZE_BYTES,
  MAX_EVENT_SINGLE_BODY_SIZE_BYTES,
  organizationEventParamSchema,
  usageEventBatchEnvelopeSchema,
  usageEventListQuerySchema,
} from "@meterpilot/contracts/events";
import { organizationIdParamSchema } from "@meterpilot/contracts/organizations";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { createApiKeyMiddleware } from "../api-keys/middleware";
import type { ApiKeyService } from "../api-keys/service";
import type { AuthGateway } from "../identity/authentication";
import { createSessionMiddleware } from "../identity/session-middleware";
import type { OrganizationRepository } from "../organizations/repository";
import { createTenantMiddleware } from "../organizations/tenant-middleware";
import type { AppEnvironment } from "../../http/environment";
import { publicError, validationError } from "../../http/public-errors";
import { InvalidEventCursorError } from "./repository";
import type { EventService } from "./service";

export type EventRouteDependencies = Readonly<{
  apiKeyService: ApiKeyService;
  auth: AuthGateway;
  eventService: EventService;
  organizationRepository: OrganizationRepository;
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
  const requireSession = createSessionMiddleware(dependencies.auth);
  const requireTenant = createTenantMiddleware(dependencies.organizationRepository);
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
  const validateOrganizationId = zValidator(
    "param",
    organizationIdParamSchema,
    (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    },
  );
  const validateOrganizationEvent = zValidator(
    "param",
    organizationEventParamSchema,
    (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    },
  );

  app.get(
    "/v1/organizations/:organizationId/events",
    requireSession,
    validateOrganizationId,
    requireTenant,
    zValidator("query", usageEventListQuerySchema, (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    }),
    async (context) => {
      try {
        const page = await dependencies.eventService.listForOrganization(
          context.get("tenant").organization.id,
          context.req.valid("query"),
        );
        context.header("Cache-Control", "no-store");
        return context.json(page);
      } catch (error) {
        if (error instanceof InvalidEventCursorError) {
          return publicError(context, 400, "validation_error", error.message);
        }
        throw error;
      }
    },
  );

  app.get(
    "/v1/organizations/:organizationId/events/:eventKey",
    requireSession,
    validateOrganizationEvent,
    requireTenant,
    async (context) => {
      const event = await dependencies.eventService.findForOrganization(
        context.get("tenant").organization.id,
        context.req.valid("param").eventKey,
      );
      if (!event) {
        return publicError(context, 404, "not_found", "The requested event was not found.");
      }
      context.header("Cache-Control", "no-store");
      return context.json({ event, requestId: context.get("requestId") });
    },
  );

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

  app.post(
    "/v1/events/:eventKey/corrections",
    requireWriteScope,
    limitSingleBody,
    validateEventKey,
    async (context) => {
      let input: unknown;
      try {
        input = await context.req.json();
      } catch {
        return publicError(
          context,
          400,
          "validation_error",
          "The request body must be valid JSON.",
        );
      }

      const result = await dependencies.eventService.correct(
        context.get("apiKeyPrincipal"),
        context.req.valid("param").eventKey,
        input,
        context.get("requestId"),
      );
      if (result.status === "validation_error") {
        return validationError(context, result.issues);
      }
      if (result.status === "not_found") {
        return publicError(context, 404, "not_found", "The requested event was not found.");
      }
      if (result.status === "unknown_subject") {
        return publicError(context, 404, "not_found", "The replacement subject was not found.");
      }
      if (result.status === "idempotency_conflict") {
        return publicError(
          context,
          409,
          "idempotency_conflict",
          "The correction identifier was already used for different input.",
        );
      }
      if (result.status === "already_corrected") {
        return publicError(context, 409, "conflict", "The event already has a direct correction.");
      }
      if (result.status === "properties_redacted") {
        return publicError(
          context,
          409,
          "conflict",
          "The event can no longer be corrected because its source properties were redacted by retention policy.",
        );
      }

      if (result.status !== "ok") {
        throw new Error("Event correction service returned an unsupported result.");
      }

      context.header("Cache-Control", "no-store");
      return context.json(result.response, 202);
    },
  );

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
